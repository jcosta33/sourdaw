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
 * file over 600 lines is recorded at its line count plus 50 and a file within
 * 600 at 600; a file may not exceed its ceiling, and a ceiling more than 100
 * above the ceiling the file's current length earns is stale and must be
 * lowered to it. The ceilings file lists exactly the non-exempt baseline
 * paths, each written once, in sorted order, on a line whose key matches the
 * parsed key (scripts/lintSizeCeilings.ts holds the rule). Generated files
 * named in its exemption list carry no ceiling; each must exist, name a real
 * generator, and say so in its header. Ceilings are never raised: review
 * refuses any raised figure, and the spec catches a raise only when it ends
 * more than 100 above the ceiling the file's current length earns.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { sizeBaselineFiles } from '../../eslint.size-baseline.mjs';
import {
    countFileLines,
    describeSizeCeilingViolation,
    expectedSizeCeiling,
    findSizeCeilingViolations,
    GENERATED_SIZE_EXEMPTIONS,
    listUnreadableCeilingLines,
    listWrittenCeilingKeys,
    readSizeCeilings,
    SIZE_CEILINGS_PATH,
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
    exempt?: string[];
    expected: SizeCeilingViolation[];
};

const ceilingCases: CeilingCase[] = [
    {
        name: 'a file at its ceiling, headroom included',
        lines: { 'a.ts': 900 },
        ceilings: { 'a.ts': 950 },
        expected: [],
    },
    {
        name: 'a file one line over its ceiling',
        lines: { 'a.ts': 951 },
        ceilings: { 'a.ts': 950 },
        expected: [{ kind: 'over-ceiling', path: 'a.ts', lines: 951, ceiling: 950 }],
    },
    {
        name: 'a file below the headroom it was recorded with',
        lines: { 'a.ts': 900 },
        ceilings: { 'a.ts': 900 },
        expected: [],
    },
    { name: 'a file exactly at the floor ceiling', lines: { 'a.ts': 600 }, ceilings: { 'a.ts': 600 }, expected: [] },
    {
        name: 'a file within the floor at the floor ceiling',
        lines: { 'a.ts': 580 },
        ceilings: { 'a.ts': 600 },
        expected: [],
    },
    { name: 'a floor ceiling over a short file', lines: { 'a.ts': 40 }, ceilings: { 'a.ts': 600 }, expected: [] },
    {
        name: 'a file one line over the floor ceiling',
        lines: { 'a.ts': 601 },
        ceilings: { 'a.ts': 600 },
        expected: [{ kind: 'over-ceiling', path: 'a.ts', lines: 601, ceiling: 600 }],
    },
    {
        name: 'slack of exactly 100 above the ceiling a floor-length file earns',
        lines: { 'a.ts': 600 },
        ceilings: { 'a.ts': 700 },
        expected: [],
    },
    {
        name: 'slack of 101 above the ceiling a floor-length file earns',
        lines: { 'a.ts': 600 },
        ceilings: { 'a.ts': 701 },
        expected: [{ kind: 'stale-ceiling', path: 'a.ts', lines: 600, ceiling: 701 }],
    },
    {
        name: 'slack of exactly 100 above the ceiling a long file earns',
        lines: { 'a.ts': 2850 },
        ceilings: { 'a.ts': 3000 },
        expected: [],
    },
    {
        name: 'slack of 101 above the ceiling a long file earns',
        lines: { 'a.ts': 2849 },
        ceilings: { 'a.ts': 3000 },
        expected: [{ kind: 'stale-ceiling', path: 'a.ts', lines: 2849, ceiling: 3000 }],
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
        ceilings: { 'a.ts': 700, 'gone.ts': 900 },
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
        lines: { 'a.ts': 1251, 'b.ts': 700 },
        ceilings: { 'a.ts': 1250 },
        expected: [
            { kind: 'over-ceiling', path: 'a.ts', lines: 1251, ceiling: 1250 },
            { kind: 'missing-ceiling', path: 'b.ts', lines: 700 },
        ],
    },
    {
        name: 'an exempt baseline path with no ceiling',
        lines: { 'gen.ts': 50_000 },
        ceilings: {},
        exempt: ['gen.ts'],
        expected: [],
    },
    {
        name: 'an exempt path that also carries a ceiling',
        lines: { 'gen.ts': 50_000 },
        ceilings: { 'gen.ts': 50_050 },
        exempt: ['gen.ts'],
        expected: [{ kind: 'exempt-ceiling', path: 'gen.ts' }],
    },
    {
        name: 'an exemption for a path outside the baseline',
        lines: { 'a.ts': 650 },
        ceilings: { 'a.ts': 700 },
        exempt: ['gone.ts'],
        expected: [{ kind: 'stale-exemption', path: 'gone.ts' }],
    },
    {
        name: 'a repeated exemption for a path outside the baseline',
        lines: { 'a.ts': 650 },
        ceilings: { 'a.ts': 700 },
        exempt: ['gone.ts', 'gone.ts'],
        expected: [{ kind: 'stale-exemption', path: 'gone.ts' }],
    },
    {
        name: 'an exemption beside an over-ceiling file',
        lines: { 'a.ts': 951, 'gen.ts': 50_000 },
        ceilings: { 'a.ts': 950 },
        exempt: ['gen.ts'],
        expected: [{ kind: 'over-ceiling', path: 'a.ts', lines: 951, ceiling: 950 }],
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
    it.each(ceilingCases)(
        'should report exactly the violations for $name',
        ({ lines, ceilings, exempt = [], expected }) => {
            const measured = Object.fromEntries(Object.entries(lines).filter(([path]) => !exempt.includes(path)));
            const violations = findSizeCeilingViolations({
                baselineFiles: Object.keys(lines),
                ceilings,
                exemptFiles: exempt,
                lineCount: lineCountFrom(measured),
            });
            expect(violations).toEqual(expected);
        }
    );
});

describe('expected size ceiling', () => {
    it.each([
        { lines: 40, expected: 600 },
        { lines: 600, expected: 600 },
        { lines: 601, expected: 651 },
        { lines: 900, expected: 950 },
    ])('should record $expected for a file of $lines lines', ({ lines, expected }) => {
        expect(expectedSizeCeiling(lines)).toBe(expected);
    });
});

describe('size ceiling violation messages', () => {
    it('should tell the author the overflow and that ceilings are never raised', () => {
        expect(describeSizeCeilingViolation({ kind: 'over-ceiling', path: 'a.ts', lines: 960, ceiling: 950 })).toBe(
            'a.ts: 960 lines exceeds its ceiling of 950 by 10; move code into a new file (new files are held to the size rules) until it has at most 950 lines. Ceilings are never raised.'
        );
    });
});

type WrittenKeysCase = { name: string; text: string; expected: string[] };

const writtenKeysCases: WrittenKeysCase[] = [
    {
        name: 'a clean three-entry object',
        text: '{\n    "a.ts": 700,\n    "b.ts": 800,\n    "c.ts": 900\n}\n',
        expected: ['a.ts', 'b.ts', 'c.ts'],
    },
    {
        name: 'an adjacent repeated key with a different value',
        text: '{\n    "a.ts": 700,\n    "a.ts": 900,\n    "b.ts": 800\n}\n',
        expected: ['a.ts', 'a.ts', 'b.ts'],
    },
    {
        name: 'a non-adjacent repeated key',
        text: '{\n    "a.ts": 700,\n    "b.ts": 800,\n    "a.ts": 900\n}\n',
        expected: ['a.ts', 'b.ts', 'a.ts'],
    },
    {
        name: 'keys out of order',
        text: '{\n    "b.ts": 800,\n    "a.ts": 700\n}\n',
        expected: ['b.ts', 'a.ts'],
    },
];

const unreadableLinesCases: WrittenKeysCase[] = [
    {
        name: 'a clean three-entry object',
        text: '{\n    "a.ts": 700,\n    "b.ts": 800,\n    "c.ts": 900\n}\n',
        expected: [],
    },
    {
        name: 'a repeated key written with spaces before the colon',
        text: '{\n    "electron/main.ts": 991,\n    "electron/main.ts"  : 1500\n}\n',
        expected: ['    "electron/main.ts"  : 1500'],
    },
    {
        name: 'a blank line between entries',
        text: '{\n    "a.ts": 700,\n\n    "b.ts": 800\n}\n',
        expected: [''],
    },
    {
        name: 'CRLF line endings',
        text: '{\r\n    "a.ts": 700\r\n}\r\n',
        expected: ['{\r', '    "a.ts": 700\r', '}\r'],
    },
];

function repeatedKeys(keys: readonly string[]): string[] {
    return keys.filter((key, index) => keys.indexOf(key) !== index);
}

describe('written ceiling keys', () => {
    it.each(writtenKeysCases)('should return every key in written order for $name', ({ text, expected }) => {
        expect(listWrittenCeilingKeys(text)).toEqual(expected);
    });

    it.each(unreadableLinesCases)('should report exactly the unreadable lines for $name', ({ text, expected }) => {
        expect(listUnreadableCeilingLines(text)).toEqual(expected);
    });

    it('should not read an escaped key that JSON.parse decodes to an existing key', () => {
        const text = '{\n    "electron/main.ts": 991,\n    "electron/m\\u0061in.ts": 1500\n}\n';
        expect(Object.keys(JSON.parse(text))).toEqual(['electron/main.ts']);
        expect(listWrittenCeilingKeys(text)).toEqual(['electron/main.ts']);
        expect(listUnreadableCeilingLines(text)).toEqual(['    "electron/m\\u0061in.ts": 1500']);
    });
});

describe('recorded lint size ceilings', () => {
    it('should write each ceilings key once and in sorted order, so a merge cannot hide a re-added path', () => {
        const text = readFileSync(resolve(repoRoot, SIZE_CEILINGS_PATH), 'utf8');
        const written = listWrittenCeilingKeys(text);
        expect(listUnreadableCeilingLines(text)).toEqual([]);
        expect(written).toEqual(Object.keys(readSizeCeilings(repoRoot)));
        expect(repeatedKeys(written)).toEqual([]);
        expect(written).toEqual([...written].sort());
    });

    it('should hold every baselined file within its recorded ceiling', () => {
        const violations = findSizeCeilingViolations({
            baselineFiles: sizeBaselineFiles,
            ceilings: readSizeCeilings(repoRoot),
            exemptFiles: GENERATED_SIZE_EXEMPTIONS.map((exemption) => exemption.path),
            lineCount: (path) => countFileLines(repoRoot, path),
        });
        expect(violations.map(describeSizeCeilingViolation)).toEqual([]);
    });

    it('should exempt only generated files that exist and name an existing generator in their header', () => {
        const dishonest = GENERATED_SIZE_EXEMPTIONS.filter(({ path, generator }) => {
            const filePath = resolve(repoRoot, path);
            if (!existsSync(filePath) || !existsSync(resolve(repoRoot, generator))) {
                return true;
            }
            const header = readFileSync(filePath, 'utf8').split('\n').slice(0, 5).join('\n');
            return !header.includes(`Generated by ${generator}`);
        });
        expect(dishonest).toEqual([]);
    });
});
