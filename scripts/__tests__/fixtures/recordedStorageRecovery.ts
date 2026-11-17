import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

import { runGuardedCommand, storageFileState } from '../../resourceGuard.ts';

// One guarded start, in its own process so that a claim it leaves names a reclaimer that dies
// with it. It records every file census its recovery took of the watched storage.
const [optionsArgument, watchedPath, resultPath] = process.argv.slice(2);
if (optionsArgument === undefined || watchedPath === undefined || resultPath === undefined) {
    throw new Error('recorded storage recovery requires options, watched directories and a result path');
}
const watched: string[] = JSON.parse(readFileSync(watchedPath, 'utf8'));
const censuses: { verdict: 'alive' | 'dead' | 'unknown'; reasons: string[] }[] = [];
const result = await runGuardedCommand({
    ...JSON.parse(optionsArgument),
    storageHost: {
        fileState: (tempDirectories, ownedPids, report, supervisorPid, ownerStartTicks) => {
            const reasons: string[] = [];
            const verdict = storageFileState(
                tempDirectories,
                ownedPids,
                (reason) => {
                    reasons.push(reason);
                    report(reason);
                },
                supervisorPid,
                ownerStartTicks
            );
            if (tempDirectories.some((directory) => watched.includes(directory))) {
                censuses.push({ verdict, reasons });
            }
            return verdict;
        },
    },
});
const pending = `${resultPath}.${randomUUID()}.pending`;
writeFileSync(pending, JSON.stringify({ code: result.code, reason: result.reason, output: result.output, censuses }));
renameSync(pending, resultPath);
