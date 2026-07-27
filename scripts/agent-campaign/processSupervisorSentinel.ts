/// <reference types="node" />

import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

export const PROCESS_SUPERVISOR_SENTINEL_ROLE = '--process-supervisor-sentinel';

export type SentinelStartMessage = {
    kind: 'start';
    executable: string;
    arguments: readonly string[];
    cwd: string;
};

export type SentinelOutcomeMessage =
    { kind: 'exit'; code: number } | { kind: 'signal'; signal: NodeJS.Signals } | { kind: 'spawn-error' };

export type SentinelMessage = { kind: 'ready' } | SentinelOutcomeMessage;

const EMPTY_ENV = Object.freeze({});

function isStartMessage(value: unknown): value is SentinelStartMessage {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<SentinelStartMessage>;
    return (
        candidate.kind === 'start' &&
        typeof candidate.executable === 'string' &&
        isAbsolute(candidate.executable) &&
        Array.isArray(candidate.arguments) &&
        candidate.arguments.every((argument) => typeof argument === 'string') &&
        typeof candidate.cwd === 'string'
    );
}

function sendMessage(message: SentinelMessage): void {
    try {
        process.send?.(message);
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
        if (started || !isStartMessage(value)) {
            started = true;
            report({ kind: 'spawn-error' });
            return;
        }
        started = true;
        let executor;
        try {
            executor = spawn(value.executable, [...value.arguments], {
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
        executor.stdout.pipe(process.stdout, { end: false });
        executor.stderr.pipe(process.stderr, { end: false });
        executor.once('error', () => {
            terminal = { kind: 'spawn-error' };
        });
        executor.once('exit', (code, signal) => {
            if (signal) {
                terminal = { kind: 'signal', signal };
                return;
            }
            terminal = { kind: 'exit', code: code ?? 1 };
        });
        executor.once('close', () => report(terminal ?? { kind: 'spawn-error' }));
    });

    setInterval(() => undefined, 60_000);
    sendMessage({ kind: 'ready' });
}

if (process.argv[2] === PROCESS_SUPERVISOR_SENTINEL_ROLE) {
    runProcessSupervisorSentinel();
}
