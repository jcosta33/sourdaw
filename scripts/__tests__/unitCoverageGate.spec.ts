import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { changedProductionLines, evaluateUnitCoverage, readCoverageFloors } from '../unitCoverageGate.ts';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-unit-coverage-')));
    temporaryRoots.push(root);
    return root;
}

function command(cwd: string, executable: string, args: [string, ...string[]]): string {
    const result = spawnSync(executable, args, { cwd, encoding: 'utf8', timeout: 30_000 });
    if (result.status !== 0) {
        throw new Error(`${executable} ${args[0]} failed: ${result.stderr || result.stdout}`);
    }
    return result.stdout.trimEnd();
}

function commit(root: string): string {
    command(root, 'git', ['add', '--all']);
    command(root, 'git', [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        'commit',
        '-qm',
        'fixture',
    ]);
    return command(root, 'git', ['rev-parse', 'HEAD']);
}

const rootScript = join(dirname(fileURLToPath(import.meta.url)), '../unitCoverageGate.ts');
const dependencies = join(dirname(rootScript), '../node_modules');
const vitestBin = join(dependencies, 'vitest/vitest.mjs');
const floors = { version: 1, lines: 4000, statements: 4000, branches: 4000, functions: 4000 } satisfies ReturnType<
    typeof readCoverageFloors
>;

const location = { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } };
const coveredStructures = {
    fnMap: { 0: { name: 'fixture', decl: location, loc: location, line: 1 } },
    f: { 0: 1 },
    branchMap: { 0: { type: 'if', loc: location, locations: [location], line: 1 } },
    b: { 0: [1] },
};

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
        rmSync(root, { force: true, recursive: true });
    }
});

describe('PR unit coverage gate', () => {
    it('compares Git content at the rename destination and ignores deleted, type declaration and test files', () => {
        const root = temporaryRoot();
        command(root, 'git', ['init', '-q']);
        mkdirSync(join(root, 'src'));
        const original = 'src/earlier name.ts';
        const renamed = 'src/ü quote\t".ts';
        const unchanged = Array.from({ length: 20 }, (_, index) => `export const value${index} = ${index};`);
        writeFileSync(join(root, original), `${unchanged.join('\n')}\nexport const old = 1;\n`);
        writeFileSync(join(root, 'src/deleted.ts'), 'export const deleted = 1;\n');
        const base = commit(root);
        rmSync(join(root, original));
        rmSync(join(root, 'src/deleted.ts'));
        writeFileSync(join(root, renamed), `${unchanged.join('\n')}\nexport const next = 2;\n`);
        writeFileSync(join(root, 'src/new.ts'), '// header\nexport const f = 1;\n');
        writeFileSync(join(root, 'src/declaration.d.ts'), 'declare const d: string;\n');
        writeFileSync(join(root, 'src/sample.spec.ts'), 'example();\n');
        const head = commit(root);

        expect(changedProductionLines(root, base, head)).toEqual(
            new Map([
                [renamed, [{ start: 21, count: 1 }]],
                ['src/new.ts', [{ start: 1, count: 2 }]],
            ])
        );
    });

    it('counts each changed executable line once, with a strict threshold from counts', () => {
        const path = 'src/one.ts';
        const locations = Array.from({ length: 21 }, (_, index) => {
            const line = index === 20 ? 18 : index + 1;
            return [index, { start: { line, column: index }, end: { line, column: index + 1 } }];
        });
        const snapshot = {
            [path]: {
                path,
                statementMap: Object.fromEntries(locations),
                s: Object.fromEntries(locations.map(([id], index) => [id, index < 17 || index === 20 ? 1 : 0])),
                ...coveredStructures,
            },
        };
        const result = evaluateUnitCoverage(snapshot, new Map([[path, [{ start: 1, count: 20 }]]]), floors, floors);
        expect(result.changed).toEqual({
            covered: 18,
            total: 20,
            uncovered: [
                { path, line: 19 },
                { path, line: 20 },
            ],
        });
        expect(result.failures).toEqual([]);

        const justBelow = { ...snapshot[path], s: { ...snapshot[path].s, 20: 0 } };
        const rejected = evaluateUnitCoverage(
            { [path]: justBelow },
            new Map([[path, [{ start: 1, count: 20 }]]]),
            floors,
            floors
        );
        expect(rejected.failures).toEqual([expect.stringContaining('17/20')]);
    });

    it('fails for floor decreases, invalid floors and missing changed reports', () => {
        expect(() => readCoverageFloors(JSON.stringify({ ...floors, lines: -1 }))).toThrow('coverage floors');
        expect(() => readCoverageFloors(JSON.stringify({ ...floors, functions: undefined }))).toThrow(
            'coverage floors'
        );
        const path = 'src/one.ts';
        const coverage = {
            [path]: {
                path,
                statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } } },
                s: { 0: 1 },
                ...coveredStructures,
            },
        };
        const result = evaluateUnitCoverage(coverage, new Map([['src/missing.ts', [{ start: 1, count: 1 }]]]), floors, {
            ...floors,
            branches: floors.branches - 1,
        });
        expect(result.failures).toEqual([
            expect.stringContaining('src/missing.ts'),
            expect.stringContaining('branches floor decreased'),
        ]);
    });
});

function writeFixtureSource(root: string, yes: string, prefix = ''): void {
    writeFileSync(
        join(root, 'src/choice.ts'),
        `${prefix}export function choose(which: boolean) {
    if (which) {
        return '${yes}';
    }
    return 'no';
}
`
    );
    writeFileSync(join(root, 'src/never.ts'), 'export const never = 1;\n');
    writeFileSync(join(root, 'src/typeOnly.ts'), 'export type State = { run: boolean };\n');
}

it('collects complementary V8 hits across disjoint roots and enforces floors against the tested merge', () => {
    const root = temporaryRoot();
    const input = join(root, 'input');
    const output = join(root, 'output');
    const checkout = join(root, 'checkout');
    const summary = join(root, 'summary');
    mkdirSync(join(checkout, 'src'), { recursive: true });
    mkdirSync(input);
    command(checkout, 'git', ['init', '-q', '-b', 'base']);
    writeFixtureSource(checkout, 'old');
    const base = commit(checkout);
    command(checkout, 'git', ['switch', '-qc', 'feature']);
    writeFixtureSource(checkout, 'yes');
    const head = commit(checkout);
    command(checkout, 'git', ['switch', '-q', 'base']);
    const prefix = 'export const baseOnly = 0;\n\n';
    writeFixtureSource(checkout, 'old', prefix);
    const advancedBase = commit(checkout);
    command(checkout, 'git', [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        'merge',
        '--no-ff',
        '--quiet',
        'feature',
    ]);
    let revision = command(checkout, 'git', ['rev-parse', 'HEAD']);
    expect(changedProductionLines(checkout, advancedBase, revision)).toEqual(
        new Map([['src/choice.ts', [{ start: 5, count: 1 }]]])
    );

    for (let shard = 1; shard <= 4; shard++) {
        const sourceRoot = join(root, `isolated-${shard}`);
        mkdirSync(join(sourceRoot, 'src'), { recursive: true });
        symlinkSync(dependencies, join(sourceRoot, 'node_modules'), 'junction');
        writeFixtureSource(sourceRoot, 'yes', prefix);
        const useYes = shard % 2 === 1;
        writeFileSync(
            join(sourceRoot, 'vite.config.mjs'),
            `
            export default { test: { globals: true, maxWorkers: 1, coverage: {
                provider: 'v8', include: ['src/**/*.ts'], exclude: ['**/*.spec.ts'],
            } } };
        `
        );
        writeFileSync(
            join(sourceRoot, 'src/choice.spec.ts'),
            `
            import { choose } from './choice';
            it('executes one arm', () => expect(choose(${useYes})).toBe('${useYes ? 'yes' : 'no'}'));
        `
        );
        command(sourceRoot, process.execPath, [vitestBin, 'run', '--coverage', '--coverage.reporter=json']);
        const coverage: unknown = JSON.parse(readFileSync(join(sourceRoot, 'coverage/coverage-final.json'), 'utf8'));
        writeFileSync(
            join(input, `shard-${shard}.json`),
            JSON.stringify({
                version: 1,
                shard,
                sourceRoot,
                revision,
                runId: '5',
                attempt: '1',
                elapsedMs: 1000,
                coverage,
            })
        );
    }

    const runGate = () =>
        spawnSync(process.execPath, [rootScript], {
            cwd: checkout,
            encoding: 'utf8',
            timeout: 30_000,
            env: {
                ...process.env,
                BASE_SHA: base,
                HEAD_SHA: head,
                GITHUB_SHA: revision,
                GITHUB_RUN_ID: '5',
                GITHUB_RUN_ATTEMPT: '1',
                GITHUB_STEP_SUMMARY: summary,
                COVERAGE_SHARDS: input,
                COVERAGE_REPORT: output,
            },
        });
    const missingFloor = runGate();
    expect(missingFloor.stderr).toContain('Coverage floors missing');
    expect(missingFloor.status).toBe(1);
    const measured = readCoverageFloors(readFileSync(join(output, 'measured-floors.json'), 'utf8'));
    expect(measured.lines).toBeGreaterThan(0);
    expect(measured.lines).toBeLessThan(10_000);
    expect(measured.branches).toBe(10_000);
    expect(readFileSync(join(output, 'gate.json'), 'utf8')).toContain('"covered": 1,\n    "total": 1');
    expect(readFileSync(join(output, 'index.html'), 'utf8')).toContain('never.ts');
    expect(readFileSync(summary, 'utf8')).toContain('Changed executable lines covered: 1 / 1');

    // Add only the measured floor file to the tested tree. The source and its
    // coverage counters stay identical while the tested commit identity changes.
    mkdirSync(join(checkout, 'scripts'));
    writeFileSync(join(checkout, 'scripts/unitCoverageFloors.json'), JSON.stringify(measured));
    command(checkout, 'git', ['add', '--all']);
    command(checkout, 'git', [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        'commit',
        '--amend',
        '--no-edit',
    ]);
    const unseeded = revision;
    revision = command(checkout, 'git', ['rev-parse', 'HEAD']);
    for (let shard = 1; shard <= 4; shard++) {
        const packet = join(input, `shard-${shard}.json`);
        writeFileSync(packet, readFileSync(packet, 'utf8').replace(unseeded, revision));
    }
    const initialized = runGate();
    expect(initialized.stderr).toBe('');
    expect(initialized.status).toBe(0);

    const reportPath = join(input, 'shard-4.json');
    const saved = readFileSync(reportPath, 'utf8');
    writeFileSync(reportPath, saved.replace('"attempt":"1"', '"attempt":"2"'));
    const stale = runGate();
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('Coverage identity mismatch in shard-4.json');
    rmSync(reportPath);
    const missing = runGate();
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('exactly one report from each of the four unit shards');
}, 45_000);
