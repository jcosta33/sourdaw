#!/usr/bin/env node
/**
 * `pnpm test:run` wrapper. Vitest's default reporter can print `(0 test)` among
 * passes when `passWithNoTests` is on or a collected file records a passed
 * suite with no assertions. The JSON report is the independent count (#2352).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    formatSilentZeroCollectionFailure,
    readVitestJsonReport,
    silentZeroCollectedFiles,
    type VitestJsonReport,
} from './vitestZeroTestReport.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const productionVitestBin = join(repoRoot, 'node_modules', '.bin', 'vitest');

export type ZeroTestGuardOptions = {
    vitestBin: string;
    args: readonly string[];
    cwd: string;
    stdio?: 'inherit' | 'pipe';
    env?: NodeJS.ProcessEnv;
};

export function runZeroTestGuard(options: ZeroTestGuardOptions): number {
    const directory = mkdtempSync(join(tmpdir(), 'sourdaw-vitest-json-'));
    const jsonPath = join(directory, 'report.json');
    try {
        const result = spawnSync(
            options.vitestBin,
            ['run', ...options.args, '--reporter=default', '--reporter=json', `--outputFile=${jsonPath}`],
            {
                cwd: options.cwd,
                encoding: 'utf8',
                stdio: options.stdio ?? 'inherit',
                shell: false,
                env: options.env === undefined ? undefined : { ...process.env, ...options.env },
            }
        );
        const vitestStatus = result.status ?? 1;
        let report: VitestJsonReport;
        try {
            report = readVitestJsonReport(readFileSync(jsonPath, 'utf8'));
        } catch {
            return vitestStatus === 0 ? 1 : vitestStatus;
        }
        const silent = silentZeroCollectedFiles(report);
        if (silent.length > 0) {
            console.error(formatSilentZeroCollectionFailure(silent));
            return 1;
        }
        return vitestStatus;
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

function main(): number {
    return runZeroTestGuard({
        vitestBin: productionVitestBin,
        args: process.argv.slice(2),
        cwd: repoRoot,
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
