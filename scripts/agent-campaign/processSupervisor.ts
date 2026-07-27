/// <reference types="node" />

import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    PROCESS_SUPERVISOR_SENTINEL_ROLE,
    type SentinelOutcomeMessage,
    type TrustedCodeOwnedExecutorStartMessage,
} from './processSupervisorSentinel.ts';

// This supervisor provides deterministic lifecycle cleanup for trusted, code-owned executors.
// Process-group termination is not a sandbox; executors must not detach descendants or signal the sentinel.
export type TrustedProcessSupervisorInput = {
    executable: string;
    arguments: readonly string[];
    cwd: string;
    timeoutMs: number;
};

export type ProcessSupervisorReason =
    | SentinelOutcomeMessage
    | { kind: 'timeout' }
    | { kind: 'malformed-ipc' }
    | { kind: 'sentinel-failure' }
    | { kind: 'launch-error' }
    | { kind: 'unsupported-platform' }
    | { kind: 'termination-unconfirmed' };

export type ProcessSupervisorResult = {
    reason: ProcessSupervisorReason;
    streamEvidence: null;
};

export type ProcessSupervisorDependencies = {
    platform: NodeJS.Platform;
    sentinelPath: () => string;
    startupTimeoutMs: number;
    cleanupPollMs: number;
    cleanupTimeoutMs: number;
    groupExists: (processGroupId: number) => boolean;
    killGroup: (processGroupId: number) => void;
};

const EMPTY_ENV = Object.freeze({});

function groupExists(processGroupId: number): boolean {
    try {
        process.kill(-processGroupId, 0);
        return true;
    } catch (error) {
        return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
    }
}

function killGroup(processGroupId: number): void {
    try {
        process.kill(-processGroupId, 'SIGKILL');
    } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
            throw error;
        }
    }
}

const defaultDependencies: ProcessSupervisorDependencies = {
    platform: process.platform,
    sentinelPath: () => fileURLToPath(new URL('./processSupervisorSentinel.ts', import.meta.url)),
    startupTimeoutMs: 2_000,
    cleanupPollMs: 5,
    cleanupTimeoutMs: 2_000,
    groupExists,
    killGroup,
};

function isAbsolutePath(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && !value.includes('\0') && isAbsolute(value);
}

function snapshotInput(input: TrustedProcessSupervisorInput): TrustedProcessSupervisorInput | null {
    try {
        const snapshot = Object.freeze({
            executable: input.executable,
            arguments: Object.freeze([...input.arguments]),
            cwd: input.cwd,
            timeoutMs: input.timeoutMs,
        });
        if (
            !isAbsolutePath(snapshot.executable) ||
            !snapshot.arguments.every((argument) => typeof argument === 'string' && !argument.includes('\0')) ||
            !isAbsolutePath(snapshot.cwd) ||
            !Number.isSafeInteger(snapshot.timeoutMs) ||
            snapshot.timeoutMs <= 0
        ) {
            return null;
        }
        return snapshot;
    } catch {
        return null;
    }
}

function parseSentinelMessage(value: unknown): { kind: 'ready' } | SentinelOutcomeMessage | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    const candidate = value as Record<string, unknown>;
    const keys = Object.keys(candidate);
    if (candidate.kind === 'ready' && keys.length === 1) {
        return { kind: 'ready' };
    }
    if (candidate.kind === 'spawn-error' && keys.length === 1) {
        return { kind: 'spawn-error' };
    }
    if (
        candidate.kind === 'exit' &&
        keys.length === 2 &&
        Number.isSafeInteger(candidate.code) &&
        Number(candidate.code) >= 0 &&
        Number(candidate.code) <= 255
    ) {
        return { kind: 'exit', code: Number(candidate.code) };
    }
    if (
        candidate.kind === 'signal' &&
        keys.length === 2 &&
        typeof candidate.signal === 'string' &&
        Object.hasOwn(osConstants.signals, candidate.signal)
    ) {
        return { kind: 'signal', signal: candidate.signal as NodeJS.Signals };
    }
    return null;
}

function waitForGroup(processGroupId: number, dependencies: ProcessSupervisorDependencies): Promise<boolean> {
    return new Promise((resolve) => {
        let pollTimer: ReturnType<typeof setTimeout> | undefined;
        let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
        let settled = false;
        const finish = (confirmed: boolean) => {
            if (settled) {
                return;
            }
            settled = true;
            if (pollTimer) {
                clearTimeout(pollTimer);
            }
            if (deadlineTimer) {
                clearTimeout(deadlineTimer);
            }
            resolve(confirmed);
        };
        const poll = () => {
            try {
                if (!dependencies.groupExists(processGroupId)) {
                    finish(true);
                    return;
                }
            } catch {
                finish(false);
                return;
            }
            pollTimer = setTimeout(poll, dependencies.cleanupPollMs);
        };
        deadlineTimer = setTimeout(() => finish(false), dependencies.cleanupTimeoutMs);
        poll();
    });
}

export function superviseTrustedProcess(
    input: TrustedProcessSupervisorInput,
    dependencyOverrides: Partial<ProcessSupervisorDependencies> = {}
): Promise<ProcessSupervisorResult> {
    const dependencies = { ...defaultDependencies, ...dependencyOverrides };
    const result = (reason: ProcessSupervisorReason): ProcessSupervisorResult => ({ reason, streamEvidence: null });
    if (dependencies.platform !== 'darwin') {
        return Promise.resolve(result({ kind: 'unsupported-platform' }));
    }
    const snapshot = snapshotInput(input);
    if (!snapshot) {
        return Promise.resolve(result({ kind: 'launch-error' }));
    }
    let sentinelPath: string;
    try {
        sentinelPath = dependencies.sentinelPath();
        if (!isAbsolutePath(sentinelPath)) {
            throw new Error('invalid sentinel path');
        }
    } catch {
        return Promise.resolve(result({ kind: 'launch-error' }));
    }

    return new Promise((resolve) => {
        let sentinel;
        try {
            sentinel = spawn(
                process.execPath,
                ['--no-warnings', '--experimental-strip-types', sentinelPath, PROCESS_SUPERVISOR_SENTINEL_ROLE],
                {
                    detached: true,
                    env: EMPTY_ENV,
                    shell: false,
                    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
                }
            );
        } catch {
            resolve(result({ kind: 'launch-error' }));
            return;
        }
        const processGroupId = sentinel.pid;
        let reason: ProcessSupervisorReason | null = null;
        let cleanupConfirmed: boolean | null = null;
        let closed = false;
        let started = false;
        let settled = false;
        let executorTimer: ReturnType<typeof setTimeout> | undefined;
        let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

        const finish = (finalReason: ProcessSupervisorReason) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(startupTimer);
            if (executorTimer) {
                clearTimeout(executorTimer);
            }
            if (cleanupTimer) {
                clearTimeout(cleanupTimer);
            }
            sentinel.removeAllListeners();
            try {
                sentinel.disconnect();
            } catch {
                // The sentinel may already have closed its IPC channel.
            }
            sentinel.unref();
            resolve(result(finalReason));
        };
        const maybeFinish = () => {
            if (cleanupConfirmed === false) {
                finish({ kind: 'termination-unconfirmed' });
            } else if (cleanupConfirmed && closed && reason) {
                finish(reason);
            }
        };
        const stopGroup = (nextReason: ProcessSupervisorReason) => {
            if (reason) {
                return;
            }
            reason = nextReason;
            clearTimeout(startupTimer);
            if (executorTimer) {
                clearTimeout(executorTimer);
            }
            cleanupTimer = setTimeout(() => finish({ kind: 'termination-unconfirmed' }), dependencies.cleanupTimeoutMs);
            if (processGroupId === undefined) {
                cleanupConfirmed = true;
                maybeFinish();
                return;
            }
            try {
                dependencies.killGroup(processGroupId);
            } catch {
                // Bounded confirmation below decides whether termination succeeded.
            }
            void waitForGroup(processGroupId, dependencies).then((confirmed) => {
                cleanupConfirmed = confirmed;
                return maybeFinish();
            });
        };
        sentinel.on('message', (value) => {
            const message = parseSentinelMessage(value);
            if (!message || (message.kind === 'ready' && started) || (message.kind !== 'ready' && !started)) {
                stopGroup({ kind: 'malformed-ipc' });
                return;
            }
            if (message.kind === 'ready') {
                started = true;
                clearTimeout(startupTimer);
                const startMessage: TrustedCodeOwnedExecutorStartMessage = {
                    kind: 'start-trusted-code-owned-executor',
                    executable: snapshot.executable,
                    arguments: snapshot.arguments,
                    cwd: snapshot.cwd,
                };
                executorTimer = setTimeout(() => stopGroup({ kind: 'timeout' }), snapshot.timeoutMs);
                try {
                    sentinel.send(startMessage, (error) => {
                        if (error) {
                            stopGroup({ kind: 'launch-error' });
                        }
                    });
                } catch {
                    stopGroup({ kind: 'launch-error' });
                }
                return;
            }
            stopGroup(message);
        });
        sentinel.once('error', () => stopGroup({ kind: started ? 'sentinel-failure' : 'launch-error' }));
        sentinel.once('disconnect', () => stopGroup({ kind: started ? 'sentinel-failure' : 'launch-error' }));
        sentinel.once('exit', () => {
            if (!reason) {
                stopGroup({ kind: 'sentinel-failure' });
            }
        });
        sentinel.once('close', () => {
            closed = true;
            if (!reason) {
                stopGroup({ kind: 'sentinel-failure' });
            }
            maybeFinish();
        });
        const startupTimer = setTimeout(() => stopGroup({ kind: 'sentinel-failure' }), dependencies.startupTimeoutMs);
    });
}
