import { REQUIRED_BASE_BRANCH, REQUIRED_REPOSITORY } from './githubAppIdentity.ts';

export const MEASUREMENT_REVISION = /^[0-9a-f]{40}$/u;

export type RemoteBranch = { name: string; tip: string };
export type BranchRevisionReader = { branchHoldsRevision: (branch: RemoteBranch, revision: string) => boolean };
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
 * Every branch whose tip reaches the revision. A revision GitHub confirms is gone has no holder,
 * and a stale table entry recording one must not abort pruning, so that case reports the revision
 * and answers no holders; any other comparison failure stays unanswerable and propagates.
 *
 * The classification keys on the `gh: Not Found (HTTP 404)` text gh surfaces and on a well-formed
 * full revision, because that text is the only status signal the wrapper carries. The exact shape
 * was reproduced read-only against the live API with
 * `gh api repos/:owner/:repo/compare/0000000000000000000000000000000000000000...<tip> --jq .status`.
 */
function branchesHoldingRevision(
    branches: RemoteBranch[],
    revision: string,
    port: BranchRevisionReader,
    log: (message: string) => void
): RemoteBranch[] {
    const holding: RemoteBranch[] = [];
    for (const branch of branches) {
        try {
            if (port.branchHoldsRevision(branch, revision)) {
                holding.push(branch);
            }
        } catch (error) {
            const gone =
                MEASUREMENT_REVISION.test(revision) && error instanceof Error && /\bHTTP 404\b/u.test(error.message);
            if (!gone) {
                throw error;
            }
            log(`unresolvable measurement revision ${revision}: no remote branch holds it`);
            return [];
        }
    }
    return holding;
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
 * (kept) exactly like the base-dependent guard, leaving the plan's shape intact. A revision the
 * remote confirms gone is reported by name and skipped, because a stale table entry must not abort
 * a plan that has no other reason to stop; a comparison nothing can answer still refuses.
 */
export function retainMeasurementRevisionHolders(
    branches: RemoteBranch[],
    classes: Map<string, BranchClass>,
    port: BranchRevisionReader & { recordedMeasurementRevisions: () => string[] },
    log: (message: string) => void
): void {
    for (const revision of port.recordedMeasurementRevisions()) {
        const holders = branchesHoldingRevision(branches, revision, port, log);
        if (holders.some((branch) => classes.get(branch.name) !== 'spent')) {
            continue;
        }
        for (const branch of holders) {
            classes.set(branch.name, 'open');
            log(`kept ${branch.name}: last remote holder of recorded measurement revision ${revision}`);
        }
    }
}
