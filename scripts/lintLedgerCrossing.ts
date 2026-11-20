import { fail } from './prContract.ts';

/**
 * Lint ledgers bind exact per-file figures to the tree they were measured on. The `main` ruleset is
 * non-strict, so a pull request's `Gate` measured it merged into an older `main`; when `main` has
 * since changed a file the pull request also changed, and a ledger binds that file, the squash can
 * combine two green measurements into a red `main`. Every entry is read as text and never evaluated.
 */
export const DEPENDENCY_BOUNDARY_BASELINE_FILES = [
    // Dependency-boundary baselines: rows whose `from` names a file, compared exactly by
    // `scripts/check-dependency-boundaries.mjs`. A row deleted on one side while the other edits its file
    // leaves a violation no row covers.
    '.dependency-cruiser-known-violations.json',
    '.dependency-cruiser-known-violations-contract-reexports.json',
    '.dependency-cruiser-known-violations-worker-spawns.json',
    '.dependency-cruiser-known-violations-reachability.json',
    '.dependency-cruiser-known-violations-types.json',
    '.dependency-cruiser-known-violations-tests.json',
] as const;

/**
 * Baselines of gates that collapse a transitive violation path to its endpoints: a row names no file
 * the path runs through, so a changed baseline on `main` can invalidate a pull-request edit to any file
 * the gate cruises. Today only the reachability gate does.
 */
export const TRANSITIVE_BOUNDARY_BASELINE_FILES: readonly string[] = [
    '.dependency-cruiser-known-violations-reachability.json',
];

/**
 * What the reachability gate cruises, read by `runCruise` in `scripts/check-dependency-boundaries.mjs`
 * (root `src`) and `.dependency-cruiser.reachability.cjs` (`options.exclude`). This module never executes
 * tree files, so the pair is spelled here and a spec pins it to both sources.
 */
export const REACHABILITY_CRUISE_ROOT = 'src/';
export const REACHABILITY_CRUISE_EXCLUDE = /\.(spec|test)\.(ts|tsx)$/u;

/**
 * Files that change what the reachability gate resolves without being cruised: `tsConfig.fileName`
 * (`tsconfig.json`, no `extends`; its `paths` aliases are cruised edges), the gate's own config and
 * script, and `package.json` `imports`/`exports`. A spec pins `tsconfig.json` to the config.
 */
export const REACHABILITY_RESOLVER_INPUTS: readonly string[] = [
    'tsconfig.json',
    '.dependency-cruiser.reachability.cjs',
    'scripts/check-dependency-boundaries.mjs',
    'package.json',
];

export const LINT_LEDGER_FILES = [
    // ESLint suppression counts per file and rule: two prunes of one count leave an unused suppression.
    'eslint-suppressions.json',
    // oxlint burn-down baselines in override `files` lists: a removal on one side and a new violation
    // measured while the file was still baselined on the other.
    '.oxlintrc.json',
    // The native oxlint plugin config: its size-warning override must list exactly the size baseline.
    '.oxlint-plugins.json',
    // Historical ancestry still binds whole-file craft exemptions during the migration.
    'oxlint.craft-baseline.mjs',
    'oxlint-quality-baseline.json',
    // Files downgraded to warn for the size ceilings.
    'eslint.size-baseline.mjs',
    // Per-file line ceilings: two growths each within the ceiling can exceed it together.
    'scripts/lintSizeCeilings.json',
    ...DEPENDENCY_BOUNDARY_BASELINE_FILES,
] as const;

const REFUSAL_PATH_LIMIT = 10;

/** One git invocation's stdout, given the arguments after `git`. */
export type GitCapture = (args: string[]) => string;

export type LintLedgerCrossing = {
    mergeBase: string;
    /** Sorted paths changed on both sides since the merge base that some ledger binds. */
    paths: string[];
    /** Set when `main` changed a transitive gate's baseline, so src paths are listed for binding the gate's whole scope. */
    transitiveBaselineChangedOnMain?: true;
};

function normalizedLedgerPath(value: string): string {
    return value.startsWith('./') ? value.slice(2) : value;
}

/** Every single- or double-quoted string on one line: the shape ledger paths take in JSON and ESM. */
function quotedStrings(text: string): string[] {
    return Array.from(text.matchAll(/"([^"\n]*)"|'([^'\n]*)'/gu), (match) => match[1] ?? match[2] ?? '');
}

/** Ledger file name to its text in one tree; a ledger the tree lacks has no entry. */
export type LedgerTree = Readonly<Record<string, string>>;

export type LedgerTrees = { base: LedgerTree; main: LedgerTree; head: LedgerTree };

const BOUNDARY_BASELINES: ReadonlySet<string> = new Set(DEPENDENCY_BOUNDARY_BASELINE_FILES);

function pathsBoundBy(name: string, side: string, text: string): string[] {
    if (BOUNDARY_BASELINES.has(name)) {
        return boundaryBaselineRows(name, side, text).map((row) => row.from);
    }
    return quotedStrings(text);
}

/** Paths a boundary baseline binds are its rows' `from` files; its `to`, `via` and rule strings bind nothing. */
function ledgerBoundPaths(trees: ReadonlyArray<{ tree: LedgerTree; side: string }>): Set<string> {
    const bound = new Set<string>();
    for (const { tree, side } of trees) {
        for (const [name, text] of Object.entries(tree)) {
            const paths = pathsBoundBy(name, side, text);
            for (const path of paths) {
                bound.add(normalizedLedgerPath(path));
            }
        }
    }
    return bound;
}

/** Code-unit order, independent of locale, so both sides of a comparison sort keys identically. */
function compareKeys(left: string, right: string): number {
    if (left < right) {
        return -1;
    }
    return left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        const members = Object.entries(value)
            .sort(([left], [right]) => compareKeys(left, right))
            .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`);
        return `{${members.join(',')}}`;
    }
    return JSON.stringify(value);
}

/** Removes `//` and block comments outside strings so a JSONC oxlint config parses as JSON. */
function withoutJsonComments(text: string): string {
    let result = '';
    let index = 0;
    while (index < text.length) {
        const char = text[index] ?? '';
        const next = text[index + 1];
        if (char === '"') {
            let end = index + 1;
            while (end < text.length && text[end] !== '"') {
                end += text[end] === '\\' ? 2 : 1;
            }
            result += text.slice(index, end + 1);
            index = end + 1;
        } else if (char === '/' && next === '/') {
            const end = text.indexOf('\n', index);
            index = end === -1 ? text.length : end;
        } else if (char === '/' && next === '*') {
            const end = text.indexOf('*/', index + 2);
            index = end === -1 ? text.length : end + 2;
        } else {
            result += char;
            index += 1;
        }
    }
    return result;
}

function parseLedgerJson(name: string, side: string, text: string): unknown {
    try {
        return JSON.parse(withoutJsonComments(text));
    } catch {
        return fail(`lint ledger ${name} in ${side} is not valid JSON`);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Per path, the set of binding entries a ledger records for it; entries are never joined. */
type BindingIndex = Map<string, Set<string>>;

function addBinding(index: BindingIndex, path: string, binding: string): void {
    const key = normalizedLedgerPath(path);
    const bindings = index.get(key);
    if (bindings === undefined) {
        index.set(key, new Set([binding]));
        return;
    }
    bindings.add(binding);
}

function indexKeyedJson(index: BindingIndex, name: string, side: string, text: string): void {
    const parsed = parseLedgerJson(name, side, text);
    if (!isRecord(parsed)) {
        fail(`lint ledger ${name} in ${side} is not valid JSON`);
    }
    for (const [path, value] of Object.entries(parsed)) {
        if (isRecord(value)) {
            // One entry per rule, so a rule newly suppressed for a path is an addition, not a change.
            for (const [rule, figure] of Object.entries(value)) {
                addBinding(index, path, `${name}:${JSON.stringify(rule)}=${canonicalJson(figure)}`);
            }
        } else {
            addBinding(index, path, `${name}=${canonicalJson(value)}`);
        }
    }
}

/** One entry per (file, rule, value) so a rule added to an override leaves the other entries for its files intact. */
function indexOxlintOverrides(index: BindingIndex, name: string, side: string, text: string): void {
    const parsed = parseLedgerJson(name, side, text);
    const overrides = isRecord(parsed) && Array.isArray(parsed.overrides) ? parsed.overrides : [];
    for (const override of overrides) {
        if (!isRecord(override) || !Array.isArray(override.files) || !isRecord(override.rules)) {
            continue;
        }
        for (const file of override.files) {
            if (typeof file !== 'string') {
                continue;
            }
            for (const [rule, value] of Object.entries(override.rules)) {
                addBinding(index, file, `${name}:${JSON.stringify(rule)}=${canonicalJson(value)}`);
            }
        }
    }
}

/** Membership in a `.mjs` list, keyed by the rule group (`'rule': [`) it sits under when it has one. */
function indexModuleList(index: BindingIndex, name: string, text: string): void {
    let group = '';
    for (const line of text.split('\n')) {
        const strings = quotedStrings(line);
        const groupKey = /^\s*['"][^'"]+['"]\s*:\s*\[/u.test(line) ? strings.shift() : undefined;
        group = groupKey ?? group;
        for (const path of strings) {
            addBinding(index, path, `${name}@${group}`);
        }
    }
}

type BoundaryRow = { from: string; row: Record<string, unknown> };

function boundaryBaselineRows(name: string, side: string, text: string): BoundaryRow[] {
    const parsed = parseLedgerJson(name, side, text);
    if (!Array.isArray(parsed)) {
        return fail(`lint ledger ${name} in ${side} is not a JSON array of rows`);
    }
    return parsed.map((row) => {
        if (!isRecord(row) || typeof row.from !== 'string') {
            return fail(`lint ledger ${name} in ${side} has a row without a string \`from\` path`);
        }
        return { from: row.from, row };
    });
}

/** One entry per row, so a row deleted or changed for a file is a change to that file's bindings. */
function indexBoundaryBaseline(index: BindingIndex, name: string, side: string, text: string): void {
    for (const { from, row } of boundaryBaselineRows(name, side, text)) {
        addBinding(index, from, `${name}=${canonicalJson(row)}`);
    }
}

const OXLINT_CONFIGS: ReadonlySet<string> = new Set(['.oxlintrc.json', '.oxlint-plugins.json']);

function bindingIndex(tree: LedgerTree, side: string): BindingIndex {
    const entries: BindingIndex = new Map();
    for (const [name, text] of Object.entries(tree)) {
        if (BOUNDARY_BASELINES.has(name)) {
            indexBoundaryBaseline(entries, name, side, text);
        } else if (OXLINT_CONFIGS.has(name)) {
            indexOxlintOverrides(entries, name, side, text);
        } else if (name.endsWith('.json')) {
            indexKeyedJson(entries, name, side, text);
        } else {
            indexModuleList(entries, name, text);
        }
    }
    return entries;
}

function sameEntries(left: ReadonlySet<string> | undefined, right: ReadonlySet<string> | undefined): boolean {
    const leftEntries = left ?? new Set<string>();
    const rightEntries = right ?? new Set<string>();
    return leftEntries.size === rightEntries.size && [...leftEntries].every((entry) => rightEntries.has(entry));
}

/**
 * Paths a side touches in the ledgers with no file edit: its entries for the path differ from the
 * merge base's in either direction. A lost entry or changed figure invalidates the other side's
 * measurement, and so does an added one, because the ledgers are pinned equal to one another: an
 * entry one side adds for a path the other side deleted or re-baselined leaves them disagreeing.
 */
function rebound(base: BindingIndex, side: BindingIndex): string[] {
    return Array.from(new Set([...base.keys(), ...side.keys()])).filter(
        (path) => !sameEntries(base.get(path), side.get(path))
    );
}

function inReachabilityScope(path: string): boolean {
    const normalized = normalizedLedgerPath(path);
    if (REACHABILITY_RESOLVER_INPUTS.includes(normalized)) {
        return true;
    }
    return normalized.startsWith(REACHABILITY_CRUISE_ROOT) && !REACHABILITY_CRUISE_EXCLUDE.test(normalized);
}

/** Sorted canonical rows, so a reformat, key reorder or row reorder is not a change. */
function canonicalRows(name: string, side: string, text: string): string[] {
    return boundaryBaselineRows(name, side, text)
        .map(({ row }) => canonicalJson(row))
        .sort(compareKeys);
}

function baselineRowsDiffer(name: string, trees: LedgerTrees): boolean {
    const base = trees.base[name];
    const main = trees.main[name];
    if (base === undefined || main === undefined) {
        return base !== main;
    }
    const baseRows = canonicalRows(name, 'the merge base', base);
    const mainRows = canonicalRows(name, 'main', main);
    return baseRows.length !== mainRows.length || baseRows.some((row, index) => row !== mainRows[index]);
}

/** True when `main` changed, added or removed a row of, or deleted or created, a transitive gate's baseline. */
export function mainChangedTransitiveBaseline(trees: LedgerTrees): boolean {
    return TRANSITIVE_BOUNDARY_BASELINE_FILES.some((name) => baselineRowsDiffer(name, trees));
}

/**
 * The paths a squash would combine unmeasured: touched since the merge base on both the `main` side
 * and the pull-request side, and named by a ledger in any of the trees involved. A side touches a
 * path by changing the file or by changing what a ledger records for it.
 */
export function lintLedgerCrossingPaths(
    mainChanged: readonly string[],
    pullRequestChanged: readonly string[],
    trees: LedgerTrees
): string[] {
    const bound = ledgerBoundPaths([
        { tree: trees.base, side: 'the merge base' },
        { tree: trees.main, side: 'main' },
        { tree: trees.head, side: 'the pull request head' },
    ]);
    const base = bindingIndex(trees.base, 'the merge base');
    const mainSide = new Set([...mainChanged, ...rebound(base, bindingIndex(trees.main, 'main'))]);
    const pullRequestSide = new Set([
        ...pullRequestChanged,
        ...rebound(base, bindingIndex(trees.head, 'the pull request head')),
    ]);
    const crossing = new Set(Array.from(mainSide).filter((path) => pullRequestSide.has(path) && bound.has(path)));
    if (mainChangedTransitiveBaseline(trees)) {
        for (const path of pullRequestSide) {
            if (inReachabilityScope(path)) {
                crossing.add(path);
            }
        }
    }
    return Array.from(crossing).sort();
}

function nulSeparated(output: string): string[] {
    return output.split('\0').filter((entry) => entry !== '');
}

function changedPaths(git: GitCapture, from: string, to: string): string[] {
    return nulSeparated(git(['diff', '--name-only', '--no-renames', '--no-ext-diff', '-z', from, to, '--']));
}

/** The ledger blobs present in `revision`; a ledger absent from that tree contributes nothing. */
function ledgerTree(git: GitCapture, revision: string): LedgerTree {
    return Object.fromEntries(
        nulSeparated(git(['ls-tree', '-z', revision, '--', ...LINT_LEDGER_FILES])).map((entry) => {
            const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/u.exec(entry);
            const objectId = match?.[1];
            const name = match?.[2];
            if (objectId === undefined || name === undefined) {
                fail(`lint ledger entry in ${revision} is not a blob: ${entry}`);
            }
            return [name, git(['cat-file', 'blob', objectId])];
        })
    );
}

function commitObject(git: GitCapture, revision: string): string {
    try {
        return git(['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]).trim();
    } catch {
        return fail(`commit ${revision} is not available locally`);
    }
}

/** Reads object data only: no file from any of the three trees is imported, evaluated, or checked out. */
export function readLintLedgerCrossing(
    git: GitCapture,
    mainRevision: string,
    headRevision: string
): LintLedgerCrossing {
    const main = commitObject(git, mainRevision);
    const head = commitObject(git, headRevision);
    const mergeBase = git(['merge-base', main, head]).trim();
    const trees = { base: ledgerTree(git, mergeBase), main: ledgerTree(git, main), head: ledgerTree(git, head) };
    const paths = lintLedgerCrossingPaths(
        changedPaths(git, mergeBase, main),
        changedPaths(git, mergeBase, head),
        trees
    );
    if (mainChangedTransitiveBaseline(trees)) {
        return { mergeBase, paths, transitiveBaselineChangedOnMain: true };
    }
    return { mergeBase, paths };
}

export function lintLedgerCrossingRefusal(number: number, crossing: LintLedgerCrossing): string | undefined {
    if (crossing.paths.length === 0) {
        return undefined;
    }
    const shown = crossing.paths.slice(0, REFUSAL_PATH_LIMIT);
    const more = crossing.paths.length - shown.length;
    const reason = crossing.transitiveBaselineChangedOnMain
        ? '; main changed the reachability baseline, which binds every file under src/ that gate cruises'
        : '';
    return (
        `PR #${number} and main both changed lint-ledger-bound ${crossing.paths.length === 1 ? 'file' : 'files'} ` +
        `since merge base ${crossing.mergeBase}: ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}; ` +
        `merge current main into the lane and publish so a fresh Gate measures the combination${reason}`
    );
}
