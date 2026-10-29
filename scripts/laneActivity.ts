import { realpathSync } from 'node:fs';

import { canonicalPath, containsPath } from './prContract.ts';
import { parseLsofCensus, sameUserProcessIds } from './resourceGuardStorage.ts';

import type { ShellRunner } from './removeLane.ts';

/** A successful lsof catalog may omit a live process. Absence needs complete same-user coverage. */
export function laneIsActive(path: string, shell: Pick<ShellRunner, 'capture'>): boolean {
    const uid = process.getuid?.();
    if (uid === undefined || process.geteuid?.() !== uid) {
        throw new Error('open-file inspection user is unknown');
    }
    const users = () => {
        const pids = sameUserProcessIds(shell.capture('ps', ['-axo', 'pid=,uid=']), uid, process.pid, []);
        if (pids === undefined) {
            throw new Error('open-file process inspection was incomplete');
        }
        return pids;
    };
    const before = users();
    const output = shell.capture('lsof', ['-nP', '-a', '-u', String(uid), '-F0pftn'], {
        preserveStdout: true,
    });
    const target = canonicalPath(path, realpathSync);
    // Any observed reference vetoes deletion, even if an unrelated descriptor makes the full
    // catalog inconclusive. Only the complete parser below can establish absence.
    if (
        output
            .split('\0')
            .some((field) => field.startsWith('n') && containsPath(target, canonicalPath(field.slice(1), realpathSync)))
    ) {
        return true;
    }
    const census = parseLsofCensus(output);
    if (census === undefined) {
        throw new Error('open-file inspection was incomplete');
    }
    const after = users();
    const missed = new Set<number>();
    for (const pid of new Set([...before, ...after])) {
        if (census.pids.has(pid)) {
            continue;
        }
        try {
            process.kill(pid, 0);
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
                missed.add(pid);
                continue;
            }
        }
        throw new Error('open-file inspection omitted a live process');
    }
    // A missed holder can fork and exit before the liveness check. Sample again after proving it
    // gone, so its heir cannot inherit an absence claim from the earlier process catalog.
    if (missed.size > 0) {
        for (const pid of users()) {
            if (census.pids.has(pid) || missed.has(pid)) continue;
            try {
                process.kill(pid, 0);
            } catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 'ESRCH') continue;
            }
            throw new Error('open-file inspection has an uncovered successor process');
        }
    }
    return false;
}
