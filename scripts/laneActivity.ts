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

type DirectInspection = { kind: 'observed'; pids: ReadonlySet<number>; gone: number[] } | Census;

type Shell = Pick<ShellRunner, 'capture'>;

const INCOMPLETE = 'open-file inspection was incomplete';

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

/** Splits processes a catalog omitted into those still running and those that have exited. */
function uncataloged(pids: Iterable<number>, catalog: ReadonlySet<number>): { live: number[]; gone: number[] } {
    const live: number[] = [];
    const gone: number[] = [];
    for (const pid of new Set(pids)) {
        if (catalog.has(pid)) {
            continue;
        }
        if (processIsGone(pid)) {
            gone.push(pid);
        } else {
            live.push(pid);
        }
    }
    return { live, gone };
}

/** Catalogs exactly the processes a broader census omitted; each must be observed or have exited. */
function inspectDirectly(target: string, pids: number[], shell: Shell, omission: string): DirectInspection {
    if (pids.length === 0) {
        return { kind: 'observed', pids: new Set(), gone: [] };
    }
    const output = shell.capture('lsof', ['-nP', '-a', '-p', pids.join(','), '-F0pftn'], {
        preserveStdout: true,
        unmatchedProcesses: 'allowed',
    });
    if (referencesPath(output, target)) {
        return { kind: 'conclusive', active: true };
    }
    // lsof prints nothing when every selected process exited before it read them.
    const catalog = output === '' ? new Set<number>() : parseLsofCensus(output)?.pids;
    if (catalog === undefined) {
        return { kind: 'inconclusive', reason: INCOMPLETE };
    }
    const { live, gone } = uncataloged(pids, catalog);
    if (live.length > 0) {
        return { kind: 'inconclusive', reason: omission };
    }
    return { kind: 'observed', pids: catalog, gone };
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
        return { kind: 'inconclusive', reason: INCOMPLETE };
    }
    const after = sameUserProcesses(shell, uid);
    const omitted = uncataloged([...before, ...after], census.pids);
    const direct = inspectDirectly(target, omitted.live, shell, 'open-file inspection omitted a live process');
    if (direct.kind !== 'observed') {
        return direct;
    }
    const missed = new Set([...omitted.gone, ...direct.gone]);
    if (missed.size === 0) {
        return { kind: 'conclusive', active: false };
    }
    // A missed holder can fork and exit before the liveness check. Sample again after proving it
    // gone, so its heir cannot inherit an absence claim from the earlier process catalog.
    const observed = new Set([...census.pids, ...direct.pids, ...missed]);
    const successors = uncataloged(sameUserProcesses(shell, uid), observed);
    const heirs = inspectDirectly(
        target,
        successors.live,
        shell,
        'open-file inspection has an uncovered successor process'
    );
    if (heirs.kind !== 'observed') {
        return heirs;
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
