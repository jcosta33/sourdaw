import { describe, expect, it } from 'vitest';

import { offPageSources, type RuntimeGraph } from '../e2eAffectedGraph';
import {
    coverageMapFrom,
    selectCoverageSpecs,
    type ChangedProductPath,
    type CoverageSelectionInput,
    type CoverageSources,
    type RuntimeView,
} from '../e2eCoverageSelection';

import type { CoverageMap } from '../e2eCoverageMap';

const MAP_COMMIT = 'c0ffee'.padEnd(40, '0');
const FEED = 'src/modules/Feed/useCases/feed.ts';
const PANEL = 'src/modules/Feed/presentations/views/FeedPanel.tsx';
const NEVER = 'src/utils/neverExecuted.ts';
const WORKLET = 'src/modules/AudioEngine/worklets/glutenProcessor.ts';
const WORKLET_DSP = 'src/modules/AudioEngine/worklets/glutenDsp.ts';
const WORKER = 'src/modules/Feed/workers/feedWorker.ts';
const NODE = 'src/modules/AudioEngine/engine/GlutenNode.ts';
const HOST = 'src/modules/Feed/repositories/feedHost.ts';

const SPEC = (name: string): string => `tests/e2e/${name}.spec.ts`;
const MAP: CoverageMap = {
    format: 'e2e-coverage-map-v1',
    commit: MAP_COMMIT,
    specs: [SPEC('alpha'), SPEC('beta'), SPEC('browserAiProof'), SPEC('delta'), SPEC('gamma')],
    alwaysSelect: [SPEC('delta')],
    files: {
        [FEED]: { blob: 'f'.repeat(40), specs: [4, 0] },
        [PANEL]: { blob: 'e'.repeat(40), specs: [2] },
        [WORKLET_DSP]: { blob: 'd'.repeat(40), specs: [1] },
    },
};
// Unsorted, with the smoke spec, a spec the map never saw, and none of the map's deleted specs.
const AVAILABLE = [
    SPEC('gamma'),
    'tests/e2e/smoke.spec.ts',
    SPEC('fresh'),
    SPEC('alpha'),
    SPEC('beta'),
    SPEC('delta'),
    SPEC('browserAiProof'),
];
const EXTRAS = [SPEC('delta'), SPEC('fresh')];

const FEED_BASE = `import { clamp } from '../../../utils/math';

export type FeedItem = { id: string };
// Feed helpers.
const LIMIT = 10;

export function feed(items: readonly FeedItem[]): FeedItem[] {
    const kept = items.slice(0, LIMIT);
    return kept.map((item) => ({ ...item, id: clamp(item.id) }));
}

export class Feeder {
    size = 3;
    constructor(private readonly name: string) {}
    describe(): string {
        return this.name;
    }
}

export enum Mode {
    A,
    B,
}
`;

const PANEL_BASE = `export function FeedPanel({ title }: { title: string }) {
    return <section>{title}</section>;
}
`;

type FileFixture = { base: string; head: string; baseBlob: string | null; mapBlob?: string | null };

function sourcesOf(files: Readonly<Record<string, FileFixture>>): CoverageSources {
    const file = (path: string): FileFixture => {
        const fixture = files[path];
        if (fixture === undefined) {
            throw new Error(`unexpected read: ${path}`);
        }
        return fixture;
    };
    return {
        baseBlob: (path) => file(path).baseBlob,
        mapCommitBlob: (path) => file(path).mapBlob,
        baseText: (path) => file(path).base,
        headText: (path) => file(path).head,
    };
}

const RUNTIME: RuntimeView = {
    kind: 'graph',
    sources: new Set([FEED, PANEL, NEVER, WORKER, WORKLET, WORKLET_DSP, HOST, NODE]),
    offPage: new Set([WORKER, WORKLET, WORKLET_DSP]),
};

function feedEdit(head: string, base = FEED_BASE): FileFixture {
    return { base, head, baseBlob: 'f'.repeat(40) };
}

// A file the map never saw execute, unchanged since the map commit.
function neverEdit(base: string, head: string): FileFixture {
    return { base, head, baseBlob: 'a'.repeat(40), mapBlob: 'a'.repeat(40) };
}

const TEMPLATED = FEED_BASE.replace('return this.name;', 'return `<${this.name}>\n</>`;');
const CRLF = FEED_BASE.replaceAll('\n', '\r\n');
const DOCUMENTED = FEED_BASE.replace('export function feed', '/** Keeps the first items. */\nexport function feed');
const SIDE_EFFECT = 'const LIMIT = 10;\nregisterSideEffect();\n';
const COMMENTED_SIDE_EFFECT = FEED_BASE.replace(
    'const LIMIT = 10;\n',
    'const LIMIT = 10;\n/*\nregisterSideEffect();\n*/\n'
);
const LIVE_SIDE_EFFECT = FEED_BASE.replace('const LIMIT = 10;\n', SIDE_EFFECT);
const EXPORTED = FEED_BASE.replace('const LIMIT = 10;', 'export const LIMIT = 10;');
const BANNER = FEED_BASE.replace('const LIMIT = 10;\n', 'const LIMIT = 10;\nexport const BANNER = `feed\nready`;\n');
// Git sees four lines; a lone CR or U+2028 inside the comment is a line break only to TypeScript.
const SEPARATED = (separator: string): string =>
    `// a${separator}b\nexport function f(): number {\n    let x = 1; return x;\n} const TOP = 1;\n`;
const GETTER = 'export const box = {\n    get size(): number {\n        return 1;\n    },\n};\n';
// Automatic semicolon insertion parses a line break after `return` or before `++` differently.
const SPLIT_RETURN = FEED_BASE.replace('return this.name;', 'return\n            this.name;');
const POSTFIX = 'let a = 0;\nlet b = 0;\na++\nb\n';
const STEP = `export function step(): number {\n    ${POSTFIX.replaceAll('\n', '\n    ')}return a + b;\n}\n`;
const PANEL_PRAGMA = `/** @jsxImportSource preact */\n${PANEL_BASE}`;

function select(
    files: Readonly<Record<string, FileFixture>>,
    overrides: Partial<CoverageSelectionInput> = {}
): ReturnType<typeof selectCoverageSpecs> {
    const changes: ChangedProductPath[] = Object.keys(files).map((path) => ({ path, status: 'M' }));
    return selectCoverageSpecs({
        changes,
        map: { kind: 'map', map: MAP },
        runtime: RUNTIME,
        availableSpecs: AVAILABLE,
        sources: sourcesOf(files),
        ...overrides,
    });
}

function selectedSpecs(selection: ReturnType<typeof selectCoverageSpecs>): string[] {
    if (selection.kind !== 'specs') {
        throw new Error(`expected narrowed specs, got: ${selection.reason}`);
    }
    return [...new Set(selection.paths.flatMap((path) => path.specs))].sort();
}

describe('coverage-map selection narrows', () => {
    it.each([
        ['a statement inside a function body', FEED_BASE.replace('slice(0, LIMIT)', 'slice(1, LIMIT)')],
        [
            'a line inserted inside a function body',
            FEED_BASE.replace('    return kept.map', '    void kept;\n    return kept.map'),
        ],
        ['a method body', FEED_BASE.replace('return this.name;', 'return this.name.trim();')],
        ['a deleted body line', FEED_BASE.replace('        return this.name;\n', '')],
        ['a blank line inside a template literal within a body', TEMPLATED.replace('>\n</>', '>\n\n</>'), TEMPLATED],
        ['a body edit in a CRLF file', CRLF.replace('slice(0, LIMIT)', 'slice(1, LIMIT)'), CRLF],
        ['a line break after a return', SPLIT_RETURN],
        ['a line break removed after a return', FEED_BASE, SPLIT_RETURN],
    ])('to exactly the file specs, always-selected and unmapped specs for %s', (_, head, base?: string) => {
        const selection = select({ [FEED]: feedEdit(head, base) });
        expect(selectedSpecs(selection)).toEqual([SPEC('alpha'), SPEC('delta'), SPEC('fresh'), SPEC('gamma')]);
        expect(selection).toMatchObject({
            kind: 'specs',
            paths: [
                {
                    path: FEED,
                    browserAi: false,
                    reason: expect.stringContaining('function-body change executed by 2 mapped specs'),
                },
            ],
        });
    });

    it('unions two files and follows a browser-AI spec into hardware admission', () => {
        const selection = select({
            [FEED]: feedEdit(FEED_BASE.replace('slice(0, LIMIT)', 'slice(2, LIMIT)')),
            [PANEL]: {
                base: PANEL_BASE,
                head: PANEL_BASE.replace('<section>', '<section aria-label="feed">'),
                baseBlob: 'e'.repeat(40),
            },
        });
        expect(selectedSpecs(selection)).toEqual([
            SPEC('alpha'),
            SPEC('browserAiProof'),
            SPEC('delta'),
            SPEC('fresh'),
            SPEC('gamma'),
        ]);
        expect(selection).toMatchObject({
            paths: [
                { path: FEED, browserAi: false },
                { path: PANEL, browserAi: true },
            ],
        });
    });

    it('selects only always-selected and unmapped specs for a never-executed file unchanged since the map commit', () => {
        const base = 'export function never(): number {\n    return 1;\n}\n';
        const selection = select({
            [NEVER]: {
                base,
                head: base.replace('return 1', 'return 2'),
                baseBlob: 'a'.repeat(40),
                mapBlob: 'a'.repeat(40),
            },
        });
        expect(selectedSpecs(selection)).toEqual(EXTRAS);
    });

    it('treats a line break before a postfix increment in a body as a body change', () => {
        const selection = select({ [NEVER]: neverEdit(STEP, STEP.replace('a++\n    b', 'a\n    ++b')) });
        expect(selection).toMatchObject({ paths: [{ reason: expect.stringContaining('function-body change') }] });
    });

    it('treats a getter body in a top-level object literal as a function body', () => {
        const selection = select({ [NEVER]: neverEdit(GETTER, GETTER.replace('return 1', 'return 2')) });
        expect(selectedSpecs(selection)).toEqual(EXTRAS);
        expect(selection).toMatchObject({ paths: [{ reason: expect.stringContaining('function-body change') }] });
    });

    it.each([
        ['type-only', FEED_BASE.replace('{ id: string }', '{ id: string; label?: string }')],
        ['comment-only', FEED_BASE.replace('// Feed helpers.', '// Helpers for the feed.')],
        ['blank-line', FEED_BASE.replace('const LIMIT = 10;\n', 'const LIMIT = 10;\n\n')],
        [
            'inserted interface',
            FEED_BASE.replace('// Feed helpers.\n', '// Feed helpers.\ninterface Extra {\n    note: string;\n}\n'),
        ],
        ['block-comment', FEED_BASE.replace('// Feed helpers.\n', '// Feed helpers.\n/* More helpers. */\n')],
        ['JSDoc', DOCUMENTED.replace('first items', 'leading items'), DOCUMENTED],
        ['top-level blank-lines', FEED_BASE.replace('}\n\nexport class', '}\n\n\n\nexport class')],
        [
            'call-wrapping',
            FEED_BASE.replace(
                'kept.map((item) => ({ ...item, id: clamp(item.id) }))',
                'kept.map(\n        (item) => ({ ...item, id: clamp(item.id) })\n    )'
            ),
        ],
    ])('contributes no file specs for a %s change', (_, head, base?: string) => {
        const selection = select({ [FEED]: feedEdit(head, base) });
        expect(selectedSpecs(selection)).toEqual(EXTRAS);
        expect(selection).toMatchObject({
            paths: [{ reason: expect.stringContaining('type-only or comment change') }],
        });
    });
});

describe('coverage-map selection stays full', () => {
    it.each([
        ['an import line', FEED_BASE.replace("'../../../utils/math'", "'../../../utils/maths'"), 'head line 1'],
        ['a top-level const', FEED_BASE.replace('LIMIT = 10', 'LIMIT = 11'), 'head line 5'],
        ['a class property initializer', FEED_BASE.replace('size = 3', 'size = 4'), 'head line 13'],
        [
            'a parameter list',
            FEED_BASE.replace('items: readonly FeedItem[])', 'items: readonly FeedItem[], extra = 0)'),
            'head line 7',
        ],
        ['an enum member', FEED_BASE.replace('    B,\n', '    B,\n    C,\n'), 'head line 23'],
        [
            'a top-level insertion',
            FEED_BASE.replace('const LIMIT = 10;\n', 'const LIMIT = 10;\nexport const EXTRA = 1;\n'),
            'head line 6',
        ],
        [
            'a hunk spanning out of a body',
            FEED_BASE.replace(
                '    return kept.map((item) => ({ ...item, id: clamp(item.id) }));\n}',
                '    return kept;\n}\nfeed([]);'
            ),
            'head line 11',
        ],
        ['removed comment delimiters around a top-level call', LIVE_SIDE_EFFECT, 'head line 6', COMMENTED_SIDE_EFFECT],
        ['added comment delimiters around a top-level call', COMMENTED_SIDE_EFFECT, 'head line 10', LIVE_SIDE_EFFECT],
        [
            'a commented-out top-level export',
            EXPORTED.replace('export const', '// export const'),
            'head line 7',
            EXPORTED,
        ],
        [
            'a blank line inside a top-level template literal',
            BANNER.replace('feed\n', 'feed\n\n'),
            'head line 6',
            BANNER,
        ],
        [
            'a whitespace-only line inside a top-level template literal',
            BANNER.replace('feed\n', 'feed\n    \n'),
            'head line 6',
            BANNER,
        ],
    ])('for a change to %s', (_, head, where, base?: string) => {
        expect(select({ [FEED]: feedEdit(head, base) })).toEqual({
            kind: 'full',
            reason: `${FEED}: change outside a function body at ${where}`,
        });
    });

    it.each([
        ['a stylesheet', 'src/styles/app.css', 'M'],
        ['JSON under src', 'src/data/presets.json', 'M'],
        ['a declaration file', 'src/types/audio-worklet.d.ts', 'M'],
        ['a path outside src', 'vite.config.ts', 'M'],
    ])('for %s', (_, path, status) => {
        expect(select({}, { changes: [{ path, status }] })).toEqual({
            kind: 'full',
            reason: `${path}: not a TypeScript source under src/`,
        });
    });

    it.each(['R087', 'C100', 'D', 'T'])('for a %s status', (status) => {
        expect(select({}, { changes: [{ path: FEED, status }] })).toEqual({
            kind: 'full',
            reason: `${FEED}: deleted, renamed, copied, or retyped`,
        });
    });

    it('for a file a worker or worklet loads, as derived from the runtime graph', () => {
        const graph: RuntimeGraph = {
            kind: 'graph',
            graph: [
                {
                    source: NODE,
                    dependencies: [{ resolved: WORKLET, module: '../worklets/glutenProcessor.ts?worker&url' }],
                },
                { source: WORKLET, dependencies: [{ resolved: WORKLET_DSP, module: './glutenDsp' }] },
                { source: WORKLET_DSP, dependencies: [] },
                { source: HOST, dependencies: [{ resolved: WORKER }] },
                { source: WORKER, dependencies: [] },
                { source: FEED, dependencies: [] },
            ],
            opaqueSources: new Set(),
            workerEntries: new Set([WORKER]),
        };
        const offPage = offPageSources(graph);
        expect([...offPage].sort()).toEqual([WORKER, WORKLET_DSP, WORKLET].sort());
        const runtime: RuntimeView = { kind: 'graph', sources: RUNTIME.sources, offPage };
        const dsp = 'export function gain(x: number): number {\n    return x;\n}\n';
        for (const path of [WORKER, WORKLET_DSP]) {
            expect(
                select(
                    { [path]: { base: dsp, head: dsp.replace('return x', 'return -x'), baseBlob: 'd'.repeat(40) } },
                    { runtime }
                )
            ).toEqual({
                kind: 'full',
                reason: `${path}: loaded by a worker or audio worklet, which page coverage cannot see`,
            });
        }
        expect(() => offPageSources({ ...graph, opaqueSources: new Set([HOST]) })).toThrow(
            `opaque runtime dependency: ${HOST}`
        );
    });

    it('for a file changed since the map commit', () => {
        const fixture = {
            ...feedEdit(FEED_BASE.replace('slice(0, LIMIT)', 'slice(1, LIMIT)')),
            baseBlob: 'b'.repeat(40),
        };
        expect(select({ [FEED]: fixture })).toEqual({
            kind: 'full',
            reason: `${FEED}: changed since the coverage map commit`,
        });
    });

    it('for a file absent from the map whose map commit cannot be read, or that changed since', () => {
        const base = 'export function never(): number {\n    return 1;\n}\n';
        const head = base.replace('return 1', 'return 2');
        expect(select({ [NEVER]: { base, head, baseBlob: 'a'.repeat(40), mapBlob: undefined } })).toEqual({
            kind: 'full',
            reason: `${NEVER}: absent from the coverage map and its commit is unavailable`,
        });
        expect(select({ [NEVER]: { base, head, baseBlob: 'a'.repeat(40), mapBlob: null } })).toEqual({
            kind: 'full',
            reason: `${NEVER}: absent from the coverage map and changed since its commit`,
        });
    });

    it.each([
        ['U+2028', '\u2028'],
        ['a lone CR', '\r'],
    ])('for a top-level edit after %s inside a comment', (_, separator) => {
        const base = SEPARATED(separator);
        expect(select({ [NEVER]: neverEdit(base, base.replace('TOP = 1', 'TOP = 2')) })).toEqual({
            kind: 'full',
            reason: `${NEVER}: change outside a function body at head line 4`,
        });
    });

    it('for a line break before a postfix increment in top-level code', () => {
        expect(select({ [NEVER]: neverEdit(POSTFIX, POSTFIX.replace('a++\nb', 'a\n++b')) })).toEqual({
            kind: 'full',
            reason: `${NEVER}: change outside a function body at head line 3`,
        });
    });

    it.each([
        ['added', PANEL_BASE, PANEL_PRAGMA, 'head line 1'],
        ['removed', PANEL_PRAGMA, PANEL_BASE, 'head line 1'],
        ['edited', PANEL_PRAGMA, PANEL_PRAGMA.replace('preact', 'solid-js'), 'head line 1'],
        ['added after the first line', PANEL_BASE, `${PANEL_BASE}/* @jsx h */\n`, 'head line 4'],
    ])('for a JSX pragma %s', (_, base, head, where) => {
        expect(select({ [PANEL]: { base, head, baseBlob: 'e'.repeat(40) } })).toEqual({
            kind: 'full',
            reason: `${PANEL}: change outside a function body at ${where}`,
        });
    });

    it('for a file that does not parse', () => {
        const head = FEED_BASE.replace('slice(0, LIMIT)', 'slice(0, LIMIT');
        expect(select({ [FEED]: feedEdit(head) })).toEqual({ kind: 'full', reason: `${FEED}: does not parse` });
    });

    it('when one path narrows and another does not', () => {
        const base = 'export const LEVEL = 1;\nexport function level(): number {\n    return LEVEL;\n}\n';
        expect(
            select({
                [FEED]: feedEdit(FEED_BASE.replace('slice(0, LIMIT)', 'slice(1, LIMIT)')),
                [NEVER]: {
                    base,
                    head: base.replace('LEVEL = 1', 'LEVEL = 2'),
                    baseBlob: 'a'.repeat(40),
                    mapBlob: 'a'.repeat(40),
                },
            })
        ).toEqual({ kind: 'full', reason: `${NEVER}: change outside a function body at head line 1` });
    });

    it('when the runtime graph is unavailable', () => {
        expect(
            select(
                { [FEED]: feedEdit(FEED_BASE) },
                { runtime: { kind: 'full', reason: 'opaque runtime dependency: x' } }
            )
        ).toEqual({
            kind: 'full',
            reason: 'runtime graph unavailable: opaque runtime dependency: x',
        });
    });
});

describe('coverage map availability', () => {
    const now = new Date('2026-11-01T12:00:00Z');
    const text = JSON.stringify(MAP);

    it('accepts a well-formed map built within three days', () => {
        expect(coverageMapFrom(text, '2026-10-29T13:00:00Z', now)).toEqual({ kind: 'map', map: MAP });
    });

    it.each([
        ['missing', undefined, '2026-11-01T03:00:00Z', 'no coverage map was retrieved'],
        ['expired', text, '2026-10-29T11:00:00Z', 'coverage map is older than three days'],
        ['undated', text, undefined, 'coverage map age is unknown'],
        ['future-dated', text, '2026-11-01T13:00:00Z', 'coverage map is dated in the future'],
        [
            'in the wrong format',
            JSON.stringify({ ...MAP, format: 'e2e-coverage-map-v0' }),
            '2026-11-01T03:00:00Z',
            'coverage map is unreadable: not an e2e-coverage-map-v1 document',
        ],
        [
            'indexing a spec it does not list',
            JSON.stringify({ ...MAP, files: { [FEED]: { blob: 'f'.repeat(40), specs: [5] } } }),
            '2026-11-01T03:00:00Z',
            `coverage map is unreadable: coverage map entry is invalid: ${FEED}`,
        ],
        ['not JSON', '{', '2026-11-01T03:00:00Z', 'coverage map is unreadable:'],
    ])('keeps the full suite for a map %s', (_, mapText, createdAt, reason) => {
        const map = coverageMapFrom(mapText, createdAt, now);
        expect(map).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining(reason) });
        expect(select({ [FEED]: feedEdit(FEED_BASE) }, { map })).toEqual({
            kind: 'full',
            reason: expect.stringContaining(reason),
        });
    });
});
