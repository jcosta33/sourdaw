/// <reference types="node" />

import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

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
        const handleDestinationError = (source: typeof trustedExecutor.stdout, destination: NodeJS.WriteStream) => {
            terminal = { kind: 'spawn-error' };
            source.unpipe(destination);
            source.resume();
        };
        const stdoutError = () => handleDestinationError(trustedExecutor.stdout, process.stdout);
        const stderrError = () => handleDestinationError(trustedExecutor.stderr, process.stderr);
        process.stdout.on('error', stdoutError);
        process.stderr.on('error', stderrError);
        trustedExecutor.stdout.pipe(process.stdout, { end: false });
        trustedExecutor.stderr.pipe(process.stderr, { end: false });
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
            process.stdout.off('error', stdoutError);
            process.stderr.off('error', stderrError);
            report(terminal ?? { kind: 'spawn-error' });
        });
    });

    setInterval(() => undefined, 60_000);
    sendMessage({ kind: 'ready' });
}

if (process.argv[2] === PROCESS_SUPERVISOR_SENTINEL_ROLE) {
    runProcessSupervisorSentinel();
}
