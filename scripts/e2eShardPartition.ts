import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Recorded seconds each browser file took on CI, keyed by repository path.
 * The table ships beside the planner, so it resolves from this module rather
 * than the working directory. Refresh it from a green full-coverage run:
 *
 *   gh run download <run-id> -p 'e2e-blob-*' -D blobs
 *   mkdir all && cp blobs/e2e-blob-<shard>/*.zip all/
 *   pnpm exec playwright merge-reports --reporter=json all > report.json
 *   node scripts/e2eShardPartition.ts refresh report.json
 */
const SPEC_DURATIONS_PATH = resolve(import.meta.dirname, 'e2eSpecDurations.json');

const E2E_ROOT = 'tests/e2e';

export type SpecDurations = ReadonlyMap<string, number>;

type ReportSuite = {
    file?: string;
    specs?: { tests: { results: { duration: number }[] }[] }[];
    suites?: ReportSuite[];
};
type Report = {
    config: { rootDir: string };
    suites: ReportSuite[];
    stats: { unexpected: number; flaky: number };
};

export function parseSpecDurations(text: string): SpecDurations {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('E2E spec durations must be an object of seconds by path');
    }
    const durations = new Map<string, number>();
    for (const [path, seconds] of Object.entries(value)) {
        if (
            !path.startsWith(`${E2E_ROOT}/`) ||
            typeof seconds !== 'number' ||
            !Number.isFinite(seconds) ||
            seconds <= 0
        ) {
            throw new Error(`Invalid E2E spec duration: ${path}`);
        }
        durations.set(path, seconds);
    }
    return durations;
}

export function readSpecDurations(): SpecDurations {
    return parseSpecDurations(readFileSync(SPEC_DURATIONS_PATH, 'utf8'));
}

// A file without a recording (new since the last refresh) weighs as a typical file.
function medianDuration(durations: SpecDurations): number {
    const sorted = [...durations.values()].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)] ?? 1;
}

/**
 * Longest-first greedy partition: each file joins the group with the least
 * recorded time so far, ties going to the lower group. Equal weights therefore
 * reduce to round-robin over the sorted paths.
 */
export function partitionByDuration(specs: readonly string[], durations: SpecDurations, count: number): string[][] {
    if (!Number.isInteger(count) || count < 1 || count > specs.length) {
        throw new Error('Invalid E2E partition');
    }
    const fallback = medianDuration(durations);
    const weight = (spec: string): number => durations.get(spec) ?? fallback;
    const ordered = [...specs].sort((left, right) => {
        const difference = weight(right) - weight(left);
        if (difference !== 0) {
            return difference;
        }
        return left < right ? -1 : 1;
    });
    const groups = Array.from({ length: count }, () => ({ load: 0, specs: [] as string[] }));
    for (const spec of ordered) {
        let lightest = groups[0];
        for (const group of groups) {
            if (lightest === undefined || group.load < lightest.load) {
                lightest = group;
            }
        }
        if (lightest === undefined) {
            throw new Error('Invalid E2E partition');
        }
        lightest.specs.push(spec);
        lightest.load += weight(spec);
    }
    return groups.map((group) => group.specs.sort());
}

function addSuiteDurations(suite: ReportSuite, file: string | undefined, totals: Map<string, number>): void {
    const owner = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
        if (owner === undefined) {
            throw new Error('Report spec has no owning file');
        }
        const path = `${E2E_ROOT}/${owner}`;
        for (const test of spec.tests) {
            for (const result of test.results) {
                totals.set(path, (totals.get(path) ?? 0) + result.duration / 1000);
            }
        }
    }
    for (const child of suite.suites ?? []) {
        addSuiteDurations(child, owner, totals);
    }
}

export function specDurationsFromReport(text: string): Record<string, number> {
    const report = JSON.parse(text) as Report;
    if (!report.config.rootDir.endsWith(`/${E2E_ROOT}`)) {
        throw new Error(`Report root is not ${E2E_ROOT}: ${report.config.rootDir}`);
    }
    if (report.stats.unexpected !== 0 || report.stats.flaky !== 0) {
        throw new Error('Refresh durations only from a run without failed or flaky tests');
    }
    const totals = new Map<string, number>();
    for (const suite of report.suites) {
        addSuiteDurations(suite, undefined, totals);
    }
    const durations: Record<string, number> = {};
    for (const path of [...totals.keys()].sort()) {
        // A file whose tests finished in well under a tenth of a second still costs a slot.
        durations[path] = Math.max(0.1, Math.round((totals.get(path) ?? 0) * 10) / 10);
    }
    return durations;
}

function main(): void {
    const [command, reportPath] = process.argv.slice(2);
    if (command !== 'refresh' || reportPath === undefined) {
        throw new Error('Usage: node scripts/e2eShardPartition.ts refresh <merged-json-report>');
    }
    const durations = specDurationsFromReport(readFileSync(reportPath, 'utf8'));
    writeFileSync(SPEC_DURATIONS_PATH, `${JSON.stringify(durations, null, 4)}\n`);
    console.log(`Recorded ${Object.keys(durations).length} browser files in ${SPEC_DURATIONS_PATH}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
