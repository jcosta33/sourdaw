#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

import { cleanupFailureReason, readCleanupRecords, runCleanup } from './cleanupLanes.ts';
import { assertTrustedImportClosure, resolvePrimaryRoot } from './githubAppIdentity.ts';
import { snapshotImportSpecifiers } from './trustedGithubWriteBootstrap.ts';

async function main(): Promise<number> {
    try {
        const args = process.argv.slice(2);
        const primaryRoot = resolvePrimaryRoot();
        if (args[0] === '--status' && args.length === 1) {
            for (const record of readCleanupRecords(primaryRoot)) {
                console.log(`${record.status} ${record.identity.path}: ${record.reason}`);
            }
            return 0;
        }
        if (args.length > 0) {
            throw new Error('usage: pnpm lane:cleanup [--status]');
        }
        // `lane:cleanup` refuses unless its whole relative-import closure matches origin/main. The
        // check runs after the module graph is evaluated, so it guards the modules' behaviour, not
        // their import-time side effects.
        assertTrustedImportClosure(fileURLToPath(import.meta.url), primaryRoot, snapshotImportSpecifiers);
        await runCleanup(primaryRoot);
        return 0;
    } catch (error) {
        console.error(cleanupFailureReason(error));
        return 1;
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    void main().then((code) => {
        process.exitCode = code;
    });
}
