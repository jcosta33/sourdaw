import { realpathSync } from 'node:fs';

import { canonicalPath, containsPath } from './prContract.ts';
import { parseLsofCensus, sameUserProcessIds } from './resourceGuardStorage.ts';

import type { ShellRunner } from './removeLane.ts';

/**
 * On a busy host a single census is often inconclusive: a descriptor closes mid-listing or a process
 * is born after lsof enumerated. Each attempt is still a complete, independent proof.
 */
export const CENSUS_ATTEMPTS = 4;

type Census = { kind: 'conclusive'; active: boolean } | { kind: 'inconclusive'; reason: string };

type Shell = Pick<ShellRunner, 'capture'>;

function processIsGone(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return false;
    } catch (error) {
        return error instanceof Error && 'code' in error && error.code === 'ESRCH';
    }
}

function sameUserProcesses(shell: Shell, uid: number): number[] {
    const pids = sameUserProcessIds(shell.capture('ps', ['-axo', 'pid=,uid=']), uid, process.pid, []);
    if (pids === undefined) {
        throw new Error('open-file process inspection was incomplete');
    }
    return pids;
}

function referencesPath(output: string, target: string): boolean {
    return output
        .split('\0')
        .some((field) => field.startsWith('n') && containsPath(target, canonicalPath(field.slice(1), realpathSync)));
}

function inspectOnce(target: string, uid: number, shell: Shell): Census {
    const before = sameUserProcesses(shell, uid);
    const output = shell.capture('lsof', ['-nP', '-a', '-u', String(uid), '-F0pftn'], {
        preserveStdout: true,
    });
    // Any observed reference vetoes deletion, even if an unrelated descriptor makes the full
    // catalog inconclusive. Only the complete parser below can establish absence.
    if (referencesPath(output, target)) {
        return { kind: 'conclusive', active: true };
    }
    const census = parseLsofCensus(output);
    if (census === undefined) {
        return { kind: 'inconclusive', reason: 'open-file inspection was incomplete' };
    }
    const after = sameUserProcesses(shell, uid);
    const missed = new Set<number>();
    for (const pid of new Set([...before, ...after])) {
        if (census.pids.has(pid)) {
            continue;
        }
        if (processIsGone(pid)) {
            missed.add(pid);
            continue;
        }
        return { kind: 'inconclusive', reason: 'open-file inspection omitted a live process' };
    }
    // A missed holder can fork and exit before the liveness check. Sample again after proving it
    // gone, so its heir cannot inherit an absence claim from the earlier process catalog.
    if (missed.size > 0) {
        for (const pid of sameUserProcesses(shell, uid)) {
            if (census.pids.has(pid) || missed.has(pid)) {
                continue;
            }
            if (processIsGone(pid)) {
                continue;
            }
            return { kind: 'inconclusive', reason: 'open-file inspection has an uncovered successor process' };
        }
    }
    return { kind: 'conclusive', active: false };
}

/** A successful lsof catalog may omit a live process. Absence needs complete same-user coverage. */
export function laneIsActive(path: string, shell: Shell): boolean {
    const uid = process.getuid?.();
    if (uid === undefined || process.geteuid?.() !== uid) {
        throw new Error('open-file inspection user is unknown');
    }
    const target = canonicalPath(path, realpathSync);
    let reason = '';
    for (let attempt = 0; attempt < CENSUS_ATTEMPTS; attempt++) {
        const census = inspectOnce(target, uid, shell);
        if (census.kind === 'conclusive') {
            return census.active;
        }
        reason = census.reason;
    }
    throw new Error(reason);
}
