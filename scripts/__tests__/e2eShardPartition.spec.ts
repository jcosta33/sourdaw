import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    parseSpecDurations,
    partitionByDuration,
    readSpecDurations,
    specDurationsFromReport,
} from '../e2eShardPartition';
import { selectValidationPlan, SMOKE_SPEC } from '../prValidationScope';

const folders: string[] = [];

afterEach(() => {
    for (const folder of folders.splice(0)) {
        rmSync(folder, { recursive: true, force: true });
    }
});

function spec(name: string): string {
    return `tests/e2e/${name}.spec.ts`;
}

function durations(entries: Record<string, number>): Map<string, number> {
    return new Map(Object.entries(entries).map(([name, seconds]) => [spec(name), seconds]));
}

function report(overrides: { rootDir?: string; unexpected?: number; flaky?: number } = {}): string {
    const results = (...seconds: number[]) => seconds.map((value) => ({ duration: value * 1000 }));
    return JSON.stringify({
        config: { rootDir: overrides.rootDir ?? '/home/runner/work/sourdaw/sourdaw/tests/e2e' },
        stats: { unexpected: overrides.unexpected ?? 0, flaky: overrides.flaky ?? 0 },
        suites: [
            {
                file: 'alpha.spec.ts',
                specs: [{ tests: [{ results: results(2) }] }],
                suites: [{ specs: [{ tests: [{ results: results(3) }, { results: results(4.04) }] }] }],
            },
            { file: 'nested/beta.spec.ts', specs: [{ tests: [{ results: results(0.01) }] }] },
        ],
    });
}

describe('duration-balanced browser shards', () => {
    it('reduces to round-robin over sorted paths when no file has a recording', () => {
        const specs = ['e', 'c', 'a', 'd', 'b'].map(spec);
        expect(partitionByDuration(specs, new Map(), 2)).toEqual([['a', 'c', 'e'].map(spec), ['b', 'd'].map(spec)]);
    });

    it('places the longest files first, each into the group with the least recorded time', () => {
        // Path order runs opposite to duration order, so filling in path order
        // would load 13s against 20s; the greedy order loads 16s against 17s.
        const recorded = durations({ a: 1, b: 2, c: 3, d: 8, e: 9, f: 10 });
        expect(partitionByDuration([...recorded.keys()], recorded, 2)).toEqual([
            ['a', 'b', 'c', 'f'].map(spec),
            ['d', 'e'].map(spec),
        ]);
    });

    it('weighs a file without a recording as the median recorded file', () => {
        // Recorded out of order, so the median (9s) is neither the maximum, the
        // middle entry as written (20s), the middle of a string sort (3s) nor 1s;
        // each of those weights partitions these files differently.
        const recorded = durations({ p: 100, q: 9, r: 20, s: 3, t: 7 });
        expect(partitionByDuration(['q', 'r', 's', 't', 'unrecorded'].map(spec), recorded, 2)).toEqual([
            ['r', 's'].map(spec),
            ['q', 't', 'unrecorded'].map(spec),
        ]);
    });

    it('assigns every file exactly once to nonempty groups', () => {
        const specs = Array.from({ length: 40 }, (_, index) => spec(`case${index}`));
        const recorded = new Map(specs.map((path, index) => [path, ((index * 37) % 11) + 0.5]));
        for (const count of [1, 3, 12, 40]) {
            const groups = partitionByDuration(specs, recorded, count);
            expect(groups).toHaveLength(count);
            expect(groups.every((group) => group.length > 0)).toBe(true);
            expect(groups.flat().sort()).toEqual([...specs].sort());
        }
    });

    it('refuses a group count it cannot fill', () => {
        const specs = ['a', 'b'].map(spec);
        for (const count of [0, 3, 1.5]) {
            expect(() => partitionByDuration(specs, new Map(), count)).toThrow('Invalid E2E partition');
        }
    });

    it('lets one recorded slow file own a shard in the planned matrix', () => {
        const specs = Array.from({ length: 23 }, (_, index) => spec(`case${String(index).padStart(2, '0')}`));
        const slow = spec('slow');
        const recorded = new Map([[slow, 600], ...specs.map((path): [string, number] => [path, 20])]);
        const plan = selectValidationPlan(['src/app/bootstrap.ts'], [SMOKE_SPEC, slow, ...specs], recorded);
        expect(plan.matrix.include).toEqual([
            { id: 1, specs: [slow] },
            { id: 2, specs: [...specs].sort() },
        ]);
    });
});

describe('planned browser matrix', () => {
    it('partitions the plan command output by the committed durations', () => {
        const root = mkdtempSync(join(tmpdir(), 'e2e-shard-plan-'));
        folders.push(root);
        const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
        const recorded = [...readSpecDurations().keys()].sort().slice(0, 30);
        const inventory = [SMOKE_SPEC, ...recorded];
        for (const path of inventory) {
            mkdirSync(join(root, dirname(path)), { recursive: true });
            writeFileSync(join(root, path), '// browser fixture\n');
        }
        git(['init', '--quiet']);
        git(['config', 'user.email', 'ci@example.invalid']);
        git(['config', 'user.name', 'Shard test']);
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'base']);
        const base = git(['rev-parse', 'HEAD']);
        mkdirSync(join(root, 'src/app'), { recursive: true });
        writeFileSync(join(root, 'src/app/bootstrap.ts'), '// product change\n');
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'change product']);

        const result = spawnSync(process.execPath, [resolve('scripts/prValidationScope.ts'), 'plan'], {
            cwd: root,
            encoding: 'utf8',
            env: {
                ...process.env,
                BASE_SHA: base,
                HEAD_SHA: git(['rev-parse', 'HEAD']),
                GITHUB_OUTPUT: join(root, 'output'),
            },
        });

        expect(result.status, result.stderr).toBe(0);
        const balanced = selectValidationPlan(['src/app/bootstrap.ts'], inventory, readSpecDurations()).matrix;
        // Guards the fixture: the recorded files must partition differently from equal weights.
        expect(balanced).not.toEqual(selectValidationPlan(['src/app/bootstrap.ts'], inventory).matrix);
        expect(JSON.parse(readFileSync(join(root, 'pr-validation-scope.json'), 'utf8')).matrix).toEqual(balanced);
    });
});

const REPORTED = [spec('alpha'), spec('nested/beta')];

describe('recorded browser durations', () => {
    it('parses the committed table', () => {
        expect(readSpecDurations().size).toBeGreaterThan(0);
    });

    it.each([
        ['an array', '[]'],
        ['a path outside the browser suite', '{"src/app/bootstrap.ts": 1}'],
        ['a zero duration', '{"tests/e2e/a.spec.ts": 0}'],
        ['a textual duration', '{"tests/e2e/a.spec.ts": "1"}'],
        ['a non-finite duration', '{"tests/e2e/a.spec.ts": 1e999}'],
    ])('refuses %s', (_, text) => {
        expect(() => parseSpecDurations(text)).toThrow();
    });

    it('sums every result under a file, including nested describe blocks, keyed by repository path', () => {
        expect(specDurationsFromReport(report(), REPORTED)).toEqual({
            'tests/e2e/alpha.spec.ts': 9,
            'tests/e2e/nested/beta.spec.ts': 0.1,
        });
    });

    it('refuses a report rooted outside the browser suite', () => {
        expect(() =>
            specDurationsFromReport(report({ rootDir: '/home/runner/work/sourdaw/sourdaw' }), REPORTED)
        ).toThrow('Report root is not tests/e2e');
    });

    it.each([{ unexpected: 1 }, { flaky: 1 }])('refuses a report from a run that was not clean: %o', (stats) => {
        expect(() => specDurationsFromReport(report(stats), REPORTED)).toThrow('without failed or flaky tests');
    });

    it('refuses a clean report that omits a collected file, naming it', () => {
        expect(() => specDurationsFromReport(report(), [...REPORTED, spec('gamma')])).toThrow(spec('gamma'));
    });

    it('accepts a report covering every collected file when smoke is absent from it', () => {
        expect(Object.keys(specDurationsFromReport(report(), [...REPORTED, SMOKE_SPEC]))).toEqual(REPORTED);
    });

    it('runs the refresh command and refuses a partial report without writing', () => {
        const root = mkdtempSync(join(tmpdir(), 'e2e-refresh-'));
        folders.push(root);

        // Record committed table bytes before running the command
        const committedBytes = readFileSync(resolve('scripts/e2eSpecDurations.json'), 'utf8');

        // Create a temporary report that omits a collected file (gamma.spec.ts)
        const partialReport = {
            config: { rootDir: resolve('tests/e2e') },
            stats: { unexpected: 0, flaky: 0 },
            suites: [
                {
                    file: 'alpha.spec.ts',
                    specs: [{ tests: [{ results: [{ duration: 1000 }] }] }],
                },
                {
                    file: 'nested/beta.spec.ts',
                    specs: [{ tests: [{ results: [{ duration: 100 }] }] }],
                },
            ],
        };
        const reportPath = join(root, 'partial-report.json');
        writeFileSync(reportPath, JSON.stringify(partialReport));

        // Run the refresh command
        const result = spawnSync(process.execPath, [resolve('scripts/e2eShardPartition.ts'), 'refresh', reportPath], {
            encoding: 'utf8',
        });

        // Assert the command failed
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('Report omits');

        // Assert the committed table is unchanged
        const tableAfter = readFileSync(resolve('scripts/e2eSpecDurations.json'), 'utf8');
        expect(tableAfter).toBe(committedBytes);
    });
});
