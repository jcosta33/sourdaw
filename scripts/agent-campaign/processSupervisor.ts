/// <reference types="node" />

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export type ProcessSupervisorInput = {
    executable: string;
    arguments: readonly string[];
    cwd: string;
    timeoutMs: number;
    outputLimitBytes: number;
};

export type ProcessSupervisorReason =
    | { kind: 'exit'; code: number }
    | { kind: 'signal'; signal: NodeJS.Signals }
    | { kind: 'timeout' }
    | { kind: 'output-limit' }
    | { kind: 'spawn-error' }
    | { kind: 'unsupported-platform' };

export type ProcessSupervisorResult = {
    reason: ProcessSupervisorReason;
    stdout: { sha256: string; bytes: number };
    stderr: { sha256: string; bytes: number };
};

const GROUP_POLL_MS = 5;
const EMPTY_ENV = Object.freeze({});

function processGroupExists(processGroupId: number): boolean {
    try {
        process.kill(-processGroupId, 0);
        return true;
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
            return false;
        }
        return true;
    }
}

function killProcessGroup(processGroupId: number): void {
    try {
        process.kill(-processGroupId, 'SIGKILL');
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
            throw error;
        }
    }
}

function waitForProcessGroup(processGroupId: number): Promise<void> {
    return new Promise((resolve) => {
        const poll = () => {
            if (!processGroupExists(processGroupId)) {
                resolve();
                return;
            }
            setTimeout(poll, GROUP_POLL_MS);
        };
        poll();
    });
}

export function superviseProcess(input: ProcessSupervisorInput): Promise<ProcessSupervisorResult> {
    const stdoutHash = createHash('sha256');
    const stderrHash = createHash('sha256');
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const result = (reason: ProcessSupervisorReason): ProcessSupervisorResult => ({
        reason,
        stdout: { sha256: stdoutHash.digest('hex'), bytes: stdoutBytes },
        stderr: { sha256: stderrHash.digest('hex'), bytes: stderrBytes },
    });

    if (process.platform !== 'darwin') {
        return Promise.resolve(result({ kind: 'unsupported-platform' }));
    }
    if (
        !Number.isSafeInteger(input.timeoutMs) ||
        input.timeoutMs <= 0 ||
        !Number.isSafeInteger(input.outputLimitBytes) ||
        input.outputLimitBytes <= 0
    ) {
        return Promise.resolve(result({ kind: 'spawn-error' }));
    }

    return new Promise((resolve) => {
        const child = spawn(input.executable, [...input.arguments], {
            cwd: input.cwd,
            detached: true,
            env: EMPTY_ENV,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const processGroupId = child.pid;
        let reason: ProcessSupervisorReason | null = null;
        let finalizing = false;

        const stopGroup = (nextReason: ProcessSupervisorReason) => {
            reason ??= nextReason;
            if (processGroupId !== undefined) {
                killProcessGroup(processGroupId);
            }
        };
        const absorb = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
            const remainingBytes = input.outputLimitBytes - stdoutBytes - stderrBytes;
            if (remainingBytes < 0) {
                return;
            }
            const observedChunk = chunk.byteLength > remainingBytes ? chunk.subarray(0, remainingBytes + 1) : chunk;
            if (stream === 'stdout') {
                stdoutHash.update(observedChunk);
                stdoutBytes += observedChunk.byteLength;
            } else {
                stderrHash.update(observedChunk);
                stderrBytes += observedChunk.byteLength;
            }
            if (stdoutBytes + stderrBytes > input.outputLimitBytes) {
                stopGroup({ kind: 'output-limit' });
            }
        };

        child.stdout.on('data', (chunk: Buffer) => absorb('stdout', chunk));
        child.stderr.on('data', (chunk: Buffer) => absorb('stderr', chunk));
        child.once('error', () => stopGroup({ kind: 'spawn-error' }));
        child.once('exit', (code, signal) => {
            if (signal) {
                stopGroup({ kind: 'signal', signal });
                return;
            }
            stopGroup({ kind: 'exit', code: code ?? 1 });
        });

        const timer = setTimeout(() => stopGroup({ kind: 'timeout' }), input.timeoutMs);
        child.once('close', () => {
            if (finalizing) {
                return;
            }
            finalizing = true;
            clearTimeout(timer);
            const finalReason = reason ?? { kind: 'spawn-error' };
            const finish = processGroupId === undefined ? Promise.resolve() : waitForProcessGroup(processGroupId);
            void finish.then(() => resolve(result(finalReason)));
        });
    });
}
