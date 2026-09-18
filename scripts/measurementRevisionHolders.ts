import { REQUIRED_BASE_BRANCH, REQUIRED_REPOSITORY } from './githubAppIdentity.ts';

export const MEASUREMENT_REVISION = /^[0-9a-f]{40}$/u;

export type RemoteBranch = { name: string; tip: string };
export type BranchRevisionReader = {
    baseBranchTip: () => RemoteBranch;
    branchHoldsRevision: (branch: RemoteBranch, revision: string) => boolean;
};
export type BranchClass = 'protected' | 'unlisted' | 'open' | 'unpublished' | 'moved' | 'spent';

type Gh = (args: string[]) => string;

/**
 * The tracked tables that record the source revision their measured digests were taken against.
 * `assertGrandBouleMeasurementAdmission` resolves each recorded `sourceRevision` by SHA, so the
 * revision has to stay reachable from some remote branch (#4364, ADR 0038). The revisions
 * themselves are read from these tables at run time, so a re-measurement protects its own revision
 * without editing this guard.
 */
const RECORDED_MEASUREMENT_TABLES = ['crates/daw-dsp/benches/quantum-cost-table.json'] as const;

/**
 * Every full-hexadecimal `sourceRevision` the supplied table contents record, deduplicated.
 * Deriving the revisions from what the tracked tables say at run time is what lets a future
 * re-measurement protect its own revision without editing the guard (#4364).
 */
export function recordedRevisionsInTables(tables: string[]): string[] {
    const recorded = tables
        .map((table) => (JSON.parse(table) as { sourceRevision?: unknown }).sourceRevision)
        .filter((revision): revision is string => typeof revision === 'string' && MEASUREMENT_REVISION.test(revision));
    return [...new Set(recorded)].sort();
}

export function fetchRecordedMeasurementRevisions(gh: Gh): string[] {
    const tables = RECORDED_MEASUREMENT_TABLES.map((path) =>
        gh([
            'api',
            '-H',
            'Accept: application/vnd.github.raw',
            `repos/${REQUIRED_REPOSITORY}/contents/${path}?ref=${REQUIRED_BASE_BRANCH}`,
        ])
    );
    return recordedRevisionsInTables(tables);
}

/**
 * Whether the revision is an ancestor of (or equal to) the branch tip. GitHub answers it, not the
 * local checkout: `origin/*` tracking refs can be stale or absent, and remote reachability is the
 * property the admission depends on. A comparison that cannot be answered throws rather than
 * guessing about an irreversible delete.
 */
export function branchHoldsRevision(branch: RemoteBranch, revision: string, gh: Gh): boolean {
    const status = gh(['api', `repos/${REQUIRED_REPOSITORY}/compare/${revision}...${branch.tip}`, '--jq', '.status']);
    return status === 'ahead' || status === 'identical';
}

/**
 * Whether GitHub answered that it cannot resolve a comparison at all. The text is the only status
 * signal the gh wrapper carries, and the exact shape was reproduced read-only against the live API
 * with
 * `gh api repos/:owner/:repo/compare/0000000000000000000000000000000000000000...<tip> --jq .status`.
 *
 * The identical answer covers a missing revision and an unresolvable branch tip, so this alone
 * never proves a revision gone: it only means the pair could not be compared.
 */
export function isUnresolvableRevisionError(error: unknown): error is Error {
    return error instanceof Error && /\bHTTP 404\b/u.test(error.message);
}

/**
 * Whether the base comparison answered that the revision is not reachable from the base tip, or
 * itself could not resolve the revision. Both outcomes mean the same thing for a recorded
 * revision, because the base branch tip reaches every revision `main` holds. An unanswerable
 * failure is anything else and stays unanswerable.
 */
function revisionMissingFromBase(
    revision: string,
    port: BranchRevisionReader,
    compare: (branch: RemoteBranch, revision: string) => boolean
): boolean {
    try {
        return !compare(port.baseBranchTip(), revision);
    } catch (error) {
        if (isUnresolvableRevisionError(error)) {
            return true;
        }
        throw error;
    }
}

/**
 * Every branch whose tip reaches the revision, scanning all of them so a branch that cannot be
 * compared never hides a later holder. A 404 on one branch means that pair cannot be compared, not
 * that the revision is gone, so it is held back while the scan continues. If no branch anywhere
 * holds the revision, the base comparison decides whether the revision itself is missing and the
 * run reports and skips it, or the comparison was merely unanswerable and the failure propagates.
 * Any non-404 comparison failure propagates immediately, deleting nothing.
 */
function resolveRevisionHolders(
    branches: RemoteBranch[],
    revision: string,
    port: BranchRevisionReader,
    log: (message: string) => void
): RemoteBranch[] {
    const holding: RemoteBranch[] = [];
    let unresolved: Error | undefined;
    for (const branch of branches) {
        try {
            if (port.branchHoldsRevision(branch, revision)) {
                holding.push(branch);
            }
        } catch (error) {
            if (!isUnresolvableRevisionError(error)) {
                throw error;
            }
            unresolved = error;
        }
    }
    if (holding.length > 0 || unresolved === undefined) {
        return holding;
    }
    if (!MEASUREMENT_REVISION.test(revision)) {
        throw unresolved;
    }
    if (!revisionMissingFromBase(revision, port, (branch, candidate) => port.branchHoldsRevision(branch, candidate))) {
        throw unresolved;
    }
    log(`unresolvable measurement revision ${revision}: no remote branch holds it`);
    return [];
}

/**
 * Retains a spent branch when deleting it would make a recorded measurement source revision
 * unreachable. `assertGrandBouleMeasurementAdmission` resolves that revision by SHA, and a squash
 * merge never makes a measured lane head an ancestor of `main`, so its lane branch is often the
 * only remote holder; pruning it breaks the required Gate on `main` for every later pull request
 * with no source change to blame (#4364).
 *
 * A revision some surviving branch still holds pins nothing, and one no branch holds at all is
 * already unresolvable, so both cases prune as before. A retained branch is reclassified as `open`
 * (kept) exactly like the base-dependent guard, leaving the plan's shape intact. A revision proven
 * gone from the remote is reported by name and skipped, because a stale table entry must not abort
 * a plan that has no other reason to stop; a comparison nothing can answer still refuses.
 */
export function retainMeasurementRevisionHolders(
    branches: RemoteBranch[],
    classes: Map<string, BranchClass>,
    port: BranchRevisionReader & { recordedMeasurementRevisions: () => string[] },
    log: (message: string) => void
): void {
    for (const revision of port.recordedMeasurementRevisions()) {
        const holders = resolveRevisionHolders(branches, revision, port, log);
        if (holders.some((branch) => classes.get(branch.name) !== 'spent')) {
            continue;
        }
        for (const branch of holders) {
            classes.set(branch.name, 'open');
            log(`kept ${branch.name}: last remote holder of recorded measurement revision ${revision}`);
        }
    }
}
