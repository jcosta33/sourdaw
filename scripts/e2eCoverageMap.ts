import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { COVERAGE_STATUSES, type CoverageRecord, type CoverageStatus } from './e2eCoverageRecord.ts';
import { listSpecs } from './prValidationScope.ts';

/**
 * Folds the per-test records the coverage fixture in tests/e2e/e2eTest.ts
 * writes into one map from app source file to the browser specs that executed
 * it. A spec the records cannot vouch for goes to `alwaysSelect` instead, so a
 * consumer never narrows on evidence that was not collected.
 *
 *   node scripts/e2eCoverageMap.ts --records <dir> --commit <sha> --out e2e-coverage-map.json
 */

export const COVERAGE_MAP_FORMAT = 'e2e-coverage-map-v1';

export type CoverageMap = {
    format: typeof COVERAGE_MAP_FORMAT;
    commit: string;
    specs: string[];
    alwaysSelect: string[];
    files: Record<string, { blob: string; specs: number[] }>;
};

export type SpecsPerFile = { min: number; median: number; p90: number; max: number };

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStatus(value: unknown): value is CoverageStatus {
    return COVERAGE_STATUSES.some((status) => status === value);
}

function isStringList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export function parseCoverageRecord(text: string, source: string): CoverageRecord {
    const value: unknown = JSON.parse(text);
    if (
        !isRecord(value) ||
        typeof value.spec !== 'string' ||
        typeof value.testId !== 'string' ||
        typeof value.title !== 'string' ||
        !isStatus(value.status) ||
        typeof value.complete !== 'boolean' ||
        !isStringList(value.executedFiles)
    ) {
        throw new Error(`Malformed E2E coverage record: ${source}`);
    }
    return {
        spec: value.spec,
        testId: value.testId,
        title: value.title,
        status: value.status,
        complete: value.complete,
        executedFiles: value.executedFiles,
    };
}

function contributes(record: CoverageRecord): boolean {
    return record.complete && record.status === 'passed';
}

export function buildCoverageMap(input: {
    commit: string;
    specs: readonly string[];
    records: readonly CoverageRecord[];
    blobs: ReadonlyMap<string, string>;
}): CoverageMap {
    const specs = [...new Set(input.specs)].sort();
    if (specs.length === 0) {
        throw new Error('The browser spec inventory is empty');
    }
    if (input.records.length === 0) {
        throw new Error('No E2E coverage records were written');
    }
    const indexOf = new Map(specs.map((spec, index) => [spec, index]));
    const recorded = new Set(input.records.map((record) => record.spec));
    const alwaysSelect = new Set(specs.filter((spec) => !recorded.has(spec)));
    const specsByFile = new Map<string, Set<number>>();
    for (const record of input.records) {
        const index = indexOf.get(record.spec);
        if (index === undefined) {
            throw new Error(`Coverage record for a spec outside the inventory: ${record.spec}`);
        }
        if (!contributes(record)) {
            alwaysSelect.add(record.spec);
            continue;
        }
        for (const file of record.executedFiles) {
            const indices = specsByFile.get(file) ?? new Set<number>();
            indices.add(index);
            specsByFile.set(file, indices);
        }
    }
    const files: CoverageMap['files'] = {};
    const untracked: string[] = [];
    for (const [path, indices] of [...specsByFile].sort(([left], [right]) => (left < right ? -1 : 1))) {
        const blob = input.blobs.get(path);
        if (blob === undefined) {
            untracked.push(path);
            continue;
        }
        files[path] = { blob, specs: [...indices].sort((left, right) => left - right) };
    }
    if (untracked.length > 0) {
        throw new Error(`Executed files absent from ${input.commit}: ${untracked.join(', ')}`);
    }
    return {
        format: COVERAGE_MAP_FORMAT,
        commit: input.commit,
        specs,
        alwaysSelect: [...alwaysSelect].sort(),
        files,
    };
}

// Nearest-rank percentile over an ascending list.
function percentile(sorted: readonly number[], fraction: number): number {
    return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
}

/** How many specs execute each file: the narrowing a consumer of the map can expect. */
export function specsPerFile(map: CoverageMap): SpecsPerFile | null {
    const counts = Object.values(map.files)
        .map((file) => file.specs.length)
        .sort((left, right) => left - right);
    if (counts.length === 0) {
        return null;
    }
    return {
        min: counts[0] ?? 0,
        median: percentile(counts, 0.5),
        p90: percentile(counts, 0.9),
        max: counts.at(-1) ?? 0,
    };
}

export function summarizeCoverageMap(map: CoverageMap): string {
    const distribution = specsPerFile(map);
    const spread =
        distribution === null
            ? 'none'
            : `min ${distribution.min}, median ${distribution.median}, p90 ${distribution.p90}, max ${distribution.max}`;
    return [
        `### E2E coverage map for ${map.commit}`,
        '',
        `- Specs: ${map.specs.length}`,
        `- Always selected: ${map.alwaysSelect.length}`,
        `- Files: ${Object.keys(map.files).length}`,
        `- Specs per file: ${spread}`,
        '',
    ].join('\n');
}

function readRecords(directory: string): CoverageRecord[] {
    const recordFiles = readdirSync(directory, { recursive: true, withFileTypes: true }).filter(
        (entry) => entry.isFile() && entry.name.endsWith('.json')
    );
    return recordFiles.map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return parseCoverageRecord(readFileSync(path, 'utf8'), path);
    });
}

function readBlobs(root: string, commit: string): Map<string, string> {
    const listing = execFileSync('git', ['ls-tree', '-r', '-z', '--full-tree', commit], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
    const blobs = new Map<string, string>();
    for (const line of listing.split('\0')) {
        const match = /^\d+ blob ([0-9a-f]{40})\t(.+)$/s.exec(line);
        if (match?.[1] !== undefined && match[2] !== undefined) {
            blobs.set(match[2], match[1]);
        }
    }
    return blobs;
}

function main(): void {
    const { values } = parseArgs({
        options: { records: { type: 'string' }, commit: { type: 'string' }, out: { type: 'string' } },
    });
    const { records: directory, commit, out } = values;
    if (!directory || !out || !commit || !/^[0-9a-f]{40}$/.test(commit)) {
        throw new Error('Usage: --records <dir> --commit <40-hex sha> --out <file>');
    }
    const root = process.cwd();
    const map = buildCoverageMap({
        commit,
        specs: listSpecs(root),
        records: readRecords(directory),
        blobs: readBlobs(root, commit),
    });
    writeFileSync(out, `${JSON.stringify(map, null, 2)}\n`);
    const summary = summarizeCoverageMap(map);
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (error: unknown) {
        console.error(error);
        process.exitCode = 1;
    }
}
