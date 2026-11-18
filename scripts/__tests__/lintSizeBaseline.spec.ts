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
 * generator, and say so in its header. Ceilings are never raised and no path is
 * added to the baseline: scripts/checkSizeBaselineShrinks.ts compares the head
 * with its merge base on origin/main and refuses both.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
    chmodSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sizeBaselineFiles } from '../../eslint.size-baseline.mjs';
import {
    checkQualityBudgetShrinks,
    checkSizeBaselineShrinks as checkSizeBaselineShrinksWith,
    isEntryModule,
} from '../checkSizeBaselineShrinks';
import {
    countFileLines,
    describeSizeBaselineGrowth,
    describeSizeCeilingViolation,
    expectedSizeCeiling,
    findSizeBaselineGrowth,
    findSizeCeilingViolations,
    GENERATED_SIZE_EXEMPTIONS,
    listUnreadableCeilingLines,
    listWrittenCeilingKeys,
    parseSizeBaselineFilesText,
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

describe('countFileLines', () => {
    let dir = '';

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'lint-size-lines-'));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it.each([
        { name: 'three terminated lines', content: 'a\nb\nc\n', expected: 3 },
        { name: 'an unterminated last line', content: 'a\nb\nc', expected: 2 },
        { name: 'an empty file', content: '', expected: 0 },
        { name: 'a single newline', content: '\n', expected: 1 },
    ])('should count $expected newline characters for $name', ({ content, expected }) => {
        writeFileSync(join(dir, 'file.txt'), content);
        expect(countFileLines(dir, 'file.txt')).toBe(expected);
    });
});

describe('size ceiling violation messages', () => {
    it('should tell the author the overflow and that ceilings are never raised', () => {
        expect(describeSizeCeilingViolation({ kind: 'over-ceiling', path: 'a.ts', lines: 960, ceiling: 950 })).toBe(
            'a.ts: 960 lines exceeds its ceiling of 950 by 10; move code into a new file (new files are held to the size rules) until it has at most 950 lines. Ceilings are never raised.'
        );
    });

    it('should say where a missing ceiling goes and what to record', () => {
        expect(describeSizeCeilingViolation({ kind: 'missing-ceiling', path: 'a.ts', lines: 700 })).toBe(
            'a.ts: baselined with no ceiling in scripts/lintSizeCeilings.json; insert it in sorted position with 750 (it has 700 lines).'
        );
    });

    it('should state the recording rule when a ceiling is below the floor', () => {
        expect(describeSizeCeilingViolation({ kind: 'below-floor', path: 'a.ts', ceiling: 599 })).toBe(
            "a.ts: ceiling 599 is not a whole number of at least 600; record the ceiling the file's length earns: its line count plus 50 when over 600 lines, else 600."
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

type GrowthCase = {
    name: string;
    base: { files: string[]; ceilings: Record<string, number> };
    head: { files: string[]; ceilings: Record<string, number> };
    headExempt?: string[];
    expected: ReturnType<typeof findSizeBaselineGrowth>;
};

const noGrowth = { addedPaths: [], addedCeilingKeys: [], removedCeilingKeys: [], raisedCeilings: [] };

const growthCases: GrowthCase[] = [
    {
        name: 'an unchanged baseline',
        base: { files: ['a.ts', 'b.ts'], ceilings: { 'a.ts': 700, 'b.ts': 800 } },
        head: { files: ['a.ts', 'b.ts'], ceilings: { 'a.ts': 700, 'b.ts': 800 } },
        expected: noGrowth,
    },
    {
        name: 'a removed path and a lowered ceiling',
        base: { files: ['a.ts', 'b.ts'], ceilings: { 'a.ts': 700, 'b.ts': 800 } },
        head: { files: ['a.ts'], ceilings: { 'a.ts': 650 } },
        expected: noGrowth,
    },
    {
        name: 'an added baseline path with its ceiling',
        base: { files: ['a.ts'], ceilings: { 'a.ts': 700 } },
        head: { files: ['a.ts', 'z.ts'], ceilings: { 'a.ts': 700, 'z.ts': 950 } },
        expected: { addedPaths: ['z.ts'], addedCeilingKeys: ['z.ts'], removedCeilingKeys: [], raisedCeilings: [] },
    },
    {
        name: 'an added ceiling key for a path already listed',
        base: { files: ['a.ts', 'b.ts'], ceilings: { 'a.ts': 700 } },
        head: { files: ['a.ts', 'b.ts'], ceilings: { 'a.ts': 700, 'b.ts': 600 } },
        expected: { addedPaths: [], addedCeilingKeys: ['b.ts'], removedCeilingKeys: [], raisedCeilings: [] },
    },
    {
        name: 'a raised ceiling',
        base: { files: ['a.ts', 'b.ts'], ceilings: { 'a.ts': 700, 'b.ts': 800 } },
        head: { files: ['a.ts', 'b.ts'], ceilings: { 'a.ts': 701, 'b.ts': 800 } },
        expected: {
            addedPaths: [],
            addedCeilingKeys: [],
            removedCeilingKeys: [],
            raisedCeilings: [{ path: 'a.ts', from: 700, to: 701 }],
        },
    },
    {
        name: 'a ceiling key dropped while its path stays baselined',
        base: { files: ['a.ts', 'b.ts'], ceilings: { 'a.ts': 700, 'b.ts': 800 } },
        head: { files: ['a.ts', 'b.ts'], ceilings: { 'a.ts': 700 } },
        expected: { addedPaths: [], addedCeilingKeys: [], removedCeilingKeys: ['b.ts'], raisedCeilings: [] },
    },
    {
        name: 'every ceiling dropped with the file while paths stay baselined',
        base: { files: ['a.ts', 'b.ts'], ceilings: { 'a.ts': 700, 'b.ts': 800 } },
        head: { files: ['a.ts', 'b.ts'], ceilings: {} },
        expected: { addedPaths: [], addedCeilingKeys: [], removedCeilingKeys: ['a.ts', 'b.ts'], raisedCeilings: [] },
    },
    {
        name: 'a ceiling key dropped for a path the head exempts',
        base: { files: ['a.ts', 'gen.ts'], ceilings: { 'a.ts': 700, 'gen.ts': 800 } },
        head: { files: ['a.ts', 'gen.ts'], ceilings: { 'a.ts': 700 } },
        headExempt: ['gen.ts'],
        expected: noGrowth,
    },
    {
        name: 'a ceiling key dropped for a baselined path the head does not exempt, beside an exempt one',
        base: { files: ['a.ts', 'gen.ts'], ceilings: { 'a.ts': 700, 'gen.ts': 800 } },
        head: { files: ['a.ts', 'gen.ts'], ceilings: {} },
        headExempt: ['gen.ts'],
        expected: { addedPaths: [], addedCeilingKeys: [], removedCeilingKeys: ['a.ts'], raisedCeilings: [] },
    },
    {
        name: 'a moved file, which is a removal plus an addition',
        base: { files: ['old.ts'], ceilings: { 'old.ts': 700 } },
        head: { files: ['new.ts'], ceilings: { 'new.ts': 700 } },
        expected: { addedPaths: ['new.ts'], addedCeilingKeys: ['new.ts'], removedCeilingKeys: [], raisedCeilings: [] },
    },
];

describe('size baseline growth', () => {
    it.each(growthCases)('should report exactly the growth for $name', ({ base, head, headExempt, expected }) => {
        const growth = findSizeBaselineGrowth(
            { baselineFiles: base.files, ceilings: base.ceilings },
            { baselineFiles: head.files, ceilings: head.ceilings },
            headExempt ?? []
        );
        expect(growth).toEqual(expected);
    });

    it('should name each finding and its figures in the messages', () => {
        expect(
            describeSizeBaselineGrowth({
                addedPaths: ['z.ts'],
                addedCeilingKeys: ['z.ts'],
                removedCeilingKeys: ['y.ts'],
                raisedCeilings: [{ path: 'a.ts', from: 700, to: 750 }],
            })
        ).toEqual([
            'z.ts: added to eslint.size-baseline.mjs; no file is ever added. Split the file below the size rules instead.',
            'z.ts: new ceiling in scripts/lintSizeCeilings.json; ceilings exist only for files already baselined.',
            'y.ts: ceiling removed from scripts/lintSizeCeilings.json while the file is still baselined; it would then grow unchecked.',
            'a.ts: ceiling raised from 700 to 750 in scripts/lintSizeCeilings.json; ceilings are never raised.',
        ]);
    });
});

describe('size baseline list text', () => {
    it('should read both quote styles, comments and trailing commas', () => {
        const text = [
            "// header mentions 'not/a/path.ts'",
            'export const sizeBaselineFiles = [',
            "    'a.ts', // trailing 'comment.ts'",
            '    "b.ts",',
            '    /* block "c.ts" */',
            "    'd.ts',",
            '];',
            "export const other = ['x.ts'];",
        ].join('\n');
        expect(parseSizeBaselineFilesText(text)).toEqual(['a.ts', 'b.ts', 'd.ts']);
    });

    it.each([
        { name: 'no array', text: 'export const other = [];\n' },
        {
            name: 'a template literal entry',
            text: "export const sizeBaselineFiles = [\n    `a.ts`,\n    'b.ts',\n];\n",
        },
        { name: 'a spread entry', text: "export const sizeBaselineFiles = [\n    ...extra,\n    'b.ts',\n];\n" },
        { name: 'an unclosed array', text: "export const sizeBaselineFiles = [\n    'a.ts',\n" },
    ])('should throw for $name', ({ text }) => {
        expect(() => parseSizeBaselineFilesText(text)).toThrow();
    });

    it('should read an empty array as no paths', () => {
        expect(parseSizeBaselineFilesText('export const sizeBaselineFiles = [\n    // nothing\n];\n')).toEqual([]);
    });

    it('should keep a real entry that follows a string containing a double slash', () => {
        const text = "export const sizeBaselineFiles = [\n    'x//', 'src/real.ts',\n];\n";
        expect(parseSizeBaselineFilesText(text)).toEqual(['x//', 'src/real.ts']);
    });

    it('should read the real baseline module text', () => {
        const text = readFileSync(resolve(__dirname, '../../eslint.size-baseline.mjs'), 'utf8');
        expect(parseSizeBaselineFilesText(text)).toEqual(sizeBaselineFiles);
    });
});

// The test runner's module resolver cannot import a file outside its root, so each temporary repository's
// baseline is evaluated by a Node process importing it, which is what the command and ESLint do.
function evaluateInNode(absolutePath: string): Promise<unknown> {
    const script = 'import(process.argv[1]).then((m) => process.stdout.write(JSON.stringify(m)))';
    const output = execFileSync('node', ['--input-type=module', '-e', script, pathToFileURL(absolutePath).href], {
        encoding: 'utf8',
    });
    return Promise.resolve(JSON.parse(output));
}

function checkSizeBaselineShrinks(root: string): Promise<string[]> {
    return checkSizeBaselineShrinksWith(root, evaluateInNode);
}

describe('entry module detection', () => {
    let dir = '';

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'lint-size-entry-'));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it.each(['plain', 'has#hash', 'has%25percent'])('should match the script under a %s directory', (name) => {
        mkdirSync(join(dir, name));
        const script = join(dir, name, 'entry.ts');
        writeFileSync(script, '');
        expect(isEntryModule(pathToFileURL(script).href, script)).toBe(true);
    });

    it('should match the real path when the script is reached through a symlink', () => {
        mkdirSync(join(dir, 'real'));
        writeFileSync(join(dir, 'real', 'entry.ts'), '');
        symlinkSync(join(dir, 'real'), join(dir, 'link'));
        expect(isEntryModule(pathToFileURL(join(dir, 'real', 'entry.ts')).href, join(dir, 'link', 'entry.ts'))).toBe(
            true
        );
    });

    it('should not match another module or a missing entry', () => {
        writeFileSync(join(dir, 'entry.ts'), '');
        expect(isEntryModule(pathToFileURL(join(dir, 'other.ts')).href, join(dir, 'entry.ts'))).toBe(false);
        expect(isEntryModule(pathToFileURL(join(dir, 'entry.ts')).href, undefined)).toBe(false);
    });
});

describe('size baseline check against the merge base', () => {
    let dir = '';

    function git(...args: string[]): string {
        return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    }

    function writeBaseline(files: string[], ceilings: Record<string, number>): void {
        const list = files.map((path) => `    '${path}',\n`).join('');
        writeFileSync(join(dir, 'eslint.size-baseline.mjs'), `export const sizeBaselineFiles = [\n${list}];\n`);
        mkdirSync(join(dir, 'scripts'), { recursive: true });
        writeFileSync(join(dir, SIZE_CEILINGS_PATH), `${JSON.stringify(ceilings, null, 4)}\n`);
    }

    function commit(message: string): void {
        git('add', '-A');
        git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', message);
    }

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'lint-size-shrinks-'));
        git('init', '-q');
        writeBaseline(['a.ts', 'b.ts'], { 'a.ts': 700, 'b.ts': 800 });
        commit('base');
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('should name a path the head added to the baseline', async () => {
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        writeBaseline(['a.ts', 'b.ts', 'z.ts'], { 'a.ts': 700, 'b.ts': 800, 'z.ts': 950 });
        commit('head');
        const findings = await checkSizeBaselineShrinks(dir);
        expect(findings.some((finding) => finding.startsWith('z.ts: added to eslint.size-baseline.mjs'))).toBe(true);
    });

    it('seeds quality budget only for files already in the base', () => {
        const budgetPath = join(dir, 'oxlint-quality-baseline.json');
        const text = (file: string) => JSON.stringify({ [file]: { 'vitest/no-conditional-expect': { count: 1 } } });
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        expect(() => checkQualityBudgetShrinks(dir)).toThrow('oxlint-quality-baseline.json');
        writeFileSync(budgetPath, text('untracked.ts'));
        expect(checkQualityBudgetShrinks(dir)).toEqual([
            'untracked.ts: cannot seed a lint quality budget for a path absent at the merge base.',
        ]);
        writeFileSync(budgetPath, text('eslint.size-baseline.mjs'));
        expect(checkQualityBudgetShrinks(dir)).toEqual([]);
    });

    it('binds quality budget growth to the recorded merge base', () => {
        const budgetPath = join(dir, 'oxlint-quality-baseline.json');
        const count = (value: number) =>
            JSON.stringify({ 'a.ts': { 'vitest/no-conditional-expect': { count: value } } });
        writeFileSync(budgetPath, count(2));
        commit('seed quality counts');
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        writeFileSync(budgetPath, count(1));
        expect(checkQualityBudgetShrinks(dir)).toEqual([]);
        writeFileSync(budgetPath, count(3));
        expect(checkQualityBudgetShrinks(dir)).toEqual([
            'a.ts: vitest/no-conditional-expect budget increased from 2 to 3 in oxlint-quality-baseline.json.',
        ]);
    });

    it('seeds a newly configured rule only for unchanged tracked files', () => {
        const config = join(dir, '.oxlint-quality.json');
        const budget = join(dir, 'oxlint-quality-baseline.json');
        const newRule = 'vitest/no-conditional-expect';
        const oldRule = 'sourdaw-craft/no-control-flow-ternary';
        const write = (path: string, value: object) => writeFileSync(path, JSON.stringify(value));
        writeFileSync(join(dir, 'unchanged.ts'), 'export const count = 1;\n');
        writeFileSync(join(dir, 'edited.ts'), 'export const count = 1;\n');
        write(config, { rules: { [oldRule]: 'error' } });
        write(budget, { 'unchanged.ts': { [oldRule]: { count: 2 } } });
        commit('quality rule already in force');
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');

        write(config, {
            rules: { [oldRule]: 'error' },
            overrides: [{ files: ['*.ts'], rules: { [newRule]: 'error' } }],
        });
        write(budget, { 'unchanged.ts': { [oldRule]: { count: 1 }, [newRule]: { count: 2 } } });
        expect(checkQualityBudgetShrinks(dir)).toEqual([]);

        writeFileSync(join(dir, 'edited.ts'), 'export const count = 2;\n');
        writeFileSync(join(dir, 'new.ts'), 'export const count = 1;\n');
        write(budget, {
            'unchanged.ts': { [oldRule]: { count: 1 }, [newRule]: { count: 2 } },
            'edited.ts': { [newRule]: { count: 1 } },
            'new.ts': { [newRule]: { count: 1 } },
            'eslint.size-baseline.mjs': { [oldRule]: { count: 1 } },
        });
        expect(checkQualityBudgetShrinks(dir)).toEqual([
            `edited.ts: ${newRule} budget increased from 0 to 1 in oxlint-quality-baseline.json.`,
            `new.ts: ${newRule} budget increased from 0 to 1 in oxlint-quality-baseline.json.`,
            `eslint.size-baseline.mjs: ${oldRule} budget increased from 0 to 1 in oxlint-quality-baseline.json.`,
        ]);

        write(config, { rules: { [oldRule]: 'error', [newRule]: 'off' } });
        write(budget, { 'unchanged.ts': { [newRule]: { count: 1 } } });
        expect(checkQualityBudgetShrinks(dir)).toEqual([
            `unchanged.ts: ${newRule} budget increased from 0 to 1 in oxlint-quality-baseline.json.`,
        ]);
    });

    it('should accept a head that only removes a path and lowers a ceiling', async () => {
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        writeBaseline(['a.ts'], { 'a.ts': 650 });
        commit('head');
        expect(await checkSizeBaselineShrinks(dir)).toEqual([]);
    });

    it('should accept an empty base and an empty head', async () => {
        writeBaseline([], {});
        commit('empty base');
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        writeFileSync(join(dir, 'unrelated.txt'), 'x\n');
        commit('head');
        expect(await checkSizeBaselineShrinks(dir)).toEqual([]);
    });

    it('should report a path added to an empty base', async () => {
        writeBaseline([], {});
        commit('empty base');
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        writeBaseline(['z.ts'], { 'z.ts': 950 });
        commit('head');
        const findings = await checkSizeBaselineShrinks(dir);
        expect(findings).toHaveLength(2);
        expect(findings.some((finding) => finding.startsWith('z.ts: added to eslint.size-baseline.mjs'))).toBe(true);
    });

    it('should report a ceiling key deleted while its path stays baselined', async () => {
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        writeBaseline(['a.ts', 'b.ts'], { 'a.ts': 700 });
        commit('head');
        expect(await checkSizeBaselineShrinks(dir)).toEqual([
            `b.ts: ceiling removed from ${SIZE_CEILINGS_PATH} while the file is still baselined; it would then grow unchecked.`,
        ]);
    });

    it('should accept a head that removes the ceiling of a real generated exemption still baselined', async () => {
        const exemptPath = GENERATED_SIZE_EXEMPTIONS[0]?.path;
        if (exemptPath === undefined) {
            throw new Error('GENERATED_SIZE_EXEMPTIONS is empty; this case needs a real exemption.');
        }
        writeBaseline(['a.ts', exemptPath], { 'a.ts': 700, [exemptPath]: 800 });
        commit('base with generated exemption');
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        writeBaseline(['a.ts', exemptPath], { 'a.ts': 700 });
        commit('head');
        expect(await checkSizeBaselineShrinks(dir)).toEqual([]);
    });

    it('should still report a ceiling removed for a path that is not a generated exemption', async () => {
        const exemptPath = GENERATED_SIZE_EXEMPTIONS[0]?.path;
        if (exemptPath === undefined) {
            throw new Error('GENERATED_SIZE_EXEMPTIONS is empty; this case needs a real exemption.');
        }
        writeBaseline(['a.ts', exemptPath], { 'a.ts': 700, [exemptPath]: 800 });
        commit('base with generated exemption');
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        writeBaseline(['a.ts', exemptPath], { [exemptPath]: 800 });
        commit('head');
        expect(await checkSizeBaselineShrinks(dir)).toEqual([
            `a.ts: ceiling removed from ${SIZE_CEILINGS_PATH} while the file is still baselined; it would then grow unchecked.`,
        ]);
    });

    it('should report every ceiling when the head deletes the ceilings file', async () => {
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        git('rm', '-q', SIZE_CEILINGS_PATH);
        commit('head');
        expect(await checkSizeBaselineShrinks(dir)).toHaveLength(2);
    });

    it('should fail closed when origin/main is missing', async () => {
        await expect(checkSizeBaselineShrinks(dir)).rejects.toThrow('refs/remotes/origin/main is missing');
    });

    describe('head list forms the text reader cannot see', () => {
        const added = ['src/Big.ts: added to eslint.size-baseline.mjs'];

        function commitHeadModule(source: string): void {
            git('update-ref', 'refs/remotes/origin/main', 'HEAD');
            writeFileSync(join(dir, 'eslint.size-baseline.mjs'), source);
            commit('head');
        }

        async function headFindings(source: string): Promise<string[]> {
            commitHeadModule(source);
            const findings = await checkSizeBaselineShrinks(dir);
            return findings.map((finding) => finding.slice(0, finding.indexOf(';')));
        }

        beforeEach(() => {
            writeBaseline(['a.ts'], { 'a.ts': 700 });
            commit('base with one path');
        });

        it('should report a path appended through concat', async () => {
            expect(await headFindings("export const sizeBaselineFiles = ['a.ts'].concat(['src/Big.ts']);\n")).toEqual(
                added
            );
        });

        it('should report a path pushed after the literal', async () => {
            expect(
                await headFindings(
                    "export const sizeBaselineFiles = ['a.ts'];\nsizeBaselineFiles.push('src/Big.ts');\n"
                )
            ).toEqual(added);
        });

        it('should report a path listed after a decoy assignment in a comment', async () => {
            expect(
                await headFindings(
                    "// sizeBaselineFiles = ['a.ts']\nexport const sizeBaselineFiles = ['a.ts', 'src/Big.ts'];\n"
                )
            ).toEqual(added);
        });

        it('should accept a head that empties the list and changes nothing else', async () => {
            commitHeadModule('export const sizeBaselineFiles = [];\n');
            expect(await checkSizeBaselineShrinks(dir)).toEqual([]);
        });

        it('should refuse a head whose export is not an array of strings', async () => {
            commitHeadModule('export const sizeBaselineFiles = [1];\n');
            await expect(checkSizeBaselineShrinks(dir)).rejects.toThrow('must export sizeBaselineFiles');
        });

        it('should report a ceiling the head raises', async () => {
            git('update-ref', 'refs/remotes/origin/main', 'HEAD');
            writeBaseline(['a.ts'], { 'a.ts': 750 });
            commit('head');
            expect(await checkSizeBaselineShrinks(dir)).toEqual([
                `a.ts: ceiling raised from 700 to 750 in ${SIZE_CEILINGS_PATH}; ceilings are never raised.`,
            ]);
        });
    });

    function removeCeilingsFile(): void {
        git('rm', '-q', SIZE_CEILINGS_PATH);
        commit('base without ceilings');
    }

    it('should accept a head that adds nothing when the merge base has no ceilings file', async () => {
        removeCeilingsFile();
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        writeFileSync(join(dir, 'unrelated.txt'), 'x\n');
        commit('head');
        rmSync(join(dir, SIZE_CEILINGS_PATH), { force: true });
        expect(await checkSizeBaselineShrinks(dir)).toEqual([]);
    });

    it('should report a ceiling key the head adds when the merge base has no ceilings file', async () => {
        removeCeilingsFile();
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        writeBaseline(['a.ts', 'b.ts'], { 'a.ts': 700 });
        commit('head');
        expect(await checkSizeBaselineShrinks(dir)).toEqual([
            `a.ts: new ceiling in ${SIZE_CEILINGS_PATH}; ceilings exist only for files already baselined.`,
        ]);
    });

    it('should compare against the merge base, not an origin/main that moved on with its own shrink', async () => {
        const base = git('rev-parse', 'HEAD').trim();
        writeBaseline(['a.ts'], { 'a.ts': 700 });
        commit('main shrinks');
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        git('checkout', '-q', '-b', 'feature', base);
        writeFileSync(join(dir, 'unrelated.txt'), 'x\n');
        commit('head');
        expect(await checkSizeBaselineShrinks(dir)).toEqual([]);
    });

    describe('as a command', () => {
        function runCli(): { status: number; stdout: string; stderr: string } {
            mkdirSync(join(dir, 'scripts'), { recursive: true });
            for (const name of [
                'checkSizeBaselineShrinks.ts',
                'lintComplexityGrowth.ts',
                'lintSizeCeilings.ts',
                'lintQualityBudget.ts',
            ]) {
                copyFileSync(resolve(__dirname, '..', name), join(dir, 'scripts', name));
            }
            if (!existsSync(join(dir, 'oxlint-quality-baseline.json'))) {
                writeFileSync(join(dir, 'oxlint-quality-baseline.json'), '{}\n');
            }
            writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
            if (!existsSync(join(dir, 'node_modules'))) {
                symlinkSync(join(repoRoot, 'node_modules'), join(dir, 'node_modules'), 'junction');
            }
            const result = spawnSync('node', ['scripts/checkSizeBaselineShrinks.ts'], { cwd: dir, encoding: 'utf8' });
            return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
        }

        describe('existing native complexity findings', () => {
            function body(score: number): string {
                const branches = Array.from({ length: score - 1 }, (_, index) => `if (value === ${index}) return 0;`);
                return `{ ${branches.join(' ')} return value; }`;
            }

            function declaration(name: string, score: number): string {
                return `export function ${name}(value: number) ${body(score)}`;
            }

            function writeCode(file: string, ...parts: string[]): void {
                writeFileSync(join(dir, file), `${parts.join('\n')}\n`);
            }

            function setBase(count: number, file = 'a.ts'): void {
                writeFileSync(
                    join(dir, 'oxlint-quality-baseline.json'),
                    JSON.stringify({
                        [file]: { 'eslint/complexity': { count } },
                    })
                );
                writeFileSync(
                    join(dir, '.oxlint-quality.json'),
                    JSON.stringify({
                        overrides: [{ files: ['**/*.{ts,tsx}'], rules: { complexity: ['error', 15] } }],
                    })
                );
                commit('base with native complexity findings');
                git('update-ref', 'refs/remotes/origin/main', 'HEAD');
            }

            it('rejects higher complexity with the same count in the committed merge-base comparison', () => {
                writeCode('a.ts', declaration('apply', 16));
                setBase(1);
                const base = git('rev-parse', 'HEAD').trim();
                writeCode('a.ts', declaration('apply', 19));
                commit('main moves on');
                git('update-ref', 'refs/remotes/origin/main', 'HEAD');
                git('checkout', '-q', '-b', 'feature', base);
                writeCode('a.ts', '// 🎚', declaration('apply', 17));
                commit('head with same count and higher complexity');
                writeCode('a.ts', declaration('apply', 16));
                expect(runCli()).toMatchObject({
                    status: 1,
                    stderr: 'a.ts: function apply complexity increased from 16 to 17 (maximum 15).\n',
                });
            });

            it('accepts reductions, reordering, comments and renamed or nested functions', () => {
                const nested = (score: number) =>
                    `function outer(value: number) { function stable(value: number) ${body(score)} return stable(value); }`;
                writeCode(
                    'a.ts',
                    declaration('stable', 16),
                    declaration('reduce', 17),
                    declaration('rename', 16),
                    nested(16)
                );
                setBase(4);
                writeCode(
                    'a.ts',
                    '// 🎚',
                    nested(19),
                    declaration('renamed', 18),
                    declaration('reduce', 16),
                    declaration('stable', 16)
                );
                commit('reorder, reduce and rename');
                expect(runCli()).toMatchObject({ status: 0, stderr: '' });
            });

            it('tracks a unique overload implementation and a direct const arrow by identifier and kind', () => {
                const arrow = (name: string, score: number) =>
                    `export const ${name} = (value: number) => ${body(score)};`;
                const overload = 'export function apply(value: number): number;';
                writeCode('a.ts', overload, declaration('apply', 16), arrow('convert', 16), arrow('shape', 16));
                setBase(3);
                writeCode('a.ts', overload, declaration('apply', 17), arrow('convert', 18), declaration('shape', 19));
                commit('grow the same implementation and arrow');
                expect(runCli()).toMatchObject({
                    status: 1,
                    stderr: 'a.ts: function apply complexity increased from 16 to 17 (maximum 15).\na.ts: const convert arrow complexity increased from 16 to 18 (maximum 15).\n',
                });
            });

            it('distinguishes a nested concise arrow from its const binding when they share an end', () => {
                const nested = (score: number) => `const outer = () => (value: number) => ${body(score)};`;
                const bound = (score: number) => `export const view = function (value: number) ${body(score)};`;
                writeCode('a.tsx', nested(16), bound(17), 'export const label = <span>🎚</span>;');
                setBase(2, 'a.tsx');
                writeCode('a.tsx', 'export const label = <span>🎚</span>;', bound(18), nested(19));
                commit('grow the inner arrow and the direct function expression');
                expect(runCli()).toMatchObject({
                    status: 1,
                    stderr: 'a.tsx: const view function complexity increased from 17 to 18 (maximum 15).\n',
                });
            });

            it('fails when native scoring reports a parser diagnostic', () => {
                writeCode('a.ts', declaration('apply', 16));
                setBase(1);
                writeCode('a.ts', 'export function broken( {');
                commit('unparseable head content');
                const result = runCli();
                expect(result.status).toBe(1);
                expect(result.stderr).toContain('Unexpected Oxlint complexity diagnostic in a.ts');
            });

            it('accepts a decrease that eliminates the last native finding', () => {
                writeCode('a.ts', declaration('apply', 16));
                setBase(1);
                writeCode('a.ts', declaration('apply', 15));
                writeFileSync(join(dir, 'oxlint-quality-baseline.json'), '{}\n');
                commit('eliminate the last finding');
                expect(runCli()).toMatchObject({ status: 0, stderr: '' });
            });

            it('skips unchanged, moved, and previously unbudgeted files', () => {
                writeCode('a.ts', declaration('apply', 16));
                writeCode('src.ts', declaration('apply', 17));
                setBase(1);
                writeCode('src.ts', declaration('apply', 18));
                chmodSync(join(dir, 'a.ts'), 0o755);
                rmSync(join(dir, '.oxlint-quality.json'));
                commit('only an unbudgeted source file changes');
                writeCode('a.ts', declaration('apply', 17));
                expect(runCli()).toMatchObject({ status: 0, stderr: '' });
                git('mv', 'a.ts', 'moved.ts');
                commit('move the budgeted file');
                expect(runCli()).toMatchObject({ status: 0, stderr: '' });
            });
        });

        it('should exit 1 and print the finding for an added path', () => {
            git('update-ref', 'refs/remotes/origin/main', 'HEAD');
            writeBaseline(['a.ts', 'b.ts', 'z.ts'], { 'a.ts': 700, 'b.ts': 800, 'z.ts': 950 });
            const { status, stderr } = runCli();
            expect({ status, mentionsPath: stderr.includes('z.ts: added to eslint.size-baseline.mjs') }).toEqual({
                status: 1,
                mentionsPath: true,
            });
        });

        it('should exit 1 for a path the head appends through concat, which the text reader cannot see', () => {
            writeBaseline(['a.ts'], { 'a.ts': 700 });
            commit('base with one path');
            git('update-ref', 'refs/remotes/origin/main', 'HEAD');
            writeFileSync(
                join(dir, 'eslint.size-baseline.mjs'),
                "export const sizeBaselineFiles = ['a.ts'].concat(['src/Big.ts']);\n"
            );
            const { status, stderr } = runCli();
            expect({ status, mentionsPath: stderr.includes('src/Big.ts: added to eslint.size-baseline.mjs') }).toEqual({
                status: 1,
                mentionsPath: true,
            });
        });

        it('should still check when started through a symlink to the checkout', () => {
            git('update-ref', 'refs/remotes/origin/main', 'HEAD');
            writeBaseline(['a.ts', 'b.ts', 'z.ts'], { 'a.ts': 700, 'b.ts': 800, 'z.ts': 950 });
            runCli();
            const link = `${dir}-link`;
            symlinkSync(dir, link);
            try {
                const result = spawnSync('node', [join(link, 'scripts/checkSizeBaselineShrinks.ts')], {
                    cwd: dir,
                    encoding: 'utf8',
                });
                expect({ status: result.status, mentionsPath: result.stderr.includes('z.ts: added') }).toEqual({
                    status: 1,
                    mentionsPath: true,
                });
            } finally {
                rmSync(link, { force: true });
            }
        });

        it('should exit 0 and print the success line for a clean head', () => {
            git('update-ref', 'refs/remotes/origin/main', 'HEAD');
            const { status, stdout } = runCli();
            expect({ status, stdout }).toEqual({
                status: 0,
                stdout: 'Size and lint quality baselines only shrink against the merge base.\n',
            });
        });
    });
});
