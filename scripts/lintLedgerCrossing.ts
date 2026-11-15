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

function ledgerBoundPaths(ledgerTexts: readonly string[]): Set<string> {
    return new Set(ledgerTexts.flatMap((text) => quotedStrings(text).map(normalizedLedgerPath)));
}

/**
 * The paths a squash would combine unmeasured: changed since the merge base on both the `main` side
 * and the pull-request side, and named by a ledger in any of the trees involved.
 */
export function lintLedgerCrossingPaths(
    mainChanged: readonly string[],
    pullRequestChanged: readonly string[],
    ledgerTexts: readonly string[]
): string[] {
    const bound = ledgerBoundPaths(ledgerTexts);
    const pullRequestSide = new Set(pullRequestChanged);
    return [...new Set(mainChanged)].filter((path) => pullRequestSide.has(path) && bound.has(path)).sort();
}

function nulSeparated(output: string): string[] {
    return output.split('\0').filter((entry) => entry !== '');
}

function changedPaths(git: GitCapture, from: string, to: string): string[] {
    return nulSeparated(git(['diff', '--name-only', '--no-renames', '--no-ext-diff', '-z', from, to, '--']));
}

/** The ledger blobs present in `revision`; a ledger absent from that tree contributes nothing. */
function ledgerTexts(git: GitCapture, revision: string): string[] {
    return nulSeparated(git(['ls-tree', '-z', revision, '--', ...LINT_LEDGER_FILES])).map((entry) => {
        const objectId = /^\d+ blob ([0-9a-f]+)\t/u.exec(entry)?.[1];
        if (objectId === undefined) {
            fail(`lint ledger entry in ${revision} is not a blob: ${entry}`);
        }
        return git(['cat-file', 'blob', objectId]);
    });
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
    const texts = [mergeBase, main, head].flatMap((revision) => ledgerTexts(git, revision));
    return {
        mergeBase,
        paths: lintLedgerCrossingPaths(changedPaths(git, mergeBase, main), changedPaths(git, mergeBase, head), texts),
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
