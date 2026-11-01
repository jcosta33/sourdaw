// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildCoverageMap, parseCoverageRecord, specsPerFile, summarizeCoverageMap } from '../e2eCoverageMap';
import { type CoverageEntry, type CoverageRecord, executedSourceFiles } from '../e2eCoverageRecord';

const COMMIT = 'a'.repeat(40);
const ORIGIN = 'http://127.0.0.1:5402';

// Unsorted on purpose: sorted, they index alpha 0, beta 1, lonely 2, mid 3, zeta 4.
const SPECS = [
    'tests/e2e/zeta.spec.ts',
    'tests/e2e/alpha.spec.ts',
    'tests/e2e/mid.spec.ts',
    'tests/e2e/beta.spec.ts',
    'tests/e2e/lonely.spec.ts',
];

const BLOBS = new Map([
    ['src/a.ts', '1'.repeat(40)],
    ['src/b.ts', '2'.repeat(40)],
    ['src/c.ts', '3'.repeat(40)],
    ['src/d.ts', '4'.repeat(40)],
]);

function record(spec: string, executedFiles: string[], overrides: Partial<CoverageRecord> = {}): CoverageRecord {
    return {
        spec: `tests/e2e/${spec}.spec.ts`,
        testId: `${spec}-${executedFiles.join('+')}`,
        title: `${spec} test`,
        status: 'passed',
        complete: true,
        executedFiles,
        ...overrides,
    };
}

function build(records: CoverageRecord[], specs: readonly string[] = SPECS) {
    return buildCoverageMap({ commit: COMMIT, specs, records, blobs: BLOBS });
}

// Every listed spec has a passing, complete record unless a case says otherwise.
const BASELINE = [
    record('zeta', ['src/b.ts', 'src/a.ts']),
    record('alpha', ['src/c.ts']),
    record('mid', ['src/a.ts']),
    record('beta', ['src/d.ts', 'src/b.ts', 'src/c.ts']),
    record('lonely', []),
];

describe('buildCoverageMap', () => {
    it('indexes sorted specs and lists every spec executing a file in ascending index order', () => {
        const map = build(BASELINE);

        expect(map.specs).toEqual([
            'tests/e2e/alpha.spec.ts',
            'tests/e2e/beta.spec.ts',
            'tests/e2e/lonely.spec.ts',
            'tests/e2e/mid.spec.ts',
            'tests/e2e/zeta.spec.ts',
        ]);
        expect(map.alwaysSelect).toEqual([]);
        expect(map.files).toEqual({
            'src/a.ts': { blob: '1'.repeat(40), specs: [3, 4] },
            'src/b.ts': { blob: '2'.repeat(40), specs: [1, 4] },
            'src/c.ts': { blob: '3'.repeat(40), specs: [0, 1] },
            'src/d.ts': { blob: '4'.repeat(40), specs: [1] },
        });
        expect(Object.keys(map.files)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']);
    });

    it.each([
        ['an incomplete record', { complete: false }],
        ['a failed test', { status: 'failed' }],
        ['a timed-out test', { status: 'timedOut' }],
        ['an interrupted test', { status: 'interrupted' }],
        ['a skipped test', { status: 'skipped' }],
    ] satisfies Array<[string, Partial<CoverageRecord>]>)(
        'always selects the spec of %s and takes no files from it',
        (_name, overrides) => {
            const records = BASELINE.map((entry) =>
                entry.spec === 'tests/e2e/beta.spec.ts' ? { ...entry, ...overrides } : entry
            );

            const map = build(records);

            expect(map.alwaysSelect).toEqual(['tests/e2e/beta.spec.ts']);
            expect(map.files['src/d.ts']).toBeUndefined();
            expect(map.files['src/b.ts']?.specs).toEqual([4]);
            expect(map.files['src/c.ts']?.specs).toEqual([0]);
        }
    );

    it('keeps the passing tests of a spec that also always selects for a failing one', () => {
        const map = build([...BASELINE, record('mid', ['src/d.ts'], { testId: 'mid-failed', status: 'failed' })]);

        expect(map.alwaysSelect).toEqual(['tests/e2e/mid.spec.ts']);
        expect(map.files['src/a.ts']?.specs).toEqual([3, 4]);
        expect(map.files['src/d.ts']?.specs).toEqual([1]);
    });

    it('always selects every listed spec without any record', () => {
        const records = BASELINE.filter(
            (entry) => entry.spec !== 'tests/e2e/lonely.spec.ts' && entry.spec !== 'tests/e2e/alpha.spec.ts'
        );

        const map = build(records);

        expect(map.alwaysSelect).toEqual(['tests/e2e/alpha.spec.ts', 'tests/e2e/lonely.spec.ts']);
        expect(map.files['src/c.ts']?.specs).toEqual([1]);
    });

    it('writes the same map whatever order the specs and records arrive in', () => {
        const reordered = build([...BASELINE].reverse(), [...SPECS].reverse());

        expect(JSON.stringify(reordered)).toBe(JSON.stringify(build(BASELINE)));
    });

    it.each([
        ['an empty spec inventory', () => build(BASELINE, []), 'inventory is empty'],
        ['no records', () => build([]), 'No E2E coverage records'],
        ['a record outside the inventory', () => build([...BASELINE, record('gone', [])]), 'gone.spec.ts'],
        ['an executed file absent from the commit', () => build([record('alpha', ['src/new.ts'])]), 'src/new.ts'],
    ])('refuses %s', (_name, run, message) => {
        expect(run).toThrow(message);
    });
});

describe('specsPerFile', () => {
    it('reports the nearest-rank spread of specs per file', () => {
        // Specs per file: a 2, b 2, c 2, d 1.
        expect(specsPerFile(build(BASELINE))).toEqual({ min: 1, median: 2, p90: 2, max: 2 });
        const skewed = build([
            ...BASELINE,
            record('alpha', ['src/a.ts', 'src/d.ts'], { testId: 'alpha-2' }),
            record('lonely', ['src/a.ts', 'src/d.ts'], { testId: 'lonely-2' }),
        ]);
        // Specs per file: a 4, b 2, c 2, d 3.
        expect(specsPerFile(skewed)).toEqual({ min: 2, median: 2, p90: 4, max: 4 });
    });

    it('summarises the map with no files', () => {
        const map = build([record('lonely', [])]);

        expect(specsPerFile(map)).toBeNull();
        expect(summarizeCoverageMap(map)).toContain('- Specs per file: none');
        expect(summarizeCoverageMap(map)).toContain('- Always selected: 4');
    });
});

describe('parseCoverageRecord', () => {
    const valid = record('alpha', ['src/c.ts']);

    it('reads a record the fixture writes', () => {
        expect(parseCoverageRecord(JSON.stringify(valid), 'r.json')).toEqual(valid);
    });

    it.each([
        ['an unknown status', { ...valid, status: 'flaky' }],
        ['a non-boolean completeness', { ...valid, complete: 'yes' }],
        ['a missing spec', { ...valid, spec: undefined }],
        ['non-string executed files', { ...valid, executedFiles: [1] }],
    ])('refuses %s', (_name, value) => {
        expect(() => parseCoverageRecord(JSON.stringify(value), 'r.json')).toThrow('r.json');
    });
});

function entry(path: string, source: string, functions: Array<[start: number, end: number, count: number]>) {
    return {
        url: `${ORIGIN}${path}`,
        source,
        functions: functions.map(([startOffset, endOffset, count]) => ({
            ranges: [{ startOffset, endOffset, count }],
        })),
    } satisfies CoverageEntry;
}

const SOURCE = 'x'.repeat(100);

describe('executedSourceFiles', () => {
    it.each([
        ['excludes a file whose top-level body alone ran', [entry('/src/a.ts', SOURCE, [[0, 100, 1]])], [], 1],
        [
            'includes a file in which a function ran',
            [
                entry('/src/a.ts', SOURCE, [
                    [0, 100, 1],
                    [10, 40, 3],
                ]),
            ],
            ['src/a.ts'],
            1,
        ],
        [
            'excludes a file whose functions were never called',
            [
                entry('/src/a.ts', SOURCE, [
                    [0, 100, 1],
                    [10, 40, 0],
                ]),
            ],
            [],
            1,
        ],
        [
            'counts a function that starts at offset zero without spanning the source',
            [
                entry('/src/a.ts', SOURCE, [
                    [0, 100, 1],
                    [0, 30, 1],
                ]),
            ],
            ['src/a.ts'],
            1,
        ],
        [
            'identifies the top-level body by its span, not its position',
            [
                entry('/src/a.ts', SOURCE, [
                    [10, 40, 0],
                    [0, 100, 1],
                ]),
            ],
            [],
            1,
        ],
        [
            'strips query strings and fragments and decodes the path',
            [
                entry('/src/My%20Panel.tsx?t=1712&import', SOURCE, [
                    [0, 100, 1],
                    [5, 9, 1],
                ]),
                entry('/src/b.ts#hash', SOURCE, [
                    [0, 100, 1],
                    [5, 9, 2],
                ]),
            ],
            ['src/My Panel.tsx', 'src/b.ts'],
            2,
        ],
        [
            'ignores paths outside /src/',
            [
                entry('/node_modules/.vite/deps/react.js?v=1', SOURCE, [
                    [0, 100, 1],
                    [5, 9, 1],
                ]),
                entry('/@vite/client', SOURCE, [
                    [0, 100, 1],
                    [5, 9, 1],
                ]),
                entry('/srcx/a.ts', SOURCE, [
                    [0, 100, 1],
                    [5, 9, 1],
                ]),
            ],
            [],
            0,
        ],
        [
            'ignores app paths on another origin',
            [
                {
                    ...entry('/src/a.ts', SOURCE, [
                        [0, 100, 1],
                        [5, 9, 1],
                    ]),
                    url: 'http://127.0.0.1:9999/src/a.ts',
                },
            ],
            [],
            0,
        ],
        [
            'merges repeated scripts of one file into one sorted list',
            [
                entry('/src/z.ts?t=2', SOURCE, [
                    [0, 100, 1],
                    [5, 9, 1],
                ]),
                entry('/src/a.ts', SOURCE, [
                    [0, 100, 1],
                    [5, 9, 1],
                ]),
                entry('/src/z.ts?t=1', SOURCE, [[0, 100, 1]]),
            ],
            ['src/a.ts', 'src/z.ts'],
            2,
        ],
    ] satisfies Array<[string, CoverageEntry[], string[], number]>)('%s', (_name, entries, expected, loadedSources) => {
        expect(executedSourceFiles(entries, ORIGIN)).toEqual({
            loadedSources,
            executedFiles: expected,
            unmeasured: [],
        });
    });

    it('reports app sources returned without their source text as unmeasured', () => {
        const { source: _source, ...withoutSource } = entry('/src/a.ts', SOURCE, [
            [0, 100, 1],
            [5, 9, 1],
        ]);

        expect(executedSourceFiles([withoutSource], ORIGIN)).toEqual({
            loadedSources: 1,
            executedFiles: [],
            unmeasured: ['src/a.ts'],
        });
    });
});
