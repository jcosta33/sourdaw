import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { captureProcessGroupOfPid, type ProcessGroupSnapshot } from './processSnapshot.ts';

export const VITEST_PROGRESS_ENV = 'SOURDAW_VITEST_PROGRESS';

type ProgressEvent =
    'runner-start' | 'module-queued' | 'worker-setup' | 'module-collected' | 'test-start' | 'scan' | 'module-failure';

/** Latest event per stage; slots are independent and do not form a correlated timeline. */
export function recordVitestProgress(
    event: ProgressEvent,
    detail = '',
    observation?: { monotonicNs: string; processGroup: ProcessGroupSnapshot }
): void {
    const directory = process.env[VITEST_PROGRESS_ENV];
    if (!directory) {
        return;
    }
    const temporary = join(directory, `.${event}-${process.pid % 16}.tmp`);
    let owned = false;
    try {
        writeFileSync(
            temporary,
            JSON.stringify({
                event,
                monotonicNs: process.hrtime.bigint().toString(),
                pid: process.pid,
                parentPid: process.ppid,
                detail: detail.slice(0, 512),
                ...(observation === undefined ? {} : { observation }),
            }),
            { mode: 0o600, flag: 'wx' }
        );
        owned = true;
        renameSync(temporary, join(directory, `${event}.json`));
    } catch {
        // Diagnostics must never change test execution.
        if (owned) {
            try {
                rmSync(temporary, { force: true });
            } catch {
                /* Best effort. */
            }
        }
    }
}

/** The first failed module is observed before Vitest tears the runner down. */
export function recordVitestModuleFailure(moduleId: string): void {
    if (!process.env[VITEST_PROGRESS_ENV]) {
        return;
    }
    try {
        const monotonicNs = process.hrtime.bigint().toString();
        const processGroup = captureProcessGroupOfPid(process.pid);
        recordVitestProgress('module-failure', moduleId, { monotonicNs, processGroup });
    } catch {
        // An unavailable diagnostic must not alter the test result.
    }
}

export function createVitestProgress(env: NodeJS.ProcessEnv): string | undefined {
    try {
        const root = env.SOURDAW_VITEST_DIAGNOSTICS_DIR ?? join(homedir(), '.cache', 'sourdaw', 'vitest-progress');
        mkdirSync(root, { recursive: true, mode: 0o700 });
        return mkdtempSync(join(root, 'vitest-progress-'));
    } catch {
        return undefined;
    }
}

export function summarizeVitestProgress(directory: string): string {
    try {
        const names = readdirSync(directory)
            .filter((name) => name.endsWith('.json'))
            .sort();
        const records = names.map((name) => readFileSync(join(directory, name), 'utf8'));
        return records.join('\n');
    } catch {
        return 'progress unavailable';
    }
}

export function removeVitestProgress(directory: string): void {
    try {
        rmSync(directory, { recursive: true, force: true });
    } catch {
        // A retained journal is preferable to changing the result.
    }
}
