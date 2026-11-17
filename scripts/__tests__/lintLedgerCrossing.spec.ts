import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    DEPENDENCY_BOUNDARY_BASELINE_FILES,
    REACHABILITY_CRUISE_EXCLUDE,
    REACHABILITY_CRUISE_ROOT,
    REACHABILITY_RESOLVER_INPUTS,
    TRANSITIVE_BOUNDARY_BASELINE_FILES,
    lintLedgerCrossingPaths,
    lintLedgerCrossingRefusal,
    readLintLedgerCrossing,
    type GitCapture,
    type LedgerTree,
    type LedgerTrees,
} from '../lintLedgerCrossing.ts';

const SUP = 'eslint-suppressions.json';
const OXC = '.oxlintrc.json';
const CRAFT = 'oxlint.craft-baseline.mjs';
const QUALITY = 'oxlint-quality-baseline.json';
const SIZE = 'eslint.size-baseline.mjs';
const CEIL = 'scripts/lintSizeCeilings.json';
const PLG = '.oxlint-plugins.json';

function unchanged(tree: LedgerTree): LedgerTrees {
    return { base: tree, main: tree, head: tree };
}

const SUPPRESSIONS = JSON.stringify({ 'src/a.ts': { 'no-void': { count: 2 } } });
const OXLINT = `{
    // Burn-down baseline for func-style: today's offenders.
    "overrides": [{ "files": ["./src/c.ts", "**/*.ts"], "rules": { "func-style": "off" } }]
}`;
const SIZE_BASELINE = `export const sizeBaselineFiles = [\n    'src/big.ts',\n];\n`;
const CEILINGS = JSON.stringify({ 'src/big.ts': 700 });

function sizeBaseline(...paths: string[]): string {
    return `export const sizeBaselineFiles = [\n${paths.map((path) => `    '${path}',\n`).join('')}];\n`;
}

/** `.oxlint-plugins.json` shape: top-level rules plus the size-warning override listing `files`. */
function pluginSizeWarnings(files: string[], rule: unknown = 'warn'): string {
    return JSON.stringify({ rules: { eqeqeq: 'error' }, overrides: [{ files, rules: { 'max-lines': rule } }] });
}

describe('lint ledger crossing decision', () => {
    const cases: Array<{
        name: string;
        main: string[];
        pullRequest: string[];
        ledgers: LedgerTree;
        crossing: string[];
    }> = [
        {
            name: 'double prune of one suppressed file',
            main: ['eslint-suppressions.json', 'src/a.ts'],
            pullRequest: ['eslint-suppressions.json', 'src/a.ts'],
            ledgers: { [SUP]: SUPPRESSIONS },
            crossing: ['src/a.ts'],
        },
        {
            name: 'prunes of different suppressed files',
            main: ['eslint-suppressions.json', 'src/a.ts'],
            pullRequest: ['eslint-suppressions.json', 'src/b.ts'],
            ledgers: { [SUP]: JSON.stringify({ 'src/a.ts': {}, 'src/b.ts': {} }) },
            crossing: [],
        },
        {
            name: 'a file changed on both sides that no ledger binds',
            main: ['src/free.ts'],
            pullRequest: ['src/free.ts'],
            ledgers: { [SUP]: SUPPRESSIONS, [OXC]: OXLINT, [SIZE]: SIZE_BASELINE, [CEIL]: CEILINGS },
            crossing: [],
        },
        {
            name: 'a file bound only by the ledger one side added',
            main: ['src/new.ts'],
            pullRequest: ['src/new.ts', 'eslint-suppressions.json'],
            ledgers: { [SUP]: JSON.stringify({ 'src/new.ts': { 'no-void': { count: 1 } } }) },
            crossing: ['src/new.ts'],
        },
        {
            name: 'an oxlint baseline entry written with a ./ prefix',
            main: ['src/c.ts', '.oxlintrc.json'],
            pullRequest: ['src/c.ts'],
            ledgers: { [OXC]: OXLINT },
            crossing: ['src/c.ts'],
        },
        {
            name: 'a size-baselined file grown on both sides',
            main: ['src/big.ts'],
            pullRequest: ['src/big.ts'],
            ledgers: { [SIZE]: SIZE_BASELINE, [CEIL]: CEILINGS },
            crossing: ['src/big.ts'],
        },
        {
            name: 'a file named only in the ceilings ledger',
            main: ['src/big.ts'],
            pullRequest: ['src/big.ts'],
            ledgers: { [CEIL]: CEILINGS },
            crossing: ['src/big.ts'],
        },
        {
            name: 'ledger files themselves changed on both sides with no common source path',
            main: ['eslint-suppressions.json', '.oxlintrc.json', 'src/a.ts'],
            pullRequest: ['eslint-suppressions.json', '.oxlintrc.json', 'src/c.ts'],
            ledgers: { [SUP]: SUPPRESSIONS, [OXC]: OXLINT },
            crossing: [],
        },
        {
            name: 'an oxlint baseline entry after a block comment',
            main: ['src/c.ts', '.oxlintrc.json'],
            pullRequest: ['src/c.ts'],
            ledgers: { [OXC]: `{ /* "quoted" note */ ${OXLINT.slice(1)}` },
            crossing: ['src/c.ts'],
        },
        {
            name: 'an oxlint string holding an escaped quote before a comment marker',
            main: ['src/c.ts'],
            pullRequest: ['src/c.ts'],
            ledgers: {
                [OXC]: '{ "overrides": [{ "files": ["./src/c.ts"], "rules": { "r": ["error", { "pattern": "a\\"// b" }] } }] }',
            },
            crossing: ['src/c.ts'],
        },
        {
            name: 'a glob entry is not a literal path',
            main: ['src/d.ts'],
            pullRequest: ['src/d.ts'],
            ledgers: { [OXC]: OXLINT },
            crossing: [],
        },
    ];

    it.each(cases)('$name', ({ main, pullRequest, ledgers, crossing }) => {
        expect(lintLedgerCrossingPaths(main, pullRequest, unchanged(ledgers))).toEqual(crossing);
    });

    it('crosses a file both sides edit that only the pull request head binds', () => {
        const base = { [CEIL]: JSON.stringify({ 'src/y.ts': 700 }) };
        const head = { [CEIL]: JSON.stringify({ 'src/y.ts': 700, 'src/x.ts': 600 }) };
        expect(lintLedgerCrossingPaths(['src/x.ts'], ['src/x.ts', CEIL], { base, main: base, head })).toEqual([
            'src/x.ts',
        ]);
    });

    const CRAFT_WITH = "export const craftBaselineFiles = {\n    'r': [\n        'src/x.ts',\n    ],\n};\n";
    const CRAFT_WITHOUT = "export const craftBaselineFiles = {\n    'r': [\n    ],\n};\n";
    const CRAFT_OTHER_RULE = "export const craftBaselineFiles = {\n    's': [\n        'src/x.ts',\n    ],\n};\n";
    const OXLINT_WITH = '{ "overrides": [{ "files": ["./src/x.ts"], "rules": { "r": "off" } }] }';
    const OXLINT_WITHOUT = '{ "overrides": [{ "files": [], "rules": { "r": "off" } }] }';

    const ledgerOnlyEdits: Array<{ name: string; base: LedgerTree; edited: LedgerTree }> = [
        {
            name: 'a suppression count lowered',
            base: { [SUP]: JSON.stringify({ 'src/x.ts': { 'no-void': { count: 2 } } }) },
            edited: { [SUP]: JSON.stringify({ 'src/x.ts': { 'no-void': { count: 1 } } }) },
        },
        {
            name: 'a quality violation count lowered',
            base: { [QUALITY]: JSON.stringify({ 'src/x.ts': { 'vitest/valid-expect': { count: 2 } } }) },
            edited: { [QUALITY]: JSON.stringify({ 'src/x.ts': { 'vitest/valid-expect': { count: 1 } } }) },
        },
        {
            name: 'one of two rules suppressed at the same figure removed',
            base: { [SUP]: JSON.stringify({ 'src/x.ts': { 'no-void': { count: 1 }, 'no-var': { count: 1 } } }) },
            edited: { [SUP]: JSON.stringify({ 'src/x.ts': { 'no-var': { count: 1 } } }) },
        },
        {
            name: 'a size ceiling lowered',
            base: { [CEIL]: JSON.stringify({ 'src/x.ts': 700 }) },
            edited: { [CEIL]: JSON.stringify({ 'src/x.ts': 600 }) },
        },
        { name: 'an oxlint override entry removed', base: { [OXC]: OXLINT_WITH }, edited: { [OXC]: OXLINT_WITHOUT } },
        {
            name: 'a craft baseline entry removed',
            base: { [CRAFT]: CRAFT_WITH },
            edited: { [CRAFT]: CRAFT_WITHOUT },
        },
        {
            name: 'a craft baseline entry moved to another rule',
            base: { [CRAFT]: CRAFT_WITH },
            edited: { [CRAFT]: CRAFT_OTHER_RULE },
        },
        {
            name: 'a size baseline entry removed',
            base: { [SIZE]: SIZE_BASELINE.replace('src/big.ts', 'src/x.ts') },
            edited: { [SIZE]: 'export const sizeBaselineFiles = [\n];\n' },
        },
    ];

    it.each(ledgerOnlyEdits)('$name on main crosses a file edit on the pull request, and the mirror', (edit) => {
        const { base, edited } = edit;
        expect(lintLedgerCrossingPaths([], ['src/x.ts'], { base, main: edited, head: base })).toEqual(['src/x.ts']);
        expect(lintLedgerCrossingPaths(['src/x.ts'], [], { base, main: base, head: edited })).toEqual(['src/x.ts']);
    });

    it.each(ledgerOnlyEdits)('$name on both sides with no file edit crosses', (edit) => {
        const { base, edited } = edit;
        expect(lintLedgerCrossingPaths([], [], { base, main: edited, head: edited })).toEqual(['src/x.ts']);
    });

    it('does not cross when the two sides edit only different paths bindings', () => {
        const ceilings = (x: number, y: number): LedgerTree => ({
            [CEIL]: JSON.stringify({ 'src/x.ts': x, 'src/y.ts': y }),
        });
        expect(
            lintLedgerCrossingPaths([], [], {
                base: ceilings(700, 700),
                main: ceilings(600, 700),
                head: ceilings(700, 600),
            })
        ).toEqual([]);
    });

    it('does not cross a ledger edit on one side with no file edit on the other', () => {
        const base = { [CEIL]: JSON.stringify({ 'src/x.ts': 700 }) };
        const edited = { [CEIL]: JSON.stringify({ 'src/x.ts': 600 }) };
        expect(lintLedgerCrossingPaths([], [], { base, main: edited, head: base })).toEqual([]);
    });

    it('does not cross when one side rewrites a figure with the same members in another order, and the mirror', () => {
        const base = {
            [OXC]: '{ "overrides": [{ "files": ["./src/x.ts"], "rules": { "max-lines": ["error", { "max": 10, "skipComments": true }] } }] }',
        };
        const reordered = {
            [OXC]: '{ "overrides": [{ "files": ["./src/x.ts"], "rules": { "max-lines": ["error", { "skipComments": true, "max": 10 }] } }] }',
        };
        expect(lintLedgerCrossingPaths([], ['src/x.ts'], { base, main: reordered, head: base })).toEqual([]);
        expect(lintLedgerCrossingPaths(['src/x.ts'], [], { base, main: base, head: reordered })).toEqual([]);
    });

    it('crosses when main changes the rules of an override whose files list stays the same', () => {
        const withRules = (rule: string): LedgerTree => ({
            [OXC]: `{ "overrides": [{ "files": ["./src/x.ts"], "rules": { "${rule}": "off" } }] }`,
        });
        const base = withRules('r');
        const edited = withRules('s');
        expect(lintLedgerCrossingPaths([], ['src/x.ts'], { base, main: edited, head: base })).toEqual(['src/x.ts']);
        expect(lintLedgerCrossingPaths(['src/x.ts'], [], { base, main: base, head: edited })).toEqual(['src/x.ts']);
    });

    const additions: Array<{ name: string; base: LedgerTree; added: LedgerTree }> = [
        {
            name: 'the path added to a new off override',
            base: { [OXC]: '{ "overrides": [{ "files": ["./src/y.ts"], "rules": { "r": "off" } }] }' },
            added: {
                [OXC]: '{ "overrides": [{ "files": ["./src/y.ts"], "rules": { "r": "off" } }, { "files": ["./src/x.ts"], "rules": { "s": "off" } }] }',
            },
        },
        {
            name: 'the path added to an override disabled with severity 0',
            base: { [OXC]: '{ "overrides": [{ "files": ["./src/y.ts"], "rules": { "r": "off" } }] }' },
            added: {
                [OXC]: '{ "overrides": [{ "files": ["./src/y.ts"], "rules": { "r": "off" } }, { "files": ["./src/x.ts"], "rules": { "s": 0 } }] }',
            },
        },
        {
            name: 'a new rule suppressed for a path already suppressed',
            base: { [SUP]: JSON.stringify({ 'src/x.ts': { 'no-void': { count: 2 } } }) },
            added: { [SUP]: JSON.stringify({ 'src/x.ts': { 'no-void': { count: 2 }, 'no-var': { count: 1 } } }) },
        },
        {
            name: 'a new ceiling key for a path',
            base: { [CEIL]: JSON.stringify({ 'src/y.ts': 700 }) },
            added: { [CEIL]: JSON.stringify({ 'src/y.ts': 700, 'src/x.ts': 600 }) },
        },
    ];

    it.each(additions)('crosses $name on main while the pull request edits the file, and the mirror', (edit) => {
        const { base, added } = edit;
        expect(lintLedgerCrossingPaths([], ['src/x.ts'], { base, main: added, head: base })).toEqual(['src/x.ts']);
        expect(lintLedgerCrossingPaths(['src/x.ts'], [], { base, main: base, head: added })).toEqual(['src/x.ts']);
    });

    it.each(additions)('does not cross $name on one side while the other edits an unrelated bound path', (edit) => {
        const { base, added } = edit;
        const withY = (tree: LedgerTree): LedgerTree => ({
            ...tree,
            [CRAFT]: CRAFT_WITH.replace('src/x.ts', 'src/y.ts'),
        });
        expect(
            lintLedgerCrossingPaths(['src/y.ts'], [], { base: withY(base), main: withY(base), head: withY(added) })
        ).toEqual([]);
        expect(
            lintLedgerCrossingPaths([], ['src/y.ts'], { base: withY(base), main: withY(added), head: withY(base) })
        ).toEqual([]);
    });

    it('crosses main deleting a size-baselined file while the pull request adds it to .oxlint-plugins.json', () => {
        const base = { [SIZE]: sizeBaseline('src/p.ts', 'src/q.ts'), [PLG]: pluginSizeWarnings(['src/q.ts']) };
        const main = { [SIZE]: sizeBaseline('src/q.ts'), [PLG]: pluginSizeWarnings(['src/q.ts']) };
        const head = { ...base, [PLG]: pluginSizeWarnings(['src/p.ts', 'src/q.ts']) };
        expect(lintLedgerCrossingPaths(['src/p.ts', SIZE], [PLG], { base, main, head })).toEqual(['src/p.ts']);
    });

    it('crosses main deleting a file .oxlint-plugins.json lists while the pull request rewrites its entry', () => {
        const base = { [SIZE]: sizeBaseline('src/p.ts'), [PLG]: pluginSizeWarnings(['src/p.ts']) };
        const main = { [SIZE]: sizeBaseline(), [PLG]: pluginSizeWarnings([]) };
        const head = { ...base, [PLG]: pluginSizeWarnings(['src/p.ts'], ['warn', { max: 900 }]) };
        expect(lintLedgerCrossingPaths(['src/p.ts', SIZE, PLG], [PLG], { base, main, head })).toEqual(['src/p.ts']);
    });

    it('crosses main deleting a file .oxlint-plugins.json lists while the pull request adds it to the size baseline only', () => {
        const base = { [SIZE]: sizeBaseline('src/q.ts'), [PLG]: pluginSizeWarnings(['src/p.ts', 'src/q.ts']) };
        const main = { [SIZE]: sizeBaseline('src/q.ts'), [PLG]: pluginSizeWarnings(['src/q.ts']) };
        const head = { ...base, [SIZE]: sizeBaseline('src/p.ts', 'src/q.ts') };
        expect(lintLedgerCrossingPaths(['src/p.ts', PLG], [SIZE], { base, main, head })).toEqual(['src/p.ts']);
    });

    it('does not cross a pull request adding a .oxlint-plugins.json entry for a path main never touched', () => {
        const base = { [SIZE]: sizeBaseline('src/p.ts'), [PLG]: pluginSizeWarnings(['src/p.ts']) };
        const head = { ...base, [PLG]: pluginSizeWarnings(['src/p.ts', 'src/q.ts']) };
        expect(lintLedgerCrossingPaths(['src/p.ts'], [PLG], { base, main: base, head })).toEqual([]);
    });

    it('leaves out a bound path neither side edited or rebound while both sides rebind others', () => {
        const ceilings = (x: number, y: number): LedgerTree => ({
            [CEIL]: JSON.stringify({ 'src/x.ts': x, 'src/y.ts': y, 'src/z.ts': 700 }),
        });
        expect(
            lintLedgerCrossingPaths(['src/x.ts'], ['src/x.ts', 'src/y.ts'], {
                base: ceilings(700, 700),
                main: ceilings(600, 700),
                head: ceilings(700, 600),
            })
        ).toEqual(['src/x.ts']);
    });

    const oxlintRules = (...overrides: Array<{ files: string[]; rules: Record<string, unknown> }>): LedgerTree => ({
        [OXC]: JSON.stringify({ overrides }),
    });
    const fOff = { files: ['./src/f.ts'], rules: { 'no-var': 'off' } };

    it('crosses when main adds an enforcing override for a path the pull request edits, and the mirror', () => {
        const base = oxlintRules(fOff);
        const added = oxlintRules(fOff, { files: ['./src/f.ts'], rules: { 'no-var': 'error' } });
        expect(lintLedgerCrossingPaths([], ['src/f.ts'], { base, main: added, head: base })).toEqual(['src/f.ts']);
        expect(lintLedgerCrossingPaths(['src/f.ts'], [], { base, main: base, head: added })).toEqual(['src/f.ts']);
    });

    it('crosses when main adds an off rule to an override listing a path the pull request edits, and the mirror', () => {
        const aOff = { files: ['./src/a.ts'], rules: { 'no-var': 'off' } };
        const base = oxlintRules(aOff);
        const relaxed = oxlintRules({ ...aOff, rules: { ...aOff.rules, 'some-rule': 'off' } });
        expect(lintLedgerCrossingPaths([], ['src/a.ts'], { base, main: relaxed, head: base })).toEqual(['src/a.ts']);
        expect(lintLedgerCrossingPaths(['src/a.ts'], [], { base, main: base, head: relaxed })).toEqual(['src/a.ts']);
    });

    it('crosses when main adds a warn rule to an override listing a path the pull request edits, and the mirror', () => {
        const base = oxlintRules(fOff);
        const warned = oxlintRules({ ...fOff, rules: { ...fOff.rules, 'some-rule': 'warn' } });
        expect(lintLedgerCrossingPaths([], ['src/f.ts'], { base, main: warned, head: base })).toEqual(['src/f.ts']);
        expect(lintLedgerCrossingPaths(['src/f.ts'], [], { base, main: base, head: warned })).toEqual(['src/f.ts']);
    });

    it('crosses when an existing rule changes from off to error, and the mirror', () => {
        const base = oxlintRules(fOff);
        const tightened = oxlintRules({ ...fOff, rules: { 'no-var': 'error' } });
        expect(lintLedgerCrossingPaths([], ['src/f.ts'], { base, main: tightened, head: base })).toEqual(['src/f.ts']);
        expect(lintLedgerCrossingPaths(['src/f.ts'], [], { base, main: base, head: tightened })).toEqual(['src/f.ts']);
    });

    it.each([0, ['off'], ['off', { option: true }], 'allow', 2, ['error', { option: true }]])(
        'crosses an added oxlint rule at severity %j, and the mirror',
        (severity) => {
            const base = oxlintRules(fOff);
            const added = oxlintRules({ ...fOff, rules: { ...fOff.rules, 'some-rule': severity } });
            expect(lintLedgerCrossingPaths([], ['src/f.ts'], { base, main: added, head: base })).toEqual(['src/f.ts']);
            expect(lintLedgerCrossingPaths(['src/f.ts'], [], { base, main: base, head: added })).toEqual(['src/f.ts']);
        }
    );

    it.each([SUP, OXC, CEIL])('fails closed when %s does not parse', (name) => {
        const good = { [name]: '{}' };
        const bad = { [name]: '{ not json' };
        expect(() => lintLedgerCrossingPaths([], [], { base: good, main: bad, head: good })).toThrow(
            `lint ledger ${name} in main is not valid JSON`
        );
    });

    it('skips oxlint overrides without rules and non-string file entries while binding the rest', () => {
        const ledger = {
            [OXC]: '{ "overrides": [{ "files": ["./src/y.ts"] }, "note", { "files": [5, "./src/x.ts"], "rules": { "r": "off" } }] }',
        };
        expect(lintLedgerCrossingPaths(['src/x.ts'], ['src/x.ts'], unchanged(ledger))).toEqual(['src/x.ts']);
    });

    it.each([SUP, CEIL])('fails closed when %s holds an array instead of a path map', (name) => {
        const good = { [name]: '{}' };
        const array = { [name]: '["src/x.ts"]' };
        expect(() => lintLedgerCrossingPaths([], [], { base: good, main: array, head: good })).toThrow(
            `lint ledger ${name} in main is not valid JSON`
        );
    });

    it('sorts and deduplicates the crossing paths', () => {
        const ledger = JSON.stringify({ 'src/z.ts': {}, 'src/a.ts': {} });
        expect(
            lintLedgerCrossingPaths(
                ['src/z.ts', 'src/a.ts', 'src/z.ts'],
                ['src/a.ts', 'src/z.ts'],
                unchanged({ [SUP]: ledger })
            )
        ).toEqual(['src/a.ts', 'src/z.ts']);
    });

    it('names the merge base, a bounded path list, and the remedy', () => {
        const paths = Array.from({ length: 12 }, (_, index) => `src/f${String(index).padStart(2, '0')}.ts`);
        const message = lintLedgerCrossingRefusal(7, { mergeBase: 'abc123', paths });
        expect(message).toContain('PR #7');
        expect(message).toContain('lint-ledger-bound files since merge base abc123');
        expect(message).toContain('src/f09.ts and 2 more');
        expect(message).not.toContain('src/f10.ts');
        expect(message).toContain('merge current main into the lane and publish');
        expect(lintLedgerCrossingRefusal(7, { mergeBase: 'abc123', paths: [] })).toBeUndefined();
    });

    it('names a single crossing path in the singular without a remainder', () => {
        expect(lintLedgerCrossingRefusal(7, { mergeBase: 'abc123', paths: ['src/a.ts'] })).toBe(
            'PR #7 and main both changed lint-ledger-bound file since merge base abc123: src/a.ts; ' +
                'merge current main into the lane and publish so a fresh Gate measures the combination'
        );
    });
});

describe('dependency-boundary baseline crossing', () => {
    const repositoryFile = (name: string): string => join(import.meta.dirname, '..', '..', name);

    function boundaryRow(from: string, to: string): Record<string, unknown> {
        return {
            type: 'contract-reexport',
            from,
            to,
            rule: { severity: 'error', name: 'no-models-repos-transformers-in-contract-folders' },
        };
    }

    // Spelled out, not read from the module, so removing one from the module fails its cases.
    const BASELINES = [
        '.dependency-cruiser-known-violations.json',
        '.dependency-cruiser-known-violations-contract-reexports.json',
        '.dependency-cruiser-known-violations-worker-spawns.json',
        '.dependency-cruiser-known-violations-reachability.json',
        '.dependency-cruiser-known-violations-types.json',
        '.dependency-cruiser-known-violations-tests.json',
    ];
    const FROM = 'src/modules/Example/useCases/run/algorithm.ts';
    const WITH_ROW = JSON.stringify([boundaryRow(FROM, 'src/modules/Example/models/Style.ts')]);
    const WITHOUT_ROW = '[]';

    it('binds the baselines the dependency-boundary gates table names', () => {
        const source = readFileSync(repositoryFile('scripts/check-dependency-boundaries.mjs'), 'utf8');
        const gateBaselines = Array.from(source.matchAll(/^\s+baseline: '([^']+)',$/gmu), (match) => match[1]);
        expect(gateBaselines).toHaveLength(6);
        expect([...DEPENDENCY_BOUNDARY_BASELINE_FILES].sort()).toEqual(gateBaselines.sort());
    });

    it('reads the rows of the real contract-reexports baseline as `from` files', () => {
        const rows: unknown = JSON.parse(
            readFileSync(repositoryFile('.dependency-cruiser-known-violations-contract-reexports.json'), 'utf8')
        );
        expect(Array.isArray(rows)).toBe(true);
        const [first] = rows as Array<{ from?: unknown }>;
        expect(typeof first?.from).toBe('string');
    });

    it.each(BASELINES)(
        '%s: main deleting a row crosses a pull request editing the row file, and the mirror',
        (name) => {
            const base = { [name]: WITH_ROW };
            const deleted = { [name]: WITHOUT_ROW };
            expect(lintLedgerCrossingPaths([name], [FROM], { base, main: deleted, head: base })).toEqual([FROM]);
            expect(lintLedgerCrossingPaths([FROM], [name], { base, main: base, head: deleted })).toEqual([FROM]);
        }
    );

    // The reachability baseline is transitive and binds its whole cruised scope; see the next describe.
    it.each(BASELINES.filter((name) => !TRANSITIVE_BOUNDARY_BASELINE_FILES.includes(name)))(
        '%s: main changing a row does not cross a pull request editing a file no row names',
        (name) => {
            const base = { [name]: WITH_ROW };
            const deleted = { [name]: WITHOUT_ROW };
            expect(
                lintLedgerCrossingPaths([name], ['src/modules/Example/free.ts'], { base, main: deleted, head: base })
            ).toEqual([]);
        }
    );

    it('does not bind the `to` file of a row', () => {
        const base = { [DEPENDENCY_BOUNDARY_BASELINE_FILES[0]]: WITH_ROW };
        const target = 'src/modules/Example/models/Style.ts';
        expect(lintLedgerCrossingPaths([target], [target], { base, main: base, head: base })).toEqual([]);
    });

    it('refuses a baseline that is not an array of rows with a `from` path', () => {
        const name = DEPENDENCY_BOUNDARY_BASELINE_FILES[0];
        const good = { [name]: WITH_ROW };
        for (const bad of ['{}', '[{"to":"a.ts"}]']) {
            expect(() => lintLedgerCrossingPaths([], [], { base: good, main: { [name]: bad }, head: good })).toThrow(
                name
            );
        }
    });
});

describe('transitive reachability baseline crossing', () => {
    const REACH = '.dependency-cruiser-known-violations-reachability.json';
    const CONTRACT = '.dependency-cruiser-known-violations-contract-reexports.json';
    const PANEL = 'src/components/Panel.tsx';
    const row = (from: string): Record<string, unknown> => ({
        type: 'reachability-causal',
        from,
        to: 'src/modules/Example/useCases/run.ts',
        rule: { severity: 'error', name: 'components-no-usecase-transitively' },
    });
    const WITH_ROW = JSON.stringify([row(PANEL)]);
    const repositoryFile = (name: string): string => join(import.meta.dirname, '..', '..', name);

    it('crosses a pull request file the deleted row never named, when main deletes the row', () => {
        const trees = { base: { [REACH]: WITH_ROW }, main: { [REACH]: '[]' }, head: { [REACH]: WITH_ROW } };
        expect(lintLedgerCrossingPaths([REACH, 'src/modules/Example/hooks/M.ts'], ['src/hooks/Q.ts'], trees)).toEqual([
            'src/hooks/Q.ts',
        ]);
    });

    it('crosses a file the pull request changes even when main changed no file in the scope', () => {
        const trees = { base: { [REACH]: '[]' }, main: { [REACH]: WITH_ROW }, head: { [REACH]: '[]' } };
        expect(lintLedgerCrossingPaths([REACH], ['src/hooks/Q.ts'], trees)).toEqual(['src/hooks/Q.ts']);
    });

    it.each(['tsconfig.json', '.dependency-cruiser.reachability.cjs'])(
        'crosses a pull request edit to the resolver input %s when main changed the baseline',
        (input) => {
            const trees = { base: { [REACH]: WITH_ROW }, main: { [REACH]: '[]' }, head: { [REACH]: WITH_ROW } };
            expect(lintLedgerCrossingPaths([REACH], [input], trees)).toEqual([input]);
        }
    );

    it('does not count a reformat or key reorder of the same rows as a baseline change', () => {
        const reordered = `[\n  {"rule": {"name": "components-no-usecase-transitively", "severity": "error"},\n "to": "src/modules/Example/useCases/run.ts", "from": "${PANEL}", "type": "reachability-causal"}\n]\n`;
        const trees = { base: { [REACH]: WITH_ROW }, main: { [REACH]: reordered }, head: { [REACH]: WITH_ROW } };
        expect(lintLedgerCrossingPaths([REACH], ['src/hooks/Q.ts'], trees)).toEqual([]);
    });

    it('counts main deleting the baseline file, or creating it, as a change', () => {
        const deleted = { base: { [REACH]: WITH_ROW }, main: {}, head: { [REACH]: WITH_ROW } };
        expect(lintLedgerCrossingPaths([REACH], ['src/hooks/Q.ts'], deleted)).toEqual(['src/hooks/Q.ts']);
        const created = { base: {}, main: { [REACH]: WITH_ROW }, head: {} };
        expect(lintLedgerCrossingPaths([REACH], ['src/hooks/Q.ts'], created)).toEqual(['src/hooks/Q.ts']);
    });

    it('does not cross pull request files outside the cruised scope', () => {
        const trees = { base: { [REACH]: WITH_ROW }, main: { [REACH]: '[]' }, head: { [REACH]: WITH_ROW } };
        const outside = [
            'docs/x.md',
            'scripts/y.ts',
            'srcx/z.ts',
            'src/modules/Example/hooks/Q.spec.ts',
            'src/Q.test.tsx',
        ];
        expect(lintLedgerCrossingPaths([REACH], outside, trees)).toEqual([]);
    });

    it('does not cross in-scope pull request files when main left the reachability baseline unchanged', () => {
        const trees = unchanged({ [REACH]: WITH_ROW });
        expect(lintLedgerCrossingPaths(['src/modules/Example/hooks/M.ts'], ['src/hooks/Q.ts'], trees)).toEqual([]);
    });

    it('keeps from-only binding for a non-transitive baseline changed on main', () => {
        const row0 = JSON.stringify([
            { type: 'contract-reexport', from: 'src/a.ts', to: 'src/b.ts', rule: { severity: 'error', name: 'r' } },
        ]);
        const trees = { base: { [CONTRACT]: row0 }, main: { [CONTRACT]: '[]' }, head: { [CONTRACT]: row0 } };
        expect(lintLedgerCrossingPaths([CONTRACT], ['src/hooks/Q.ts'], trees)).toEqual([]);
    });

    it('names why in the refusal only when main changed the reachability baseline', () => {
        const plain = { mergeBase: 'abc', paths: ['src/a.ts'] };
        expect(lintLedgerCrossingRefusal(7, plain)).not.toContain('reachability');
        expect(lintLedgerCrossingRefusal(7, { ...plain, transitiveBaselineChangedOnMain: true })).toContain(
            'main changed the reachability baseline'
        );
    });

    it('spells the cruised scope the reachability gate uses', () => {
        const gate = readFileSync(repositoryFile('scripts/check-dependency-boundaries.mjs'), 'utf8');
        expect(gate).toContain(`const args = ['${REACHABILITY_CRUISE_ROOT.replace('/', '')}'];`);
        const config: { options: { exclude: { path: string }; tsConfig: { fileName: string } } } = createRequire(
            import.meta.url
        )(repositoryFile('.dependency-cruiser.reachability.cjs'));
        expect(REACHABILITY_CRUISE_EXCLUDE.source).toBe(config.options.exclude.path);
        expect(REACHABILITY_RESOLVER_INPUTS).toContain(config.options.tsConfig.fileName);
        const tsconfig = readFileSync(repositoryFile(config.options.tsConfig.fileName), 'utf8');
        expect(tsconfig).not.toMatch(/"extends"/u);
    });
});

describe('lint ledger crossing over a real repository', () => {
    let directory: string | undefined;

    afterEach(() => {
        if (directory !== undefined) {
            rmSync(directory, { recursive: true, force: true });
            directory = undefined;
        }
    });

    function scratchRepository(): { git: GitCapture; write: (path: string, content: string) => void } {
        const root = mkdtempSync(join(tmpdir(), 'lint-ledger-crossing-'));
        directory = root;
        const env = {
            ...process.env,
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_SYSTEM: '/dev/null',
            GIT_AUTHOR_NAME: 'Fixture',
            GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
            GIT_COMMITTER_NAME: 'Fixture',
            GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
        };
        const git: GitCapture = (args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' });
        git(['init', '--quiet', '--initial-branch=main']);
        return { git, write: (path, content) => writeFileSync(join(root, path), content) };
    }

    function suppressions(count: number): string {
        return `${JSON.stringify({ 'a.ts': { 'no-void': { count } } }, null, 2)}\n`;
    }

    it('refuses a double prune until main is merged into the second branch', () => {
        const { git, write } = scratchRepository();
        write('eslint-suppressions.json', suppressions(2));
        write('a.ts', 'void one;\nkeep;\nkeep;\nvoid two;\n');
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'base']);

        git(['switch', '--quiet', '-c', 'a']);
        write('eslint-suppressions.json', suppressions(1));
        write('a.ts', 'one;\nkeep;\nkeep;\nvoid two;\n');
        git(['commit', '--quiet', '-am', 'fix one']);

        git(['switch', '--quiet', '-c', 'b', 'main']);
        write('eslint-suppressions.json', suppressions(1));
        write('a.ts', 'void one;\nkeep;\nkeep;\ntwo;\n');
        git(['commit', '--quiet', '-am', 'fix two']);

        git(['switch', '--quiet', 'main']);
        git(['merge', '--quiet', '--squash', 'a']);
        git(['commit', '--quiet', '-m', 'squash a']);

        const crossing = readLintLedgerCrossing(git, 'main', 'b');
        expect(crossing.paths).toEqual(['a.ts']);
        expect(crossing.mergeBase).toBe(git(['rev-parse', 'main~1']).trim());

        git(['switch', '--quiet', 'b']);
        // The identical prunes merge cleanly into a recorded 1 against 0 violations: the combination
        // a fresh Gate on the merged head now measures.
        git(['merge', '--quiet', '--no-edit', 'main']);

        expect(readLintLedgerCrossing(git, 'main', 'b')).toEqual({
            mergeBase: git(['rev-parse', 'main']).trim(),
            paths: [],
        });
    });

    it.each([
        { ledger: '.oxlintrc.json', content: OXLINT.replace('./src/c.ts', './x.ts') },
        { ledger: '.oxlint-plugins.json', content: pluginSizeWarnings(['x.ts']) },
        {
            ledger: 'oxlint.craft-baseline.mjs',
            content: "export const craftBaselineFiles = {\n    'r': [\n        'x.ts',\n    ],\n};\n",
        },
        { ledger: 'eslint.size-baseline.mjs', content: "export const sizeBaselineFiles = [\n    'x.ts',\n];\n" },
        { ledger: 'scripts/lintSizeCeilings.json', content: JSON.stringify({ 'x.ts': 700 }) },
    ])('reads $ledger from the repository and reports a file only it binds', ({ ledger, content }) => {
        const { git, write } = scratchRepository();
        mkdirSync(join(directory ?? '', 'scripts'), { recursive: true });
        write(ledger, content);
        write('x.ts', 'one;\n');
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'base']);
        git(['switch', '--quiet', '-c', 'b']);
        write('x.ts', 'two;\n');
        git(['commit', '--quiet', '-am', 'b']);
        git(['switch', '--quiet', 'main']);
        write('x.ts', 'three;\n');
        git(['commit', '--quiet', '-am', 'main']);

        expect(readLintLedgerCrossing(git, 'main', 'b').paths).toEqual(['x.ts']);
    });

    it.each(DEPENDENCY_BOUNDARY_BASELINE_FILES)(
        'reads %s from the repository and refuses main deleting a row for a file the pull request edits',
        (baseline) => {
            const { git, write } = scratchRepository();
            const row = { type: 'contract-reexport', from: 'x.ts', to: 'y.ts', rule: { severity: 'error', name: 'r' } };
            write(baseline, JSON.stringify([row]));
            write('x.ts', 'one;\n');
            git(['add', '.']);
            git(['commit', '--quiet', '-m', 'base']);
            git(['switch', '--quiet', '-c', 'b']);
            write('x.ts', 'two;\n');
            git(['commit', '--quiet', '-am', 'b edits the row file']);
            git(['switch', '--quiet', 'main']);
            write(baseline, '[]');
            git(['commit', '--quiet', '-am', 'main deletes the row']);

            expect(readLintLedgerCrossing(git, 'main', 'b').paths).toEqual(['x.ts']);
        }
    );

    it('crosses when main renames a bound file the pull request edits', () => {
        const { git, write } = scratchRepository();
        mkdirSync(join(directory ?? '', 'scripts'), { recursive: true });
        write('scripts/lintSizeCeilings.json', JSON.stringify({ 'x.ts': 700 }));
        write('x.ts', 'one;\ntwo;\nthree;\nfour;\nfive;\n');
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'base']);
        git(['switch', '--quiet', '-c', 'b']);
        write('x.ts', 'one;\ntwo;\nthree;\nfour;\nfive;\nsix;\n');
        git(['commit', '--quiet', '-am', 'b']);
        git(['switch', '--quiet', 'main']);
        git(['mv', 'x.ts', 'y.ts']);
        git(['commit', '--quiet', '-m', 'main renames']);

        expect(readLintLedgerCrossing(git, 'main', 'b').paths).toEqual(['x.ts']);
    });

    it('crosses when main deletes a bound file the pull request edits', () => {
        const { git, write } = scratchRepository();
        write('eslint.size-baseline.mjs', sizeBaseline('x.ts'));
        write('x.ts', 'one;\n');
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'base']);
        git(['switch', '--quiet', '-c', 'b']);
        write('x.ts', 'two;\n');
        git(['commit', '--quiet', '-am', 'b']);
        git(['switch', '--quiet', 'main']);
        git(['rm', '--quiet', 'x.ts']);
        git(['commit', '--quiet', '-m', 'main deletes x.ts and leaves the ledger']);

        expect(readLintLedgerCrossing(git, 'main', 'b').paths).toEqual(['x.ts']);
    });

    it('refuses when main deletes a baselined file and the pull request only names it in .oxlint-plugins.json', () => {
        const { git, write } = scratchRepository();
        write('eslint.size-baseline.mjs', sizeBaseline('p.ts', 'q.ts'));
        write('.oxlint-plugins.json', `${pluginSizeWarnings(['q.ts'])}\n`);
        write('p.ts', 'one;\n');
        write('q.ts', 'one;\n');
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'base']);
        git(['switch', '--quiet', '-c', 'b']);
        write('.oxlint-plugins.json', `${pluginSizeWarnings(['p.ts', 'q.ts'])}\n`);
        git(['commit', '--quiet', '-am', 'b mirrors the size baseline into the plugin config']);
        git(['switch', '--quiet', 'main']);
        git(['rm', '--quiet', 'p.ts']);
        write('eslint.size-baseline.mjs', sizeBaseline('q.ts'));
        git(['commit', '--quiet', '-am', 'main deletes p.ts and drops its baseline entry']);

        const crossing = readLintLedgerCrossing(git, 'main', 'b');
        expect(crossing.paths).toEqual(['p.ts']);
        expect(lintLedgerCrossingRefusal(6740, crossing)).toContain('lint-ledger-bound file since merge base');
    });

    it('reads a binding that only the merge base holds', () => {
        const { git, write } = scratchRepository();
        write('eslint-suppressions.json', JSON.stringify({ 'x.ts': { 'no-void': { count: 1 } } }));
        write('x.ts', 'void one;\n');
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'base']);
        git(['switch', '--quiet', '-c', 'b']);
        write('eslint-suppressions.json', '{}');
        write('x.ts', 'one;\n');
        git(['commit', '--quiet', '-am', 'b removes the entry']);
        git(['switch', '--quiet', 'main']);
        write('eslint-suppressions.json', '{}');
        write('x.ts', 'void one;\nkeep;\n');
        git(['commit', '--quiet', '-am', 'main']);

        expect(readLintLedgerCrossing(git, 'main', 'b').paths).toEqual(['x.ts']);
    });

    it('reads a binding that only main adds', () => {
        const { git, write } = scratchRepository();
        write('x.ts', 'one;\n');
        write('other.ts', 'a;\n');
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'base']);
        git(['switch', '--quiet', '-c', 'b']);
        write('x.ts', 'two;\n');
        git(['commit', '--quiet', '-am', 'b']);
        git(['switch', '--quiet', 'main']);
        write('eslint-suppressions.json', JSON.stringify({ 'x.ts': { 'no-void': { count: 1 } } }));
        write('x.ts', 'void three;\n');
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'main binds x']);

        expect(readLintLedgerCrossing(git, 'main', 'b').paths).toEqual(['x.ts']);
    });

    it('refuses when main removes an already-compliant file from an oxlint override the pull request measured it under', () => {
        const { git, write } = scratchRepository();
        write('.oxlintrc.json', '{ "overrides": [{ "files": ["./x.ts"], "rules": { "r": "off" } }] }\n');
        write('x.ts', 'one;\n');
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'base']);
        git(['switch', '--quiet', '-c', 'b']);
        write('x.ts', 'void violation;\n');
        git(['commit', '--quiet', '-am', 'b adds a violation while x.ts is listed']);
        git(['switch', '--quiet', 'main']);
        write('.oxlintrc.json', '{ "overrides": [{ "files": [], "rules": { "r": "off" } }] }\n');
        git(['commit', '--quiet', '-am', 'main delists x.ts without editing it']);

        expect(readLintLedgerCrossing(git, 'main', 'b').paths).toEqual(['x.ts']);
    });

    it('tolerates a ledger absent from every tree', () => {
        const { git, write } = scratchRepository();
        write('a.ts', 'one;\n');
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'base']);
        git(['switch', '--quiet', '-c', 'b']);
        write('a.ts', 'two;\n');
        git(['commit', '--quiet', '-am', 'b']);
        git(['switch', '--quiet', 'main']);
        write('a.ts', 'three;\n');
        git(['commit', '--quiet', '-am', 'main']);

        expect(readLintLedgerCrossing(git, 'main', 'b').paths).toEqual([]);
    });

    it('refuses to judge a head commit that is not available locally', () => {
        const { git, write } = scratchRepository();
        write('a.ts', 'one;\n');
        git(['add', '.']);
        git(['commit', '--quiet', '-m', 'base']);

        expect(() => readLintLedgerCrossing(git, 'main', '0'.repeat(40))).toThrow(/is not available locally/u);
    });
});
