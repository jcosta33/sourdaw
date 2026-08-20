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
const vitestBin = join(repoRoot, 'node_modules', '.bin', 'vitest');

function main(): number {
    const directory = mkdtempSync(join(tmpdir(), 'sourdaw-vitest-json-'));
    const jsonPath = join(directory, 'report.json');
    try {
        const result = spawnSync(
            vitestBin,
            ['run', ...process.argv.slice(2), '--reporter=default', '--reporter=json', `--outputFile=${jsonPath}`],
            { cwd: repoRoot, encoding: 'utf8', stdio: 'inherit', shell: false }
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
