/**
 * Guard: the size/nesting-ceiling burn-down baseline stays honest.
 *
 * eslint.config.mjs downgrades `max-lines`, `max-lines-per-function`,
 * `max-depth`, and `complexity` from `error` to `warn` for exactly the paths
 * listed in eslint.size-baseline.mjs (docs/07-conventions.md — Lint-aligned
 * conventions). That override only burns down if the list can only shrink:
 * a path that no longer exists (moved or deleted) must be removed by hand, and
 * a duplicate or an out-of-order entry would let a merge quietly re-add a path
 * that already left the list.
 *
 * The `warn` downgrade alone would let a listed file grow without bound, so
 * scripts/lintSizeCeilings.json records one line ceiling per listed file: a
 * file may not exceed its ceiling, a ceiling left more than the slack above a
 * file that shrank must be lowered, and the ceilings file lists exactly the
 * baseline paths (scripts/lintSizeCeilings.ts holds the rule).
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { sizeBaselineFiles } from '../../eslint.size-baseline.mjs';
import {
    countFileLines,
    describeSizeCeilingViolation,
    findSizeCeilingViolations,
    readSizeCeilings,
    type SizeCeilingViolation,
} from '../lintSizeCeilings';

const repoRoot = resolve(import.meta.dirname, '../..');

describe('eslint size-ceiling baseline', () => {
    it('should not be empty, so the checks below cannot pass vacuously', () => {
        expect(sizeBaselineFiles.length).toBeGreaterThan(0);
    });

    it('should list every path relative to the repo root, sorted and free of duplicates', () => {
        const sorted = [...sizeBaselineFiles].sort();
        expect(sizeBaselineFiles).toEqual(sorted);
        expect(new Set(sizeBaselineFiles).size).toBe(sizeBaselineFiles.length);
    });

    it('should name only files that still exist on disk', () => {
        const missing = sizeBaselineFiles.filter((relativePath) => !existsSync(resolve(repoRoot, relativePath)));
        expect(missing).toEqual([]);
    });
});

type CeilingCase = {
    name: string;
    lines: Record<string, number>;
    ceilings: Record<string, number>;
    expected: SizeCeilingViolation[];
};

const ceilingCases: CeilingCase[] = [
    { name: 'a file exactly at its ceiling', lines: { 'a.ts': 900 }, ceilings: { 'a.ts': 900 }, expected: [] },
    {
        name: 'a file one line over its ceiling',
        lines: { 'a.ts': 901 },
        ceilings: { 'a.ts': 900 },
        expected: [{ kind: 'over-ceiling', path: 'a.ts', lines: 901, ceiling: 900 }],
    },
    { name: 'a floor ceiling over a short file', lines: { 'a.ts': 40 }, ceilings: { 'a.ts': 600 }, expected: [] },
    { name: 'slack of exactly 100 above the floor', lines: { 'a.ts': 600 }, ceilings: { 'a.ts': 700 }, expected: [] },
    {
        name: 'slack of 101 above the floor',
        lines: { 'a.ts': 600 },
        ceilings: { 'a.ts': 701 },
        expected: [{ kind: 'stale-ceiling', path: 'a.ts', lines: 600, ceiling: 701 }],
    },
    {
        name: 'slack of 101 above a long file',
        lines: { 'a.ts': 2899 },
        ceilings: { 'a.ts': 3000 },
        expected: [{ kind: 'stale-ceiling', path: 'a.ts', lines: 2899, ceiling: 3000 }],
    },
    {
        name: 'slack of exactly 100 above a long file',
        lines: { 'a.ts': 2900 },
        ceilings: { 'a.ts': 3000 },
        expected: [],
    },
    {
        name: 'slack measured against the floor for a short file',
        lines: { 'a.ts': 300 },
        ceilings: { 'a.ts': 800 },
        expected: [{ kind: 'stale-ceiling', path: 'a.ts', lines: 300, ceiling: 800 }],
    },
    {
        name: 'a baseline path with no ceiling',
        lines: { 'a.ts': 650 },
        ceilings: {},
        expected: [{ kind: 'missing-ceiling', path: 'a.ts', lines: 650 }],
    },
    {
        name: 'a ceiling for a path outside the baseline',
        lines: { 'a.ts': 650 },
        ceilings: { 'a.ts': 650, 'gone.ts': 900 },
        expected: [{ kind: 'unlisted-ceiling', path: 'gone.ts' }],
    },
    {
        name: 'a ceiling below the floor',
        lines: { 'a.ts': 40 },
        ceilings: { 'a.ts': 599 },
        expected: [{ kind: 'below-floor', path: 'a.ts', ceiling: 599 }],
    },
    {
        name: 'a fractional ceiling',
        lines: { 'a.ts': 40 },
        ceilings: { 'a.ts': 600.5 },
        expected: [{ kind: 'below-floor', path: 'a.ts', ceiling: 600.5 }],
    },
    {
        name: 'two violations of different kinds',
        lines: { 'a.ts': 1201, 'b.ts': 700 },
        ceilings: { 'a.ts': 1200 },
        expected: [
            { kind: 'over-ceiling', path: 'a.ts', lines: 1201, ceiling: 1200 },
            { kind: 'missing-ceiling', path: 'b.ts', lines: 700 },
        ],
    },
];

function lineCountFrom(lines: Record<string, number>): (path: string) => number {
    return (path) => {
        const count = lines[path];
        if (count === undefined) {
            throw new Error(`no synthetic line count for ${path}`);
        }
        return count;
    };
}

describe('lint size ceilings rule', () => {
    it.each(ceilingCases)('should report exactly the violations for $name', ({ lines, ceilings, expected }) => {
        const violations = findSizeCeilingViolations({
            baselineFiles: Object.keys(lines),
            ceilings,
            lineCount: lineCountFrom(lines),
        });
        expect(violations).toEqual(expected);
    });
});

describe('recorded lint size ceilings', () => {
    it('should keep the ceilings keys sorted, so a merge cannot hide a re-added path', () => {
        const keys = Object.keys(readSizeCeilings(repoRoot));
        expect(keys).toEqual([...keys].sort());
    });

    it('should hold every baselined file within its recorded ceiling', () => {
        const violations = findSizeCeilingViolations({
            baselineFiles: sizeBaselineFiles,
            ceilings: readSizeCeilings(repoRoot),
            lineCount: (path) => countFileLines(repoRoot, path),
        });
        expect(violations.map(describeSizeCeilingViolation)).toEqual([]);
    });
});
