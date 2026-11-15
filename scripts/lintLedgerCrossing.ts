import { fail } from './prContract.ts';

/**
 * Lint ledgers bind exact per-file figures to the tree they were measured on. The `main` ruleset is
 * non-strict, so a pull request's `Gate` measured it merged into an older `main`; when `main` has
 * since changed a file the pull request also changed, and a ledger binds that file, the squash can
 * combine two green measurements into a red `main`. Every entry is read as text and never evaluated.
 */
export const LINT_LEDGER_FILES = [
    // ESLint suppression counts per file and rule: two prunes of one count leave an unused suppression.
    'eslint-suppressions.json',
    // oxlint burn-down baselines in override `files` lists: a removal on one side and a new violation
    // measured while the file was still baselined on the other.
    '.oxlintrc.json',
    // Craft-plugin burn-down exemptions per rule, the same hazard as the oxlint baselines.
    'oxlint.craft-baseline.mjs',
    // Files downgraded to warn for the size ceilings.
    'eslint.size-baseline.mjs',
    // Per-file line ceilings: two growths each within the ceiling can exceed it together.
    'scripts/lintSizeCeilings.json',
] as const;

const REFUSAL_PATH_LIMIT = 10;

/** One git invocation's stdout, given the arguments after `git`. */
export type GitCapture = (args: string[]) => string;

export type LintLedgerCrossing = {
    mergeBase: string;
    /** Sorted paths changed on both sides since the merge base that some ledger binds. */
    paths: string[];
};

function normalizedLedgerPath(value: string): string {
    return value.startsWith('./') ? value.slice(2) : value;
}

/** Every single- or double-quoted string on one line: the shape ledger paths take in JSON and ESM. */
function quotedStrings(text: string): string[] {
    return [...text.matchAll(/"([^"\n]*)"|'([^'\n]*)'/gu)].map((match) => match[1] ?? match[2] ?? '');
}

/** Ledger file name to its text in one tree; a ledger the tree lacks has no entry. */
export type LedgerTree = Readonly<Record<string, string>>;

export type LedgerTrees = { base: LedgerTree; main: LedgerTree; head: LedgerTree };

function ledgerBoundPaths(trees: readonly LedgerTree[]): Set<string> {
    return new Set(
        trees.flatMap((tree) => Object.values(tree).flatMap((text) => quotedStrings(text).map(normalizedLedgerPath)))
    );
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        const members = Object.entries(value)
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`);
        return `{${members.join(',')}}`;
    }
    return JSON.stringify(value) ?? 'undefined';
}

/** Removes `//` and block comments outside strings so the JSONC `.oxlintrc.json` parses as JSON. */
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
        fail(`lint ledger ${name} in ${side} is not valid JSON`);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Per path, the set of binding entries a ledger records for it; entries are never joined. */
type BindingIndex = Map<string, Set<string>>;

function addBinding(index: BindingIndex, path: string, binding: string): void {
    const key = normalizedLedgerPath(path);
    index.set(key, new Set([...(index.get(key) ?? []), binding]));
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

function indexOxlintOverrides(index: BindingIndex, name: string, side: string, text: string): void {
    const parsed = parseLedgerJson(name, side, text);
    const overrides = isRecord(parsed) && Array.isArray(parsed['overrides']) ? parsed['overrides'] : [];
    for (const override of overrides) {
        if (!isRecord(override) || !Array.isArray(override['files'])) {
            continue;
        }
        for (const file of override['files']) {
            if (typeof file === 'string') {
                addBinding(index, file, `${name}=${canonicalJson(override['rules'])}`);
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

function bindingIndex(tree: LedgerTree, side: string): BindingIndex {
    const index: BindingIndex = new Map();
    for (const [name, text] of Object.entries(tree)) {
        if (name === '.oxlintrc.json') {
            indexOxlintOverrides(index, name, side, text);
        } else if (name.endsWith('.json')) {
            indexKeyedJson(index, name, side, text);
        } else {
            indexModuleList(index, name, text);
        }
    }
    return index;
}

/**
 * Paths for which one side lost a binding entry the merge base held, with no file edit needed. An
 * entry the side only adds can relax or newly bind a path but never turns a green pair red.
 */
function rebound(base: BindingIndex, side: BindingIndex): string[] {
    return [...base]
        .filter(([path, entries]) => [...entries].some((entry) => side.get(path)?.has(entry) !== true))
        .map(([path]) => path);
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
    const bound = ledgerBoundPaths([trees.base, trees.main, trees.head]);
    const base = bindingIndex(trees.base, 'the merge base');
    const mainSide = new Set([...mainChanged, ...rebound(base, bindingIndex(trees.main, 'main'))]);
    const pullRequestSide = new Set([
        ...pullRequestChanged,
        ...rebound(base, bindingIndex(trees.head, 'the pull request head')),
    ]);
    return [...mainSide].filter((path) => pullRequestSide.has(path) && bound.has(path)).sort();
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
        fail(`commit ${revision} is not available locally`);
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
    return {
        mergeBase,
        paths: lintLedgerCrossingPaths(changedPaths(git, mergeBase, main), changedPaths(git, mergeBase, head), trees),
    };
}

export function lintLedgerCrossingRefusal(number: number, crossing: LintLedgerCrossing): string | undefined {
    if (crossing.paths.length === 0) {
        return undefined;
    }
    const shown = crossing.paths.slice(0, REFUSAL_PATH_LIMIT);
    const more = crossing.paths.length - shown.length;
    return (
        `PR #${number} and main both changed lint-ledger-bound ${crossing.paths.length === 1 ? 'file' : 'files'} ` +
        `since merge base ${crossing.mergeBase}: ${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}; ` +
        'merge current main into the lane and publish so a fresh Gate measures the combination'
    );
}
