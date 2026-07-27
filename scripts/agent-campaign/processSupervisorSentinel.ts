/// <reference types="node" />

import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

import type { Readable, Writable } from 'node:stream';

export const PROCESS_SUPERVISOR_SENTINEL_ROLE = '--process-supervisor-sentinel';

// This protocol only runs trusted, code-owned executors. Process-group cleanup is not a sandbox:
// executors must not detach descendants or signal the owning sentinel.
export type TrustedCodeOwnedExecutorStartMessage = {
    kind: 'start-trusted-code-owned-executor';
    executable: string;
    arguments: readonly string[];
    cwd: string;
};

export type SentinelOutcomeMessage =
    { kind: 'exit'; code: number } | { kind: 'signal'; signal: NodeJS.Signals } | { kind: 'spawn-error' };

export type SentinelMessage = { kind: 'ready' } | SentinelOutcomeMessage;

const EMPTY_ENV = Object.freeze({});

function isAbsolutePath(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && !value.includes('\0') && isAbsolute(value);
}

function isTrustedStartMessage(value: unknown): value is TrustedCodeOwnedExecutorStartMessage {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<TrustedCodeOwnedExecutorStartMessage>;
    return (
        candidate.kind === 'start-trusted-code-owned-executor' &&
        isAbsolutePath(candidate.executable) &&
        Array.isArray(candidate.arguments) &&
        candidate.arguments.every((argument) => typeof argument === 'string' && !argument.includes('\0')) &&
        isAbsolutePath(candidate.cwd)
    );
}

function sendMessage(message: SentinelMessage): void {
    if (!process.connected) {
        return;
    }
    try {
        process.send?.(message, () => undefined);
    } catch {
        // The owner is responsible for terminating this sentinel process group.
    }
}

type ForwardExecutorStreamInput = {
    source: Readable;
    destination: Writable;
    onFailure: () => void;
};

// Terminal IPC must wait for source end and every destination write callback; executor close alone
// does not prove that userland destination buffers have flushed into the owner-visible descriptors.
function forwardExecutorStream({ source, destination, onFailure }: ForwardExecutorStreamInput): Promise<void> {
    return new Promise((resolve) => {
        let failed = false;
        let pendingWrite = false;
        let sourceEnded = false;
        let settled = false;
        const finish = () => {
            if (settled || !sourceEnded || pendingWrite) {
                return;
            }
            settled = true;
            source.off('data', onData);
            source.off('end', onEnd);
            source.off('error', onSourceError);
            source.off('close', onClose);
            destination.off('error', onDestinationError);
            resolve();
        };
        const fail = () => {
            if (!failed) {
                failed = true;
                onFailure();
            }
            source.off('data', onData);
            source.resume();
        };
        const onData = (chunk: Buffer) => {
            source.pause();
            pendingWrite = true;
            try {
                destination.write(chunk, (error) => {
                    pendingWrite = false;
                    if (error) {
                        fail();
                    } else if (!failed) {
                        source.resume();
                    }
                    finish();
                });
            } catch {
                pendingWrite = false;
                fail();
                finish();
            }
        };
        const onEnd = () => {
            sourceEnded = true;
            finish();
        };
        const onSourceError = () => {
            sourceEnded = true;
            fail();
            finish();
        };
        const onClose = () => {
            if (!source.readableEnded) {
                sourceEnded = true;
                fail();
                finish();
            }
        };
        const onDestinationError = () => {
            fail();
            finish();
        };
        source.on('data', onData);
        source.once('end', onEnd);
        source.once('error', onSourceError);
        source.once('close', onClose);
        destination.on('error', onDestinationError);
    });
}

export function runProcessSupervisorSentinel(): void {
    let reported = false;
    let started = false;
    const report = (message: SentinelOutcomeMessage) => {
        if (!reported) {
            reported = true;
            sendMessage(message);
        }
    };

    process.on('message', (value) => {
        if (started || !isTrustedStartMessage(value)) {
            started = true;
            report({ kind: 'spawn-error' });
            return;
        }
        started = true;
        let trustedExecutor;
        try {
            trustedExecutor = spawn(value.executable, [...value.arguments], {
                cwd: value.cwd,
                detached: false,
                env: EMPTY_ENV,
                shell: false,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch {
            report({ kind: 'spawn-error' });
            return;
        }
        let terminal: SentinelOutcomeMessage | null = null;
        const handleStreamFailure = () => {
            terminal = { kind: 'spawn-error' };
        };
        const streamsForwarded = Promise.all([
            forwardExecutorStream({
                source: trustedExecutor.stdout,
                destination: process.stdout,
                onFailure: handleStreamFailure,
            }),
            forwardExecutorStream({
                source: trustedExecutor.stderr,
                destination: process.stderr,
                onFailure: handleStreamFailure,
            }),
        ]);
        trustedExecutor.once('error', () => {
            terminal = { kind: 'spawn-error' };
        });
        trustedExecutor.once('exit', (code, signal) => {
            if (signal) {
                terminal ??= { kind: 'signal', signal };
                return;
            }
            terminal ??= { kind: 'exit', code: code ?? 1 };
        });
        trustedExecutor.once('close', () => {
            void streamsForwarded.then(() => report(terminal ?? { kind: 'spawn-error' }));
        });
    });

    setInterval(() => undefined, 60_000);
    sendMessage({ kind: 'ready' });
}

if (process.argv[2] === PROCESS_SUPERVISOR_SENTINEL_ROLE) {
    runProcessSupervisorSentinel();
}
