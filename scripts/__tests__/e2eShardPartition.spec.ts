import { describe, expect, it } from 'vitest';

import {
    parseSpecDurations,
    partitionByDuration,
    readSpecDurations,
    specDurationsFromReport,
} from '../e2eShardPartition';
import { selectValidationPlan, SMOKE_SPEC } from '../prValidationScope';

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
        const recorded = durations({ a: 5, b: 4, c: 4, p: 10, q: 10, r: 10, s: 10 });
        expect(partitionByDuration(['a', 'b', 'c', 'unrecorded'].map(spec), recorded, 2)).toEqual([
            [spec('unrecorded')],
            ['a', 'b', 'c'].map(spec),
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

describe('recorded browser durations', () => {
    it('parses the committed table', () => {
        expect(readSpecDurations().size).toBeGreaterThan(0);
    });

    it.each([
        ['an array', '[]'],
        ['a path outside the browser suite', '{"src/app/bootstrap.ts": 1}'],
        ['a zero duration', '{"tests/e2e/a.spec.ts": 0}'],
        ['a textual duration', '{"tests/e2e/a.spec.ts": "1"}'],
    ])('refuses %s', (_, text) => {
        expect(() => parseSpecDurations(text)).toThrow();
    });

    it('sums every result under a file, including nested describe blocks, keyed by repository path', () => {
        expect(specDurationsFromReport(report())).toEqual({
            'tests/e2e/alpha.spec.ts': 9,
            'tests/e2e/nested/beta.spec.ts': 0.1,
        });
    });

    it('refuses a report rooted outside the browser suite', () => {
        expect(() => specDurationsFromReport(report({ rootDir: '/home/runner/work/sourdaw/sourdaw' }))).toThrow(
            'Report root is not tests/e2e'
        );
    });

    it.each([{ unexpected: 1 }, { flaky: 1 }])('refuses a report from a run that was not clean: %o', (stats) => {
        expect(() => specDurationsFromReport(report(stats))).toThrow('without failed or flaky tests');
    });
});
