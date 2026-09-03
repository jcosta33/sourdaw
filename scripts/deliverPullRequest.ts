#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
    AUTHOR_BOT_NODE_ID,
    REVIEWER_BOT_NODE_ID,
    assertRequiredRepository,
    authenticateRole,
    authenticateTrackerAuthor,
    gitAuthenticatedArgs,
    GITHUB_HTTPS_REMOTE,
    isAuthorBotNodeId,
    isReviewerBotNodeId,
    REQUIRED_BASE_BRANCH,
    REQUIRED_REPOSITORY,
    resolvePrimaryRoot,
    spawnCapture,
    spawnRun,
} from './githubAppIdentity.ts';
import {
    TITLE_PATTERN,
    assertPullRequestBody,
    canonicalIssueReferenceFromBody,
    composeDeliveryReceipt,
    fail,
    parseDeliveryReceipt,
    type DeliveryReceiptPayload,
} from './prContract.ts';
import {
    type PullRequestMutationSerialization,
    type PullRequestRemoteMutationBoundary,
    withPullRequestMutationLock,
} from './pullRequestMutationLock.ts';
import { shellPort as trackerIssueShellPort } from './reconcileTrackerIssue.ts';
import {
    runRecoverDeliveryLockCli,
    type DeliveryLockRecoveryDependencies,
    type DeliveryLockRecoveryTrustedLauncher,
} from './recoverDeliveryLock.ts';
import { completeTrackerIssue, type ReconcileTrackerIssuePort } from './trackerIssueReconciliation.ts';

export type HeadCheckRun = {
    name: string;
    status: string;
    conclusion: string | null;
    /** When GitHub began this attempt, or null where the rollup entry reports no start. */
    startedAt: string | null;
};

export type PullRequestSnapshot = {
    number: number;
    state: string;
    isDraft: boolean;
    title: string;
    body: string | null;
    headRefName: string;
    headRefOid: string;
    baseRefName: string;
    baseRefOid: string;
    mergeable: string;
    mergeStateStatus: string;
    reviewDecision: string;
    changedFiles: number;
    additions: number;
    deletions: number;
    mergedByActorNodeId: string | null;
};

export type ReviewState = {
    latestReviewerStateOnHead: string | null;
    unresolvedThreads: number;
};

export type StackedPullRequest = Pick<
    PullRequestSnapshot,
    'number' | 'state' | 'headRefName' | 'headRefOid' | 'baseRefName'
>;

/**
 * The evidence a merge state is judged against, kept off `pullRequest` because reading it can
 * refuse. A dependent's snapshot and an already-merged pull request's snapshot are both read after
 * the squash has landed, and a rollup read that throws there would strand the dependents on a merged
 * branch. Only the one caller that judges the head asks for check runs.
 */
export type CheckEvidencePort = {
    gateRequiredCheckNames: () => ReadonlySet<string>;
    headCheckRuns: (number: number, headRefOid: string) => HeadCheckRun[];
    /** The `required_status_checks` contexts on the live `main` ruleset, read fresh from GitHub. */
    requiredStatusCheckContexts: () => string[];
};

export type DeliveryPort = CheckEvidencePort & {
    fetch: () => void;
    pullRequest: (number: number) => PullRequestSnapshot;
    reviewState: (number: number, expectedHead: string) => ReviewState;
    dependents: (baseBranch: string) => StackedPullRequest[];
    repositoryDeletesMergedBranches: () => boolean;
    merge: (number: number, expectedHead: string, hasDependents: boolean, expectedTitle?: string) => void;
    retarget: (number: number, baseBranch: string) => void;
    deliveryReceipts: (number: number) => DeliveryReceiptComment[];
    deliveryReceiptProof: (number: number) => DeliveryReceiptProof;
    addDeliveryReceipt: (number: number, body: string) => DeliveryReceiptComment;
    readDeliveryReceiptAuthority: (number: number) => PersistedDeliveryReceiptAuthority | undefined;
    writeDeliveryReceiptAuthority: (
        number: number,
        authority: PersistedDeliveryReceiptAuthority,
        expectedCurrent?: DeliveryReceiptAuthorityExpectation
    ) => void;
    clearDeliveryReceiptAuthority: (number: number, expectedCurrent?: DeliveryReceiptAuthorityExpectation) => void;
    log: (message: string) => void;
};

export type DeliveryReceiptAuthorityExpectation =
    { mode: 'absent' } | { mode: 'present'; authority: PersistedDeliveryReceiptAuthority };

export type DeliveryReceiptComment = {
    id: string;
    body: string;
    authorNodeId: string | null;
    authorLogin: string | null;
    authorType: string | null;
    createdAt: string;
    updatedAt: string;
};

export type TrackerCompletionPort = {
    complete: (issueNumber: number) => void;
};

export type DeliveryReceiptProof = {
    totalCount: number;
    latestCommentId: string | undefined;
    commentIds?: string[];
    editedCommentIds?: string[];
};

export type ShellRunner = {
    capture: (command: string, args: string[]) => string;
    run: (command: string, args: string[]) => void;
};

const REQUIRED_CHECK_NAME = 'Gate';
const SETTLED_CHECK_STATUS = 'COMPLETED';
const SUPERSEDED_CONCLUSION = 'CANCELLED';
const PASSING_CONCLUSION = 'SUCCESS';
const SKIPPED_CONCLUSION = 'SKIPPED';
/**
 * `SKIPPED` is a designed outcome: the workflow's path filters skip whole legs, and `Gate` is built
 * to pass on a skipped dependency. Nothing in it is designed to conclude `NEUTRAL`, which reports a
 * check that ran and reached no verdict — the same undecided state a cancellation with no success
 * beside it is refused for. An irreversible merge does not step over it.
 */
const NON_BLOCKING_CONCLUSIONS = new Set([PASSING_CONCLUSION, SKIPPED_CONCLUSION]);
/**
 * A conclusion that says nothing about this commit. A cancelled attempt was killed before it decided
 * and a skipped one never executed, so neither is a later word on the name it reports under. Not
 * blocking and having decided are different properties, and `SKIPPED` is the conclusion that is
 * non-blocking without being a verdict — which is exactly why the two sets are written apart.
 */
const NON_VERDICT_CONCLUSIONS = new Set([SUPERSEDED_CONCLUSION, SKIPPED_CONCLUSION]);
const CHECKS_PENDING_MERGE_STATE = 'UNSTABLE';
/**
 * The one merge state GitHub's own ruleset enforcement refuses to merge under, whatever CI admission
 * mode this delivery is running in. Every other `mergeStateStatus` value is a report, not a refusal:
 * advisory admission tolerates it and lets the merge attempt stand or fail on its own. `BLOCKED`
 * alone means the merge endpoint would answer 405 no matter what this script does next, so admitting
 * it here would only spend a receipt comment and a merge attempt on a result already decided.
 */
const BLOCKED_MERGE_STATE = 'BLOCKED';
const STRUCTURAL_MERGEABILITY_REFRESH_LIMIT = 1;

type CiAdmissionMode = 'advisory' | 'required';

const ACTIVE_CI_ADMISSION_MODE: CiAdmissionMode = 'advisory';

type DeliveryMergeRejectionCertainty = 'ambiguous' | 'definitive-no-merge';

export type DeliveryReceiptAuthorityPhase = 'released' | 'prepared' | 'merge-authorized' | 'terminal';

export class DeliveryMergeRejectedError extends Error {
    readonly certainty: DeliveryMergeRejectionCertainty;

    constructor(message: string, certainty: DeliveryMergeRejectionCertainty = 'ambiguous') {
        super(message);
        this.name = 'DeliveryMergeRejectedError';
        this.certainty = certainty;
    }
}

function classifyGithubMergeRejection(number: number, error: unknown): DeliveryMergeRejectedError | undefined {
    const detail = error instanceof Error ? error.message : String(error);
    if (!/\bHTTP (403|404|405|409|422)\b/u.test(detail)) {
        return undefined;
    }
    return new DeliveryMergeRejectedError(
        `PR #${number} was not merged: ${detail}`,
        /\bHTTP 422\b/u.test(detail) ? 'definitive-no-merge' : 'ambiguous'
    );
}

export type PersistedPreparedPostMergeValidation = {
    headRefOid: string;
    headRefName: string;
    baseRefName: string;
    bodySha256: string;
    trackerTarget: number | null;
    title?: string;
};

type PersistedDeliveryReceiptAuthorityBase = {
    receiptId: string;
};

type CurrentPersistedDeliveryReceiptAuthorityBase = PersistedDeliveryReceiptAuthorityBase & {
    receiptBody?: string;
};

type LegacyPersistedDeliveryReceiptAuthority = PersistedDeliveryReceiptAuthorityBase & {
    phase: 'legacy';
};

type CurrentPersistedPreparedDeliveryReceiptAuthority = CurrentPersistedDeliveryReceiptAuthorityBase & {
    phase: 'prepared';
    postMergeValidation?: PersistedPreparedPostMergeValidation;
};

type CurrentPersistedReleasedDeliveryReceiptAuthority = CurrentPersistedDeliveryReceiptAuthorityBase & {
    phase: 'released';
};

type CurrentPersistedMergeRecoveredDeliveryReceiptAuthority = CurrentPersistedDeliveryReceiptAuthorityBase & {
    phase: 'merge-authorized' | 'terminal';
    postMergeValidation?: PersistedPreparedPostMergeValidation;
};

type CurrentPersistedDeliveryReceiptAuthority =
    | CurrentPersistedReleasedDeliveryReceiptAuthority
    | CurrentPersistedPreparedDeliveryReceiptAuthority
    | CurrentPersistedMergeRecoveredDeliveryReceiptAuthority;

export type PersistedDeliveryReceiptAuthority =
    | LegacyPersistedDeliveryReceiptAuthority
    | CurrentPersistedReleasedDeliveryReceiptAuthority
    | CurrentPersistedPreparedDeliveryReceiptAuthority
    | CurrentPersistedMergeRecoveredDeliveryReceiptAuthority;

type StoredLegacyDeliveryReceiptAuthority = {
    version: 1;
    receiptId: string;
};

type StoredCurrentDeliveryReceiptAuthority =
    | ({ version: 2 } & CurrentPersistedReleasedDeliveryReceiptAuthority)
    | ({ version: 2 } & CurrentPersistedPreparedDeliveryReceiptAuthority)
    | ({ version: 2 } & CurrentPersistedMergeRecoveredDeliveryReceiptAuthority);

type StoredDeliveryReceiptAuthority = StoredLegacyDeliveryReceiptAuthority | StoredCurrentDeliveryReceiptAuthority;

function isCurrentPersistedDeliveryReceiptAuthority(
    authority: PersistedDeliveryReceiptAuthority
): authority is CurrentPersistedDeliveryReceiptAuthority {
    return authority.phase !== 'legacy';
}

function isFrozenPersistedDeliveryReceiptAuthority(
    authority: PersistedDeliveryReceiptAuthority | undefined
): authority is CurrentPersistedDeliveryReceiptAuthority {
    return (
        authority !== undefined &&
        authority.phase !== 'legacy' &&
        (authority.phase === 'merge-authorized' ||
            authority.phase === 'terminal' ||
            (authority.phase === 'prepared' && authority.postMergeValidation !== undefined))
    );
}

function assertFrozenPersistedDeliveryReceiptAuthority(
    number: number,
    current: CurrentPersistedDeliveryReceiptAuthority,
    next: CurrentPersistedDeliveryReceiptAuthority
): void {
    if (current.receiptId !== next.receiptId) {
        fail(`PR #${number} delivery receipt changed during delivery`);
    }
    if (
        current.receiptBody !== undefined &&
        next.receiptBody !== undefined &&
        current.receiptBody !== next.receiptBody
    ) {
        fail(`PR #${number} delivery receipt changed during delivery`);
    }
    if (
        current.phase !== 'released' &&
        next.phase !== 'released' &&
        current.postMergeValidation !== undefined &&
        next.postMergeValidation !== undefined &&
        !samePreparedPostMergeValidation(current.postMergeValidation, next.postMergeValidation)
    ) {
        fail(`PR #${number} delivery receipt changed during delivery`);
    }
}

function validatePullRequest(
    pullRequest: PullRequestSnapshot,
    checks: CheckEvidencePort,
    ciAdmissionMode: CiAdmissionMode
): void {
    if (pullRequest.state !== 'OPEN') {
        fail(`PR #${pullRequest.number} is ${pullRequest.state.toLowerCase()}`);
    }
    if (pullRequest.isDraft) {
        fail(`PR #${pullRequest.number} is still a draft`);
    }
    if (!TITLE_PATTERN.test(pullRequest.title)) {
        fail(`PR #${pullRequest.number} title is not conventional`);
    }
    validateCiAdmission(pullRequest, checks, ciAdmissionMode);
    if (pullRequest.reviewDecision === 'CHANGES_REQUESTED') {
        fail(`PR #${pullRequest.number} has requested changes`);
    }
}

function validateCiAdmission(pullRequest: PullRequestSnapshot, checks: CheckEvidencePort, mode: CiAdmissionMode): void {
    if (mode === 'advisory') {
        validateAdvisoryMergeGate(pullRequest, checks);
        return;
    }
    validateRequiredCiAdmission(pullRequest, checks);
}

/**
 * Advisory admission otherwise ignores `mergeStateStatus` entirely, but `BLOCKED` is GitHub's own
 * ruleset refusing the merge before this script ever calls it: attempting it anyway spends a receipt
 * comment and a merge call on a 405 the ruleset already decided, and both of those calls mark the
 * remote mutation boundary, which is what strands the per-PR lock. Refusing here, before either call,
 * lets the lock release normally. The named checks are read best-effort, purely to make the refusal
 * legible, and the three outcomes say different things: a failed read cannot name anything; an
 * unsatisfied set names what is still pending or failing; an empty set means every required check
 * the ruleset names is satisfied on its newest attempt, so the block is something else the ruleset
 * also enforces — an unresolved review thread, the review decision, or another rule entirely — and
 * saying "could not be listed" there would be false, not just uninformative.
 */
function validateAdvisoryMergeGate(pullRequest: PullRequestSnapshot, checks: CheckEvidencePort): void {
    if (pullRequest.mergeStateStatus !== BLOCKED_MERGE_STATE) {
        return;
    }
    const unsatisfied = unsatisfiedAdvisoryRequiredContexts(pullRequest, checks);
    if (unsatisfied === undefined) {
        fail(`PR #${pullRequest.number} merge state is BLOCKED and the required checks could not be listed`);
    }
    if (unsatisfied.length === 0) {
        fail(
            `PR #${pullRequest.number} merge state is BLOCKED although every required check succeeded; ` +
                `the block is an unresolved review thread, the review decision, or another ruleset rule`
        );
    }
    fail(`PR #${pullRequest.number} merge state is BLOCKED on required check(s): ${unsatisfied.join(', ')}`);
}

/**
 * The names GitHub's live ruleset requires, filtered to the ones the head's own check runs do not
 * yet show as satisfied. Both the ruleset read and the check-run read are network calls that can
 * fail independently of the `BLOCKED` verdict itself, and either failure leaves this undefined rather
 * than losing the refusal to an unrelated exception.
 */
function unsatisfiedAdvisoryRequiredContexts(
    pullRequest: Pick<PullRequestSnapshot, 'number' | 'headRefOid'>,
    checks: CheckEvidencePort
): string[] | undefined {
    try {
        const requiredContexts = checks.requiredStatusCheckContexts();
        const checkRuns = checks.headCheckRuns(pullRequest.number, pullRequest.headRefOid);
        return requiredContexts.filter((context) => !isSatisfiedRequiredContext(context, checkRuns));
    } catch {
        return undefined;
    }
}

/**
 * GitHub evaluates the newest run of a required name, so any satisfying attempt under the name
 * cannot satisfy the context: an older one must not cover a newer red one. The context is satisfied
 * only when some settled success or skip provably started after every other attempt of the name — a
 * newer failure then leaves it unsatisfied, an attempt still in flight leaves it pending, and an
 * attempt GitHub reports no start for supersedes nothing, the same conservatism as `startedAfter`.
 * A `skipped` conclusion satisfies a required check by GitHub's own rule; this repository's
 * topology no longer mints a skipped `Gate`, so the skip arm is latent but faithful.
 */
function isSatisfiedRequiredContext(context: string, checkRuns: HeadCheckRun[]): boolean {
    const attempts = checkRuns.filter((run) => run.name === context);
    const satisfying = attempts.filter(
        (run) =>
            run.status === SETTLED_CHECK_STATUS &&
            (run.conclusion === PASSING_CONCLUSION || run.conclusion === SKIPPED_CONCLUSION)
    );
    if (satisfying.length === 0) {
        return false;
    }
    return attempts.every(
        (attempt) => satisfying.includes(attempt) || satisfying.some((satisfied) => startedAfter(satisfied, attempt))
    );
}

/**
 * Push and approved-review runs still report on the same pull-request head, and GitHub can keep the
 * aggregate `UNSTABLE` when cancelled check runs remain on that head beside later successes on the
 * same commit. Tolerating that state means proving the head green here instead of trusting the
 * aggregate: no check name's newest attempt failed, nothing is still running, the one required check
 * succeeded, and every cancelled name also succeeded. Every other status still refuses, because it
 * reports something other than checks.
 */
function validateRequiredCiAdmission(pullRequest: PullRequestSnapshot, checks: CheckEvidencePort): void {
    if (pullRequest.mergeStateStatus === 'CLEAN') {
        return;
    }
    if (pullRequest.mergeStateStatus !== CHECKS_PENDING_MERGE_STATE) {
        fail(`PR #${pullRequest.number} merge state is ${pullRequest.mergeStateStatus}`);
    }
    validateSupersededChecks(pullRequest, checks);
}

function validateStructuralMergeability(pullRequest: PullRequestSnapshot): void {
    if (pullRequest.mergeable === 'MERGEABLE') {
        return;
    }
    if (pullRequest.mergeable === 'CONFLICTING') {
        fail(`PR #${pullRequest.number} has conflicting changes`);
    }
    if (pullRequest.mergeable === 'UNKNOWN') {
        fail(
            `PR #${pullRequest.number} structural mergeability remained UNKNOWN after ` +
                `${STRUCTURAL_MERGEABILITY_REFRESH_LIMIT} refresh`
        );
    }
    fail(`PR #${pullRequest.number} has invalid structural mergeability ${String(pullRequest.mergeable)}`);
}

function refreshStructuralMergeability(
    initial: PullRequestSnapshot,
    port: Pick<DeliveryPort, 'pullRequest'>,
    observe?: (pullRequest: PullRequestSnapshot) => void
): PullRequestSnapshot {
    let pullRequest = initial;
    observe?.(pullRequest);
    if (pullRequest.state === 'MERGED' || pullRequest.state === 'CLOSED') {
        return pullRequest;
    }
    for (
        let refreshes = 0;
        pullRequest.state === 'OPEN' &&
        pullRequest.mergeable === 'UNKNOWN' &&
        refreshes < STRUCTURAL_MERGEABILITY_REFRESH_LIMIT;
        refreshes += 1
    ) {
        const refreshed = port.pullRequest(initial.number);
        observe?.(refreshed);
        if (refreshed.state === 'MERGED' || refreshed.state === 'CLOSED') {
            return refreshed;
        }
        validateStablePullRequest(initial, refreshed);
        pullRequest = refreshed;
    }
    return pullRequest;
}

function resolveStructuralMergeability(
    initial: PullRequestSnapshot,
    port: Pick<DeliveryPort, 'pullRequest'>
): PullRequestSnapshot {
    const pullRequest = refreshStructuralMergeability(initial, port);
    if (pullRequest.state === 'MERGED' || pullRequest.state === 'CLOSED') {
        return pullRequest;
    }
    validateStructuralMergeability(pullRequest);
    return pullRequest;
}

function validateSupersededChecks(pullRequest: PullRequestSnapshot, checks: CheckEvidencePort): void {
    const state = `PR #${pullRequest.number} merge state is ${pullRequest.mergeStateStatus}`;
    const checkRuns = checks.headCheckRuns(pullRequest.number, pullRequest.headRefOid);
    const failed = unretiredFailedCheckRun(checkRuns);
    if (failed !== undefined) {
        fail(`${state} and check ${failed.name} concluded ${failed.conclusion ?? 'nothing'}`);
    }
    const unsettled = checkRuns.find((check) => check.status !== SETTLED_CHECK_STATUS);
    if (unsettled !== undefined) {
        fail(`${state} and check ${unsettled.name} is still ${unsettled.status}`);
    }
    if (!checkRuns.some(isSuccessfulRequiredCheck)) {
        fail(`${state} and no ${REQUIRED_CHECK_NAME} check succeeded on ${pullRequest.headRefOid}`);
    }
    const undecided = undecidedCancelledCheckName(checkRuns, checks.gateRequiredCheckNames());
    if (undecided !== undefined) {
        fail(`${state} and check ${undecided} was cancelled and never succeeded on ${pullRequest.headRefOid}`);
    }
}

/**
 * A rerun of one job on the same commit reports under the same check name, so a name can carry
 * several attempts and only the newest of them is this head's verdict. Push and approved-review runs
 * produce exactly that: a job that failed on a runner-setup step under the push run is re-executed
 * green by the review run, and counting the retired attempt refuses a head every attempt of which
 * has since been decided.
 *
 * Recency is read from `startedAt`, the moment GitHub began the attempt. It is the field that orders
 * attempts by when they were launched, which is what "superseded" means: the rerun is launched after
 * the attempt it replaces, however long either takes to finish. `completedAt` orders that same pair
 * backwards whenever a slow first attempt outlives a fast rerun, and a node id encodes no promise
 * about time at all.
 */
function unretiredFailedCheckRun(checkRuns: HeadCheckRun[]): HeadCheckRun | undefined {
    return checkRuns
        .filter(isFailedCheckRun)
        .find((failed) => !checkRuns.some((candidate) => retiresAttempt(candidate, failed)));
}

/**
 * Only a later attempt that itself reached a verdict retires an earlier one. A non-verdict
 * conclusion and a still-running rerun decide nothing, so reading either as the newer word would
 * drop a real failure out of the evidence — the one direction this rule must never move.
 * health-gates.yml no longer subscribes to `pull_request_review`, and the heavy workflow's
 * validation lane runs only on approved reviews, so a non-approved review event mints only
 * skipped check runs on the head — no green verdict, and a skip never retires a failure here;
 * a skipped later attempt from any other path would still be the same shape. Were a
 * skip allowed to retire, it would stamp a fresh non-verdict over a genuine failing execution and
 * the head would merge.
 *
 * Attempts GitHub reports no start for, and attempts that share a start, order nothing and so retire
 * nothing: absent or ambiguous recency leaves the failure standing rather than guessing it away.
 */
function retiresAttempt(candidate: HeadCheckRun, attempt: HeadCheckRun): boolean {
    return (
        candidate.name === attempt.name &&
        candidate.status === SETTLED_CHECK_STATUS &&
        !NON_VERDICT_CONCLUSIONS.has(candidate.conclusion ?? '') &&
        startedAfter(candidate, attempt)
    );
}

function startedAfter(candidate: HeadCheckRun, attempt: HeadCheckRun): boolean {
    const candidateStart = Date.parse(candidate.startedAt ?? '');
    const attemptStart = Date.parse(attempt.startedAt ?? '');
    return Number.isFinite(candidateStart) && Number.isFinite(attemptStart) && candidateStart > attemptStart;
}

/**
 * A cancelled run is the only tolerated corpse. Anything else that settled without a passing
 * conclusion — an unrecognized one included — is a real result the merge must not step over.
 */
function isFailedCheckRun(check: HeadCheckRun): boolean {
    return (
        check.status === SETTLED_CHECK_STATUS &&
        check.conclusion !== SUPERSEDED_CONCLUSION &&
        !NON_BLOCKING_CONCLUSIONS.has(check.conclusion ?? '')
    );
}

/**
 * Tolerating a cancellation rests on some later run having re-run that same job on the same commit,
 * which is only observable as a success under the same check name. A name that was cancelled and
 * never succeeded on the head therefore carries no verdict at all, and a skipped sibling does not
 * supply one: jobs gated on the pull-request payload can still skip on a later run, and `Gate`
 * passes on `skipped`, so a green `Gate` says nothing about whether that job ran.
 * `Dependency review` has exactly this shape when its cancellation is followed only by skips beside
 * it, with no success anywhere. This rule consequently refuses such a head rather than merging with
 * no dependency-scan verdict, which is the honest outcome: an undecided scan is not a passing scan.
 *
 * Only a check whose verdict gates the merge is evidence. `Nightly failure report` is cancelled on
 * the same superseded run and never succeeds on a pull request, but it reports a nightly schedule
 * rather than deciding this head, so refusing on it would refuse every delivery forever. The gating
 * set is whatever `Gate` needs, read from the workflow rather than restated here.
 */
function undecidedCancelledCheckName(checks: HeadCheckRun[], required: ReadonlySet<string>): string | undefined {
    const passed = new Set(
        checks.filter((check) => check.conclusion === PASSING_CONCLUSION).map((check) => check.name)
    );
    return checks.find(
        (check) => check.conclusion === SUPERSEDED_CONCLUSION && required.has(check.name) && !passed.has(check.name)
    )?.name;
}

function isSuccessfulRequiredCheck(check: HeadCheckRun): boolean {
    return check.name === REQUIRED_CHECK_NAME && check.conclusion === PASSING_CONCLUSION;
}

const HEALTH_GATES_WORKFLOW_PATH = '.github/workflows/health-gates.yml';
const GATE_JOB_ID = 'gate';
const EXPRESSION_OPENER = '${{';
const GATE_WORKFLOW_ENV = 'SOURDAW_TRUSTED_GATE_WORKFLOW';

/** One job as the workflow declares it. Every value is unresolved, because resolving one is a rule. */
type WorkflowJob = { name?: unknown; needs?: unknown; uses?: unknown; strategy?: unknown };
type WorkflowJobs = Record<string, WorkflowJob>;

/**
 * A workflow a gated job calls, carried by the launcher read at the pinned commit. GitHub reports
 * its jobs as one check per inner job named `<caller job name> / <inner job name>`, which is what
 * makes the validation lane's legs derivable at all.
 */
type CalledWorkflow = { name?: unknown; jobs: WorkflowJobs } | { unreadable: string };
type CalledWorkflows = Record<string, CalledWorkflow>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failUnreadableWorkflow(reason: string): never {
    return fail(`cannot read ${HEALTH_GATES_WORKFLOW_PATH} to determine which checks gate the merge: ${reason}`);
}

/**
 * The launcher parses the workflow with a real YAML parser and hands the result over as JSON; this
 * side decides what that result means. Splitting it that way is what lets every shape a line-oriented
 * reader used to trip over — a continued scalar, a quoted or spaced key, a tab before a comment, a
 * block scalar, an anchor, an alias, a tag, a field at any indent — resolve to exactly the name
 * GitHub reports, while every rule that can refuse an irreversible merge stays here, in the closure
 * pinned to `origin/main`.
 *
 * The snapshot holds nothing but `scripts/`, so `JSON.parse` is the only parser reachable here.
 */
export function gateRequiredCheckNames(serialized: string): ReadonlySet<string> {
    const { jobs, called } = workflowSummary(serialized);
    const gate = jobs[GATE_JOB_ID];
    if (gate === undefined) {
        fail(
            `${HEALTH_GATES_WORKFLOW_PATH} declares no ${GATE_JOB_ID} job, ` +
                `so no check can be proven to gate the merge`
        );
    }
    const names = new Set<string>();
    for (const jobId of gateNeeds(gate.needs)) {
        for (const name of requiredCheckNames(jobId, jobs, called)) {
            names.add(name);
        }
    }
    return names;
}

function workflowSummary(serialized: string): { jobs: WorkflowJobs; called: CalledWorkflows } {
    let summary: unknown;
    try {
        summary = JSON.parse(serialized);
    } catch (error) {
        failUnreadableWorkflow(`${GATE_WORKFLOW_ENV} is not JSON: ${error instanceof Error ? error.message : ''}`);
    }
    if (!isRecord(summary)) {
        failUnreadableWorkflow(`${GATE_WORKFLOW_ENV} is not a workflow summary`);
    }
    if (typeof summary.unreadable === 'string') {
        failUnreadableWorkflow(summary.unreadable);
    }
    if (!isRecord(summary.jobs)) {
        failUnreadableWorkflow(`${GATE_WORKFLOW_ENV} carries no jobs mapping`);
    }
    return { jobs: declaredJobs(summary.jobs, ''), called: calledWorkflows(summary.called) };
}

function declaredJobs(jobs: Record<string, unknown>, ownerSuffix: string): WorkflowJobs {
    // Every job id here is workflow-controlled text, so a plain object literal would let one resolve
    // against `Object.prototype`: `__proto__` moves the prototype rather than becoming an own key,
    // and `toString` or `constructor` answers a lookup no job declares. A prototype-free map is the
    // only one where "the workflow declares this job" and "this key reads back" are the same claim.
    const declared: WorkflowJobs = Object.create(null) as WorkflowJobs;
    for (const [jobId, job] of Object.entries(jobs)) {
        if (!isRecord(job)) {
            failUnreadableWorkflow(`the ${jobId} job${ownerSuffix} is not a mapping`);
        }
        declared[jobId] = job;
    }
    return declared;
}

/**
 * The called workflows the launcher carried, keyed by the literal `uses` path. A summary written
 * before the lane split carries none, which reads as an empty mapping: every reusable call then
 * refuses for want of the called file rather than for a malformed summary.
 */
function calledWorkflows(carried: unknown): CalledWorkflows {
    const called: CalledWorkflows = Object.create(null) as CalledWorkflows;
    if (carried === undefined) {
        return called;
    }
    if (!isRecord(carried)) {
        failUnreadableWorkflow(`${GATE_WORKFLOW_ENV} carries a called mapping that is not a mapping`);
    }
    for (const [usesPath, entry] of Object.entries(carried)) {
        if (!isRecord(entry)) {
            failUnreadableWorkflow(`the called workflow ${usesPath} is not a mapping`);
        }
        if (typeof entry.unreadable === 'string') {
            called[usesPath] = { unreadable: entry.unreadable };
            continue;
        }
        if (!isRecord(entry.jobs)) {
            failUnreadableWorkflow(`the called workflow ${usesPath} carries no jobs mapping`);
        }
        called[usesPath] = { name: entry.name, jobs: declaredJobs(entry.jobs, ` in the called workflow ${usesPath}`) };
    }
    return called;
}

/**
 * `needs` is a single job id or a list of them. A gate that needs nothing proves nothing, so it
 * refuses rather than deriving an empty gating set that tolerates every cancellation on the head.
 */
function gateNeeds(declared: unknown): string[] {
    const entries = typeof declared === 'string' ? [declared] : declared;
    if (!Array.isArray(entries) || entries.length === 0) {
        fail(
            `the ${GATE_JOB_ID} job in ${HEALTH_GATES_WORKFLOW_PATH} needs no job, ` +
                `so no check can be proven to gate the merge`
        );
    }
    const needs = entries.filter((entry): entry is string => typeof entry === 'string' && entry !== '');
    if (needs.length !== entries.length) {
        fail(
            `the ${GATE_JOB_ID} job in ${HEALTH_GATES_WORKFLOW_PATH} needs an entry that is not a job id, ` +
                `so no check can be proven to gate the merge`
        );
    }
    return needs;
}

/**
 * The names GitHub labels a job's checks with, or a refusal where this gate cannot produce them. A
 * matrix name on a job the gate needs directly is a template GitHub substitutes per shard, and as
 * declared it matches no check on the head — it would silently match nothing and tolerate every
 * real cancellation. The summary does carry that job's strategy now; the refusal to expand a direct
 * job's matrix here was kept deliberately and is recorded as issue #2924. A job that calls a
 * reusable workflow resolves through the called file the launcher carried, where the same
 * substitution becomes derivable because the called file declares its own matrix values.
 */
function requiredCheckNames(jobId: string, jobs: WorkflowJobs, called: CalledWorkflows): string[] {
    const job = jobs[jobId];
    if (job === undefined) {
        fail(
            `the ${GATE_JOB_ID} job in ${HEALTH_GATES_WORKFLOW_PATH} needs ${jobId}, ` +
                `which no job in that workflow defines`
        );
    }
    if (job.uses !== undefined && job.uses !== null) {
        return reusableCheckNames(jobId, job, called);
    }
    const name = declaredCheckName(jobId, job.name, HEALTH_GATES_WORKFLOW_PATH);
    if (name.includes(EXPRESSION_OPENER)) {
        fail(
            `the ${jobId} job in ${HEALTH_GATES_WORKFLOW_PATH} names its check ${name}, ` +
                `which GitHub substitutes per matrix job before reporting it`
        );
    }
    return [name];
}

/**
 * The checks of a called reusable workflow, one per inner job, named `<caller name> / <inner name>`.
 * Every arm that cannot derive those names refuses rather than deriving a set that matches nothing:
 * a call the launcher did not carry, a called file it could not read, a caller name GitHub would
 * substitute, a nested call, and a called workflow with no jobs all leave the merge with no verdict.
 */
function reusableCheckNames(jobId: string, job: WorkflowJob, called: CalledWorkflows): string[] {
    if (typeof job.uses !== 'string' || job.uses === '') {
        fail(
            `the ${jobId} job in ${HEALTH_GATES_WORKFLOW_PATH} declares a reusable call that is not a workflow path, ` +
                `so no check can be proven to gate the merge`
        );
    }
    const target = called[job.uses];
    if (target === undefined) {
        fail(
            `the ${jobId} job in ${HEALTH_GATES_WORKFLOW_PATH} calls ${job.uses}, ` +
                `which the launcher did not carry, so no check can be proven to gate the merge`
        );
    }
    if ('unreadable' in target) {
        fail(`cannot read ${job.uses} to determine which checks gate the merge: ${target.unreadable}`);
    }
    const callerName = declaredCheckName(jobId, job.name, HEALTH_GATES_WORKFLOW_PATH);
    if (callerName.includes(EXPRESSION_OPENER)) {
        fail(
            `the ${jobId} job in ${HEALTH_GATES_WORKFLOW_PATH} names its check ${callerName}, ` +
                `which GitHub substitutes before reporting it`
        );
    }
    const innerIds = Object.keys(target.jobs);
    if (innerIds.length === 0) {
        fail(
            `the ${jobId} job in ${HEALTH_GATES_WORKFLOW_PATH} calls ${job.uses}, ` +
                `which declares no jobs, so no check can be proven to gate the merge`
        );
    }
    const names: string[] = [];
    for (const innerId of innerIds) {
        const inner = target.jobs[innerId];
        if (inner === undefined) {
            failUnreadableWorkflow(`the ${innerId} job in the called workflow ${job.uses} read back as absent`);
        }
        if (inner.uses !== undefined && inner.uses !== null) {
            fail(
                `the ${innerId} job in ${job.uses} calls a nested reusable workflow, ` +
                    `whose check names this gate does not derive`
            );
        }
        const innerName = declaredCheckName(innerId, inner.name, job.uses);
        for (const resolved of resolveMatrixName(innerId, innerName, inner.strategy, job.uses)) {
            names.push(`${callerName} / ${resolved}`);
        }
    }
    return names;
}

const MATRIX_REFERENCE = /\$\{\{\s*matrix\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/**
 * The one expression a check name may carry and stay derivable: `matrix.<dimension>` references
 * substituted from the statically declared matrix, which is how `Unit suite ${{ matrix.shard }}/4`
 * becomes the four names GitHub reports. Anything else — a matrix the file does not declare, an
 * `include`/`exclude` that rewrites the combination set, a dimension that is not a list of text or
 * numbers, or a non-matrix expression — names checks this gate cannot know, and refuses.
 */
function resolveMatrixName(jobId: string, name: string, strategy: unknown, workflowPath: string): string[] {
    if (!name.includes(EXPRESSION_OPENER)) {
        return [name];
    }
    const dimensions = [
        ...new Set([...name.matchAll(MATRIX_REFERENCE)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]))),
    ];
    if (dimensions.length === 0) {
        fail(
            `the ${jobId} job in ${workflowPath} names its check ${name}, ` +
                `which references something other than its matrix dimensions`
        );
    }
    const matrix = isRecord(strategy) && isRecord(strategy.matrix) ? strategy.matrix : undefined;
    if (matrix === undefined) {
        fail(
            `the ${jobId} job in ${workflowPath} names its check ${name}, ` +
                `which GitHub substitutes per matrix job before reporting it`
        );
    }
    if ('include' in matrix || 'exclude' in matrix) {
        fail(
            `the ${jobId} job in ${workflowPath} names its check ${name}, ` +
                `whose matrix include or exclude rewrites the combination set this gate derives`
        );
    }
    let resolved = [name];
    for (const dimension of dimensions) {
        const values = matrix[dimension];
        if (
            !Array.isArray(values) ||
            values.length === 0 ||
            !values.every((value) => typeof value === 'string' || typeof value === 'number')
        ) {
            fail(
                `the ${jobId} job in ${workflowPath} names its check ${name}, ` +
                    `whose matrix dimension ${dimension} is not a list of text or numbers this gate can substitute`
            );
        }
        const reference = new RegExp(`\\$\\{\\{\\s*matrix\\.${dimension}\\s*\\}\\}`, 'g');
        // A replacement function, never a replacement string: `String.replace` would read `$`
        // patterns out of the value, so `a$$b` would arrive as `a$b` and `a$&b` would re-insert
        // the reference — neither is the name GitHub mints.
        resolved = resolved.flatMap((template) =>
            values.map((value) => template.replace(reference, () => String(value)))
        );
    }
    // Substitution only removes matrix references. A name that still opens an expression — one that
    // mixed a matrix reference with `github.event_name`, or one whose matrix value was itself an
    // expression — names a check GitHub never mints, and deriving it would tolerate every real
    // cancellation on the leg.
    if (resolved.some((resolvedName) => resolvedName.includes(EXPRESSION_OPENER))) {
        fail(
            `the ${jobId} job in ${workflowPath} names its check ${name}, ` +
                `which references something other than its matrix dimensions`
        );
    }
    return resolved;
}

/** A job that declares no name is labelled with its job id, which is what GitHub reports for it. */
function declaredCheckName(jobId: string, name: unknown, workflowPath: string): string {
    if (name === undefined || name === null || name === '') {
        return jobId;
    }
    if (typeof name !== 'string') {
        fail(
            `the ${jobId} job in ${workflowPath} declares a name that is not text, ` +
                `which cannot be the name GitHub reports`
        );
    }
    return name;
}

/**
 * The gating set comes from the launcher, which read the workflow as a git object at the pinned
 * `origin/main` commit — the same commit this closure was snapshotted from. Nothing here reads a
 * lane's copy, a working tree, or a local `HEAD`: a lane's copy is the very thing under review, and
 * neither an uncommitted edit nor an unpulled commit is a pinned input, so either would silently
 * reshape the gate for every delivery, in both directions.
 *
 * Absent, the gate cannot say which checks decide the merge and refuses rather than merging with no
 * verdict — which is also what a `deliver` run outside the protected launcher looks like from here.
 */
export function readGateRequiredCheckNames(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
    const serialized = env[GATE_WORKFLOW_ENV];
    if (serialized === undefined || serialized === '') {
        fail(
            `deliver must run through the protected primary checkout launcher, which passes ` +
                `${GATE_WORKFLOW_ENV} from ${HEALTH_GATES_WORKFLOW_PATH} at the pinned origin/main commit`
        );
    }
    return gateRequiredCheckNames(serialized);
}

function trackerCompletionTarget(pullRequest: PullRequestSnapshot): number | undefined {
    const body = pullRequest.body ?? '';
    assertPullRequestBody(body, `PR #${pullRequest.number} body`, pullRequest.title);
    const reference = canonicalIssueReferenceFromBody(body, REQUIRED_REPOSITORY);
    return reference?.relationship === 'closes' ? reference.issue : undefined;
}

function validateReview(number: number, review: ReviewState): void {
    if (review.latestReviewerStateOnHead !== 'APPROVED') {
        fail(
            `PR #${number} is not approved by the required reviewer actor ${REVIEWER_BOT_NODE_ID} on the current head`
        );
    }
    if (review.unresolvedThreads > 0) {
        fail(`PR #${number} has ${review.unresolvedThreads} unresolved review thread(s)`);
    }
}

/**
 * The base is what the change merges into, and nothing in a pull request's own state proves it is
 * still the branch the reviewer approved against: a retarget moves it silently and leaves the head,
 * the approval and the merge state untouched. Stacking does not need a non-default base here.
 * `deliver` merges the bottom pull request of a stack and then retargets whatever was based on its
 * head onto its own base, so the pull request being delivered always targets the trunk, and only
 * its not-yet-delivered dependents ever carry a lane branch as a base.
 */
function validateBaseBranch(pullRequest: PullRequestSnapshot): void {
    if (pullRequest.baseRefName !== REQUIRED_BASE_BRANCH) {
        fail(
            `PR #${pullRequest.number} targets ${pullRequest.baseRefName}, not ${REQUIRED_BASE_BRANCH}; ` +
                `deliver merges into ${REQUIRED_BASE_BRANCH} only. Deliver the pull request this one is ` +
                `stacked on, which retargets this one.`
        );
    }
}

function validateStablePullRequest(before: PullRequestSnapshot, after: PullRequestSnapshot): void {
    const fields: Array<keyof PullRequestSnapshot> = ['headRefOid', 'headRefName', 'baseRefName', 'title', 'body'];
    for (const field of fields) {
        if (before[field] !== after[field]) {
            fail(`PR #${before.number} ${field} changed during delivery`);
        }
    }
}

function validateStableTrackerTarget(number: number, before: number | undefined, after: number | undefined): void {
    if (before !== after) {
        fail(`PR #${number} closing target changed during delivery`);
    }
}

function bodySha256(body: string | null): string {
    return createHash('sha256')
        .update(body ?? '')
        .digest('hex');
}

function persistedPreparedPostMergeValidation(
    pullRequest: Pick<PullRequestSnapshot, 'headRefOid' | 'headRefName' | 'baseRefName' | 'title' | 'body'>,
    trackerTarget: number | undefined
): PersistedPreparedPostMergeValidation {
    return {
        headRefOid: pullRequest.headRefOid,
        headRefName: pullRequest.headRefName,
        baseRefName: pullRequest.baseRefName,
        title: pullRequest.title,
        bodySha256: bodySha256(pullRequest.body),
        trackerTarget: trackerTarget ?? null,
    };
}

function validatePostMergeSnapshot(
    expected: PersistedPreparedPostMergeValidation,
    merged: PullRequestSnapshot,
    number: number
): void {
    if (expected.title === undefined) {
        fail(`PR #${number} delivery receipt authority cannot be proven`);
    }
    validateAuthorAppMerger(merged);
    validateBaseBranch(merged);
    if (expected.title !== merged.title) {
        fail(`PR #${number} title changed during delivery`);
    }
    if (expected.bodySha256 !== bodySha256(merged.body)) {
        fail(`PR #${number} body changed during delivery`);
    }
    if (expected.headRefOid !== merged.headRefOid) {
        fail(`PR #${number} headRefOid changed during delivery`);
    }
    if (expected.headRefName !== merged.headRefName) {
        fail(`PR #${number} headRefName changed during delivery`);
    }
    if (expected.baseRefName !== merged.baseRefName) {
        fail(`PR #${number} baseRefName changed during delivery`);
    }
    validateStableTrackerTarget(number, expected.trackerTarget ?? undefined, trackerCompletionTarget(merged));
}

function validateReceiptPayloadAgainstPreparedPostMergeValidation(
    number: number,
    payload: DeliveryReceiptPayload,
    validation: PersistedPreparedPostMergeValidation,
    phase: 'delivery' | 'recovery'
): void {
    const timing = phase === 'delivery' ? 'during delivery' : 'during recovery';
    if (payload.schemaVersion === 1) {
        fail(`PR #${number} delivery receipt changed ${timing}`);
    }
    if (payload.head !== validation.headRefOid) {
        fail(`PR #${number} delivery receipt changed ${timing}`);
    }
    if (payload.bodySha256 !== validation.bodySha256) {
        fail(`PR #${number} delivery receipt changed ${timing}`);
    }
    if ((payload.closingIssue ?? undefined) !== (validation.trackerTarget ?? undefined)) {
        fail(`PR #${number} delivery receipt changed ${timing}`);
    }
}

function expectedDeliveryReceipt(
    pullRequest: PullRequestSnapshot,
    closingIssue: number | undefined,
    ciAdmissionMode: CiAdmissionMode,
    checks: CheckEvidencePort
): DeliveryReceiptPayload {
    return {
        schemaVersion: 2,
        pullRequest: pullRequest.number,
        head: pullRequest.headRefOid,
        bodySha256: bodySha256(pullRequest.body),
        closingIssue,
        ciAdmissionMode,
        ...(ciAdmissionMode === 'advisory' ? { observedCiState: observedAdvisoryCiState(pullRequest, checks) } : {}),
    };
}

function observedAdvisoryCiState(
    pullRequest: Pick<PullRequestSnapshot, 'number' | 'headRefOid'>,
    checks: CheckEvidencePort
): NonNullable<DeliveryReceiptPayload['observedCiState']> {
    try {
        return normalizeObservedCiState(checks.headCheckRuns(pullRequest.number, pullRequest.headRefOid));
    } catch {
        return 'unavailable';
    }
}

const PENDING_CHECK_STATUSES = new Set(['QUEUED', 'IN_PROGRESS', 'PENDING', 'EXPECTED', 'REQUESTED', 'WAITING']);

function normalizeObservedCiState(checkRuns: HeadCheckRun[]): NonNullable<DeliveryReceiptPayload['observedCiState']> {
    if (checkRuns.length === 0) {
        return 'absent';
    }
    const successfulNames = new Set<string>();
    const cancelledNames = new Set<string>();
    let sawSuccess = false;
    let sawSkipped = false;
    let sawPending = false;
    let sawFailed = false;
    let sawMalformed = false;
    for (const check of checkRuns) {
        const state = observedCheckRunState(check);
        if (state === 'successful') {
            sawSuccess = true;
            successfulNames.add(check.name);
            continue;
        }
        if (state === 'skipped') {
            sawSkipped = true;
            continue;
        }
        if (state === 'cancelled') {
            cancelledNames.add(check.name);
            continue;
        }
        if (state === 'pending') {
            sawPending = true;
            continue;
        }
        if (state === 'failed') {
            sawFailed = true;
            continue;
        }
        sawMalformed = true;
    }
    if (sawMalformed) {
        return 'malformed';
    }
    if (sawFailed) {
        return 'failed';
    }
    if (sawPending) {
        return 'pending';
    }
    for (const name of cancelledNames) {
        if (!successfulNames.has(name)) {
            return 'cancelled';
        }
    }
    if (cancelledNames.size > 0) {
        return 'unstable';
    }
    if (sawSuccess) {
        return 'successful';
    }
    return sawSkipped ? 'skipped' : 'absent';
}

function observedCheckRunState(
    check: HeadCheckRun
): 'successful' | 'skipped' | 'failed' | 'pending' | 'cancelled' | 'malformed' {
    if (check.name === '') {
        return 'malformed';
    }
    if (check.status === SETTLED_CHECK_STATUS) {
        if (check.conclusion === PASSING_CONCLUSION) {
            return 'successful';
        }
        if (check.conclusion === 'SKIPPED') {
            return 'skipped';
        }
        if (check.conclusion === SUPERSEDED_CONCLUSION) {
            return 'cancelled';
        }
        if (check.conclusion === null || check.conclusion === '') {
            return 'malformed';
        }
        return 'failed';
    }
    if (check.conclusion !== null) {
        return 'malformed';
    }
    return PENDING_CHECK_STATUSES.has(check.status) ? 'pending' : 'malformed';
}

function sameDeliveryReceiptKey(left: DeliveryReceiptPayload, right: DeliveryReceiptPayload): boolean {
    return (
        left.pullRequest === right.pullRequest &&
        left.head === right.head &&
        left.bodySha256 === right.bodySha256 &&
        left.closingIssue === right.closingIssue
    );
}

function sameExactDeliveryReceipt(left: DeliveryReceiptPayload, right: DeliveryReceiptPayload): boolean {
    if (!sameDeliveryReceiptKey(left, right)) {
        return false;
    }
    if (left.schemaVersion === 1 || right.schemaVersion === 1) {
        return left.schemaVersion === 1 && right.schemaVersion === 1;
    }
    if (left.ciAdmissionMode !== right.ciAdmissionMode) {
        return false;
    }
    if (left.ciAdmissionMode !== 'advisory') {
        return true;
    }
    return left.observedCiState === right.observedCiState;
}

function sameDeliveryReceiptMode(left: DeliveryReceiptPayload, right: DeliveryReceiptPayload): boolean {
    if (!sameDeliveryReceiptKey(left, right)) {
        return false;
    }
    if (left.schemaVersion === 1 || right.schemaVersion === 1) {
        return true;
    }
    return left.ciAdmissionMode === right.ciAdmissionMode;
}

function frozenCurrentDeliveryReceiptPayload(
    number: number,
    receiptBody: string,
    expected: DeliveryReceiptPayload
): DeliveryReceiptPayload {
    const payload = parseDeliveryReceipt(receiptBody);
    if (payload === undefined || payload.schemaVersion === 1 || !sameDeliveryReceiptMode(payload, expected)) {
        fail(`PR #${number} delivery receipt changed during delivery`);
    }
    return payload;
}

function deliveryReceiptKey(payload: DeliveryReceiptPayload): string {
    return [payload.pullRequest, payload.head, payload.bodySha256, payload.closingIssue ?? 'none'].join(':');
}

function assertCompatibleDeliveryReceiptLineage(
    lineage: DeliveryReceiptComment[],
    pullRequest: Pick<PullRequestSnapshot, 'number' | 'headRefOid'>
): void {
    const seenV2ByKey = new Map<string, DeliveryReceiptPayload>();
    for (const comment of lineage) {
        const payload = assertDeliveryReceiptForHead(comment, pullRequest);
        if (payload.schemaVersion === 1) {
            continue;
        }
        const key = deliveryReceiptKey(payload);
        const previous = seenV2ByKey.get(key);
        if (previous !== undefined && !sameDeliveryReceiptMode(previous, payload)) {
            fail(`PR #${pullRequest.number} has an invalid delivery receipt lineage`);
        }
        seenV2ByKey.set(key, payload);
    }
}

function assertExpectedDeliveryReceiptAuthority(
    lineage: DeliveryReceiptComment[],
    expected: DeliveryReceiptPayload,
    pullRequest: Pick<PullRequestSnapshot, 'number' | 'headRefOid'>
): void {
    if (expected.schemaVersion === 1) {
        return;
    }
    for (const comment of lineage) {
        const payload = assertDeliveryReceiptForHead(comment, pullRequest);
        if (!sameDeliveryReceiptKey(payload, expected) || payload.schemaVersion === 1) {
            continue;
        }
        if (!sameDeliveryReceiptMode(payload, expected)) {
            fail(`PR #${pullRequest.number} has an invalid delivery receipt lineage`);
        }
    }
}

function authoritativeEquivalentDeliveryReceipt(
    lineage: DeliveryReceiptComment[],
    expected: DeliveryReceiptPayload,
    pullRequest: Pick<PullRequestSnapshot, 'number' | 'headRefOid'>
): DeliveryReceiptComment | undefined {
    assertExpectedDeliveryReceiptAuthority(lineage, expected, pullRequest);
    if (
        !lineage.some((receipt) => sameDeliveryReceiptKey(assertDeliveryReceiptForHead(receipt, pullRequest), expected))
    ) {
        return undefined;
    }
    const newest = lineage.at(-1);
    if (newest === undefined) {
        return undefined;
    }
    if (sameExactDeliveryReceipt(assertDeliveryReceiptForHead(newest, pullRequest), expected)) {
        return newest;
    }
    return undefined;
}

function deliveryReceiptsForHead(
    comments: DeliveryReceiptComment[],
    pullRequest: Pick<PullRequestSnapshot, 'number' | 'headRefOid'>
): DeliveryReceiptComment[] {
    const candidates: DeliveryReceiptComment[] = [];
    for (const comment of comments) {
        if (!isAuthorBotNodeId(comment.authorNodeId)) {
            continue;
        }
        const payload = parseDeliveryReceipt(comment.body);
        if (payload === undefined) {
            continue;
        }
        assertOwnedDeliveryReceipt(comment, payload, pullRequest.number);
        if (payload.head === pullRequest.headRefOid) {
            candidates.push(comment);
        }
    }
    return candidates;
}

function orderedDeliveryReceiptLineage(
    comments: DeliveryReceiptComment[],
    pullRequest: Pick<PullRequestSnapshot, 'number' | 'headRefOid'>
): DeliveryReceiptComment[] {
    const ordered = deliveryReceiptsForHead(comments, pullRequest);
    assertCompatibleDeliveryReceiptLineage(ordered, pullRequest);
    return ordered;
}

function assertOwnedDeliveryReceipt(
    comment: DeliveryReceiptComment,
    payload: DeliveryReceiptPayload,
    pullRequestNumber: number
): void {
    if (
        comment.id === '' ||
        !isAuthorBotNodeId(comment.authorNodeId) ||
        comment.authorType !== 'Bot' ||
        comment.createdAt === '' ||
        !Number.isFinite(Date.parse(comment.createdAt)) ||
        comment.createdAt !== comment.updatedAt ||
        payload.pullRequest !== pullRequestNumber
    ) {
        fail(`PR #${pullRequestNumber} has an invalid delivery receipt`);
    }
}

function assertDeliveryReceiptForHead(
    comment: DeliveryReceiptComment,
    pullRequest: Pick<PullRequestSnapshot, 'number' | 'headRefOid'>
): DeliveryReceiptPayload {
    const payload = parseDeliveryReceipt(comment.body);
    if (payload === undefined) {
        fail(`PR #${pullRequest.number} has an invalid delivery receipt`);
    }
    assertOwnedDeliveryReceipt(comment, payload, pullRequest.number);
    if (payload.head !== pullRequest.headRefOid) {
        fail(`PR #${pullRequest.number} has an invalid delivery receipt`);
    }
    return payload;
}

function assertCanonicalDeliveryReceipt(
    comment: DeliveryReceiptComment,
    pullRequest: Pick<PullRequestSnapshot, 'number' | 'headRefOid'>,
    expected: DeliveryReceiptPayload
): DeliveryReceiptPayload {
    const payload = assertDeliveryReceiptForHead(comment, pullRequest);
    if (!sameExactDeliveryReceipt(payload, expected)) {
        fail(`PR #${pullRequest.number} has an invalid delivery receipt`);
    }
    return payload;
}

function deliveryReceiptAuthorityPhaseRank(phase: DeliveryReceiptAuthorityPhase): number {
    if (phase === 'released') {
        return -1;
    }
    if (phase === 'prepared') {
        return 0;
    }
    if (phase === 'merge-authorized') {
        return 1;
    }
    return 2;
}

function samePreparedPostMergeValidation(
    left: PersistedPreparedPostMergeValidation | undefined,
    right: PersistedPreparedPostMergeValidation | undefined
): boolean {
    return (
        left?.headRefOid === right?.headRefOid &&
        left?.headRefName === right?.headRefName &&
        left?.baseRefName === right?.baseRefName &&
        left?.title === right?.title &&
        left?.bodySha256 === right?.bodySha256 &&
        left?.trackerTarget === right?.trackerTarget
    );
}

function samePersistedDeliveryReceiptAuthority(
    left: PersistedDeliveryReceiptAuthority | undefined,
    right: PersistedDeliveryReceiptAuthority
): boolean {
    if (left?.phase === 'legacy' || right.phase === 'legacy') {
        return left?.phase === right.phase && left?.receiptId === right.receiptId;
    }
    return (
        left?.phase === right.phase &&
        left?.receiptId === right.receiptId &&
        left?.receiptBody === right.receiptBody &&
        samePreparedPostMergeValidation(
            left?.phase !== 'released' ? left.postMergeValidation : undefined,
            right.phase !== 'released' ? right.postMergeValidation : undefined
        )
    );
}

export function expectedAbsentDeliveryReceiptAuthority(): DeliveryReceiptAuthorityExpectation {
    return { mode: 'absent' };
}

function exactDeliveryReceiptAuthorityExpectation(
    authority: PersistedDeliveryReceiptAuthority | undefined
): DeliveryReceiptAuthorityExpectation {
    if (authority === undefined) {
        return expectedAbsentDeliveryReceiptAuthority();
    }
    return { mode: 'present', authority };
}

function matchesDeliveryReceiptAuthorityExpectation(
    current: PersistedDeliveryReceiptAuthority | undefined,
    expected: DeliveryReceiptAuthorityExpectation
): boolean {
    if (expected.mode === 'absent') {
        return current === undefined;
    }
    return samePersistedDeliveryReceiptAuthority(current, expected.authority);
}

function mergePersistedDeliveryReceiptAuthority(
    current: PersistedDeliveryReceiptAuthority,
    next: CurrentPersistedDeliveryReceiptAuthority
): PersistedDeliveryReceiptAuthority {
    if (current.phase === 'legacy') {
        return next;
    }
    if (current.receiptId !== next.receiptId) {
        return next;
    }
    const currentRank = deliveryReceiptAuthorityPhaseRank(current.phase);
    const nextRank = deliveryReceiptAuthorityPhaseRank(next.phase);
    if (currentRank > nextRank) {
        return current;
    }
    if (nextRank > currentRank) {
        return next;
    }
    const receiptBody = next.receiptBody ?? current.receiptBody;
    let postMergeValidation: PersistedPreparedPostMergeValidation | undefined;
    if (current.phase !== 'released' && next.phase !== 'released') {
        postMergeValidation = next.postMergeValidation ?? current.postMergeValidation;
    }
    if (current.phase === 'released' && next.phase === 'released') {
        return {
            phase: 'released',
            receiptId: current.receiptId,
            ...(receiptBody === undefined ? {} : { receiptBody }),
        };
    }
    if (current.phase === 'prepared' && next.phase === 'prepared') {
        return {
            phase: 'prepared',
            receiptId: current.receiptId,
            ...(receiptBody === undefined ? {} : { receiptBody }),
            ...(postMergeValidation === undefined ? {} : { postMergeValidation }),
        };
    }
    return {
        phase: next.phase,
        receiptId: current.receiptId,
        ...(receiptBody === undefined ? {} : { receiptBody }),
        ...(postMergeValidation === undefined ? {} : { postMergeValidation }),
    };
}

function persistDeliveryReceiptAuthority(
    number: number,
    authority: PersistedDeliveryReceiptAuthority,
    port: DeliveryPort
): void {
    if (!isCurrentPersistedDeliveryReceiptAuthority(authority)) {
        fail(`PR #${number} delivery receipt authority is malformed`);
    }
    const current = port.readDeliveryReceiptAuthority(number);
    if (isFrozenPersistedDeliveryReceiptAuthority(current)) {
        assertFrozenPersistedDeliveryReceiptAuthority(number, current, authority);
    }
    const next = current === undefined ? authority : mergePersistedDeliveryReceiptAuthority(current, authority);
    if (samePersistedDeliveryReceiptAuthority(current, next)) {
        return;
    }
    port.writeDeliveryReceiptAuthority(number, next, exactDeliveryReceiptAuthorityExpectation(current));
}

function persistPreparedDeliveryReceiptAuthority(
    number: number,
    receipt: Pick<DeliveryReceiptComment, 'id' | 'body'>,
    port: DeliveryPort,
    postMergeValidation?: PersistedPreparedPostMergeValidation
): void {
    persistDeliveryReceiptAuthority(
        number,
        {
            phase: 'prepared',
            receiptId: receipt.id,
            receiptBody: receipt.body,
            ...(postMergeValidation === undefined ? {} : { postMergeValidation }),
        },
        port
    );
}

function releasedDeliveryReceiptAuthority(
    authority: Pick<CurrentPersistedDeliveryReceiptAuthority, 'receiptId' | 'receiptBody'>
): CurrentPersistedReleasedDeliveryReceiptAuthority {
    return {
        phase: 'released',
        receiptId: authority.receiptId,
        ...(authority.receiptBody === undefined ? {} : { receiptBody: authority.receiptBody }),
    };
}

function preparedDeliveryReceiptAuthority(
    receipt: Pick<DeliveryReceiptComment, 'id' | 'body'>,
    postMergeValidation?: PersistedPreparedPostMergeValidation
): CurrentPersistedPreparedDeliveryReceiptAuthority {
    return {
        phase: 'prepared',
        receiptId: receipt.id,
        receiptBody: receipt.body,
        ...(postMergeValidation === undefined ? {} : { postMergeValidation }),
    };
}

function restorePreArmedDeliveryReceiptAuthority(
    number: number,
    beforeArming: PersistedDeliveryReceiptAuthority | undefined,
    armed: CurrentPersistedPreparedDeliveryReceiptAuthority,
    port: DeliveryPort
): void {
    const current = port.readDeliveryReceiptAuthority(number);
    if (!samePersistedDeliveryReceiptAuthority(current, armed)) {
        return;
    }
    if (beforeArming === undefined || beforeArming.phase === 'legacy') {
        port.clearDeliveryReceiptAuthority(number, exactDeliveryReceiptAuthorityExpectation(current));
        return;
    }
    if (samePersistedDeliveryReceiptAuthority(current, beforeArming)) {
        return;
    }
    port.writeDeliveryReceiptAuthority(number, beforeArming, exactDeliveryReceiptAuthorityExpectation(current));
}

function replacePersistedDeliveryReceiptAuthorityIfUnchanged(
    number: number,
    expectedCurrent: CurrentPersistedDeliveryReceiptAuthority,
    next: CurrentPersistedDeliveryReceiptAuthority,
    port: DeliveryPort
): void {
    if (samePersistedDeliveryReceiptAuthority(expectedCurrent, next)) {
        return;
    }
    port.writeDeliveryReceiptAuthority(number, next, exactDeliveryReceiptAuthorityExpectation(expectedCurrent));
}

function frozenDeliveryReceiptAuthorityHead(
    number: number,
    authority: CurrentPersistedDeliveryReceiptAuthority
): string | undefined {
    if (authority.phase === 'prepared' && authority.postMergeValidation !== undefined) {
        return authority.postMergeValidation.headRefOid;
    }
    if (authority.receiptBody === undefined) {
        return undefined;
    }
    const payload = parseDeliveryReceipt(authority.receiptBody);
    if (payload === undefined || payload.schemaVersion === 1) {
        fail(`PR #${number} delivery receipt authority cannot be proven`);
    }
    return payload.head;
}

function samePreparedDeliveryInputsForOpenRetry(
    pullRequest: PullRequestSnapshot,
    authority: CurrentPersistedPreparedDeliveryReceiptAuthority
): boolean {
    if (authority.postMergeValidation === undefined) {
        return false;
    }
    return samePreparedPostMergeValidation(
        authority.postMergeValidation,
        persistedPreparedPostMergeValidation(pullRequest, trackerCompletionTarget(pullRequest))
    );
}

function releaseStaleFrozenDeliveryReceiptAuthorityBeforeOpenRetry(
    pullRequest: PullRequestSnapshot,
    port: DeliveryPort
): void {
    const current = port.readDeliveryReceiptAuthority(pullRequest.number);
    if (!isFrozenPersistedDeliveryReceiptAuthority(current)) {
        return;
    }
    if (current.phase === 'prepared' && current.postMergeValidation !== undefined) {
        if (samePreparedDeliveryInputsForOpenRetry(pullRequest, current)) {
            return;
        }
        replacePersistedDeliveryReceiptAuthorityIfUnchanged(
            pullRequest.number,
            current,
            releasedDeliveryReceiptAuthority(current),
            port
        );
        return;
    }
    const frozenHead = frozenDeliveryReceiptAuthorityHead(pullRequest.number, current);
    if (frozenHead === undefined || frozenHead === pullRequest.headRefOid) {
        return;
    }
    replacePersistedDeliveryReceiptAuthorityIfUnchanged(
        pullRequest.number,
        current,
        releasedDeliveryReceiptAuthority(current),
        port
    );
}

function shouldRestorePreArmedDeliveryReceiptAuthorityAfterFinalObservation(pullRequest: PullRequestSnapshot): boolean {
    return pullRequest.state === 'CLOSED' || (pullRequest.state === 'OPEN' && pullRequest.mergeable !== 'UNKNOWN');
}

function restoreDeliveryReceiptAuthorityBeforeClosedRetry(number: number, port: DeliveryPort): void {
    const current = port.readDeliveryReceiptAuthority(number);
    if (current?.phase === 'legacy') {
        persistDeliveryReceiptAuthority(number, { phase: 'released', receiptId: current.receiptId }, port);
        return;
    }
    if (current?.phase !== 'prepared' || current.postMergeValidation === undefined) {
        return;
    }
    const beforeArming = releasedDeliveryReceiptAuthority(current);
    restorePreArmedDeliveryReceiptAuthority(number, beforeArming, current, port);
}

function withRestorablePreArmedDeliveryReceiptAuthority<Result>(
    number: number,
    beforeArming: PersistedDeliveryReceiptAuthority | undefined,
    armed: CurrentPersistedPreparedDeliveryReceiptAuthority,
    port: DeliveryPort,
    shouldRestore: () => boolean,
    run: () => Result
): Result {
    try {
        return run();
    } catch (error) {
        if (shouldRestore()) {
            restorePreArmedDeliveryReceiptAuthority(number, beforeArming, armed, port);
        }
        throw error;
    }
}

function resolveFinalSnapshotWithRestorablePreparedAuthority(
    number: number,
    beforeArming: PersistedDeliveryReceiptAuthority | undefined,
    armed: CurrentPersistedPreparedDeliveryReceiptAuthority,
    port: DeliveryPort
): PullRequestSnapshot {
    let latestDefinitiveUnmerged: PullRequestSnapshot | undefined;
    let sawFinalSnapshot = false;

    try {
        port.fetch();
        const initial = port.pullRequest(number);
        sawFinalSnapshot = true;
        if (shouldRestorePreArmedDeliveryReceiptAuthorityAfterFinalObservation(initial)) {
            latestDefinitiveUnmerged = initial;
        }
        const finalSnapshot = refreshStructuralMergeability(initial, port, (pullRequest) => {
            if (shouldRestorePreArmedDeliveryReceiptAuthorityAfterFinalObservation(pullRequest)) {
                latestDefinitiveUnmerged = pullRequest;
            }
        });
        if (finalSnapshot.state !== 'MERGED') {
            validateStructuralMergeability(finalSnapshot);
        }
        return finalSnapshot;
    } catch (error) {
        if (!sawFinalSnapshot) {
            try {
                const recovered = resolveStructuralMergeability(port.pullRequest(number), port);
                if (shouldRestorePreArmedDeliveryReceiptAuthorityAfterFinalObservation(recovered)) {
                    latestDefinitiveUnmerged = recovered;
                }
            } catch {
                // Preserve the armed authority when the post-merge state remains unreadable.
            }
        }
        if (latestDefinitiveUnmerged !== undefined) {
            restorePreArmedDeliveryReceiptAuthority(number, beforeArming, armed, port);
        }
        throw error;
    }
}

function tryRestorePreArmedDeliveryReceiptAuthorityAfterMergeFailure(
    number: number,
    beforeArming: PersistedDeliveryReceiptAuthority | undefined,
    armed: CurrentPersistedPreparedDeliveryReceiptAuthority,
    port: DeliveryPort
): void {
    let latestObserved: PullRequestSnapshot | undefined;
    try {
        port.fetch();
        const raw = port.pullRequest(number);
        latestObserved = raw;
        if (raw.state === 'MERGED') {
            return;
        }
        if (raw.state === 'CLOSED') {
            restorePreArmedDeliveryReceiptAuthority(number, beforeArming, armed, port);
            return;
        }
        if (raw.state !== 'OPEN') {
            return;
        }
        const current = refreshStructuralMergeability(raw, port, (pullRequest) => {
            latestObserved = pullRequest;
        });
        latestObserved = current;
        if (current.state === 'MERGED') {
            return;
        }
        if (current.state === 'OPEN' && current.mergeable === 'CONFLICTING') {
            restorePreArmedDeliveryReceiptAuthority(number, beforeArming, armed, port);
            return;
        }
        if (current.state !== 'OPEN' && current.state !== 'CLOSED') {
            return;
        }
    } catch {
        if (
            latestObserved !== undefined &&
            shouldRestorePreArmedDeliveryReceiptAuthorityAfterFinalObservation(latestObserved)
        ) {
            restorePreArmedDeliveryReceiptAuthority(number, beforeArming, armed, port);
        }
        return;
    }
    if (
        latestObserved !== undefined &&
        shouldRestorePreArmedDeliveryReceiptAuthorityAfterFinalObservation(latestObserved)
    ) {
        restorePreArmedDeliveryReceiptAuthority(number, beforeArming, armed, port);
    }
}

function persistMergeAuthorizedDeliveryReceiptAuthority(
    number: number,
    receipt: Pick<DeliveryReceiptComment, 'id' | 'body'>,
    postMergeValidation: PersistedPreparedPostMergeValidation | undefined,
    port: DeliveryPort
): void {
    persistDeliveryReceiptAuthority(
        number,
        {
            phase: 'merge-authorized',
            receiptId: receipt.id,
            receiptBody: receipt.body,
            ...(postMergeValidation === undefined ? {} : { postMergeValidation }),
        },
        port
    );
}

function persistTerminalDeliveryReceiptAuthority(
    number: number,
    receipt: Pick<DeliveryReceiptComment, 'id' | 'body'>,
    postMergeValidation: PersistedPreparedPostMergeValidation | undefined,
    port: DeliveryPort
): void {
    persistDeliveryReceiptAuthority(
        number,
        {
            phase: 'terminal',
            receiptId: receipt.id,
            receiptBody: receipt.body,
            ...(postMergeValidation === undefined ? {} : { postMergeValidation }),
        },
        port
    );
}

function readExactDeliveryReceipt(
    pullRequest: PullRequestSnapshot,
    port: DeliveryPort,
    expectedReceiptId: string
): DeliveryReceiptComment {
    const lineage = orderedDeliveryReceiptLineage(port.deliveryReceipts(pullRequest.number), pullRequest);
    const receipt = lineage.find((comment) => comment.id === expectedReceiptId);
    if (receipt === undefined) {
        fail(`PR #${pullRequest.number} delivery receipt changed during recovery`);
    }
    assertDeliveryReceiptForHead(receipt, pullRequest);
    return receipt;
}

function readStableExactDeliveryReceipt(
    pullRequest: PullRequestSnapshot,
    port: DeliveryPort,
    expectedReceiptId: string
): DeliveryReceiptComment {
    const firstLineage = orderedDeliveryReceiptLineage(provenDeliveryReceiptComments(pullRequest, port), pullRequest);
    const first = firstLineage.find((comment) => comment.id === expectedReceiptId);
    const secondLineage = orderedDeliveryReceiptLineage(provenDeliveryReceiptComments(pullRequest, port), pullRequest);
    const second = secondLineage.find((comment) => comment.id === expectedReceiptId);
    if (first === undefined || second === undefined) {
        fail(`PR #${pullRequest.number} delivery receipt changed during delivery`);
    }
    if (first.id !== second.id) {
        fail(`PR #${pullRequest.number} delivery receipt changed during delivery`);
    }
    assertDeliveryReceiptForHead(second, pullRequest);
    return second;
}

function readStableExactMergedRecoveryReceipt(
    pullRequest: PullRequestSnapshot,
    port: DeliveryPort,
    expectedReceiptId: string,
    validate: (
        lineage: DeliveryReceiptComment[],
        receipt: DeliveryReceiptComment,
        payload: DeliveryReceiptPayload
    ) => void
): DeliveryReceiptComment {
    const read = () => {
        const lineage = orderedDeliveryReceiptLineage(provenDeliveryReceiptComments(pullRequest, port), pullRequest);
        const receipt = lineage.find((comment) => comment.id === expectedReceiptId);
        if (receipt === undefined) {
            fail(`PR #${pullRequest.number} delivery receipt changed during recovery`);
        }
        const payload = assertDeliveryReceiptForHead(receipt, pullRequest);
        validate(lineage, receipt, payload);
        return receipt;
    };
    const first = read();
    const second = read();
    if (first.id !== second.id || first.body !== second.body) {
        fail(`PR #${pullRequest.number} delivery receipt changed during recovery`);
    }
    return second;
}

function assertCompleteDeliveryReceiptProof(
    number: number,
    comments: DeliveryReceiptComment[],
    proof: DeliveryReceiptProof
): void {
    if (!Array.isArray(proof.commentIds) || proof.commentIds.some((commentId) => typeof commentId !== 'string')) {
        fail(`PR #${number} delivery receipt authority cannot be proven`);
    }
    if (new Set(proof.commentIds).size !== proof.commentIds.length) {
        fail(`PR #${number} delivery receipt authority cannot be proven`);
    }
    if (
        !Array.isArray(proof.editedCommentIds) ||
        proof.editedCommentIds.some((commentId) => typeof commentId !== 'string') ||
        new Set(proof.editedCommentIds).size !== proof.editedCommentIds.length
    ) {
        fail(`PR #${number} delivery receipt authority cannot be proven`);
    }
    if (proof.commentIds.length !== proof.totalCount) {
        fail(`PR #${number} delivery receipt authority cannot be proven`);
    }
    if (comments.length !== proof.totalCount) {
        fail(`PR #${number} delivery receipt authority cannot be proven`);
    }
    const commentIdSet = new Set(proof.commentIds);
    const editedCommentIds = new Set(proof.editedCommentIds);
    for (const editedCommentId of editedCommentIds) {
        if (!commentIdSet.has(editedCommentId)) {
            fail(`PR #${number} delivery receipt authority cannot be proven`);
        }
    }
    if (proof.totalCount === 0) {
        if (proof.latestCommentId !== undefined || proof.commentIds.length > 0 || proof.editedCommentIds.length > 0) {
            fail(`PR #${number} delivery receipt authority cannot be proven`);
        }
        return;
    }
    if (proof.latestCommentId !== undefined && !commentIdSet.has(proof.latestCommentId)) {
        fail(`PR #${number} delivery receipt authority cannot be proven`);
    }
    const restCommentIds = comments.map((comment) => comment.id);
    for (const commentId of restCommentIds) {
        if (!commentIdSet.has(commentId)) {
            fail(`PR #${number} delivery receipt authority cannot be proven`);
        }
    }
    for (let index = 0; index < comments.length; index += 1) {
        const comment = comments[index];
        if (
            comment !== undefined &&
            editedCommentIds.has(comment.id) &&
            isAuthorBotNodeId(comment.authorNodeId) &&
            comment.authorType === 'Bot'
        ) {
            fail(`PR #${number} delivery receipt authority cannot be proven`);
        }
    }
}

function provenDeliveryReceiptComments(
    pullRequest: Pick<PullRequestSnapshot, 'number'>,
    port: DeliveryPort
): DeliveryReceiptComment[] {
    const comments = port.deliveryReceipts(pullRequest.number);
    assertCompleteDeliveryReceiptProof(pullRequest.number, comments, port.deliveryReceiptProof(pullRequest.number));
    for (const comment of comments) {
        if (
            isAuthorBotNodeId(comment.authorNodeId) &&
            comment.authorType === 'Bot' &&
            comment.createdAt !== comment.updatedAt
        ) {
            fail(`PR #${pullRequest.number} delivery receipt authority cannot be proven`);
        }
    }
    return comments;
}

function newestCanonicalDeliveryReceiptForKey(
    lineage: DeliveryReceiptComment[],
    key: string,
    pullRequest: Pick<PullRequestSnapshot, 'number' | 'headRefOid'>
): DeliveryReceiptComment {
    for (let index = lineage.length - 1; index >= 0; index -= 1) {
        const comment = lineage[index];
        if (comment === undefined) {
            continue;
        }
        const payload = assertDeliveryReceiptForHead(comment, pullRequest);
        if (deliveryReceiptKey(payload) !== key) {
            continue;
        }
        return comment;
    }
    fail(`PR #${pullRequest.number} delivery receipt authority cannot be proven`);
    throw new Error('unreachable');
}

function newestLogicalDeliveryReceiptAuthority(
    lineage: DeliveryReceiptComment[],
    pullRequest: Pick<PullRequestSnapshot, 'number' | 'headRefOid'>
): DeliveryReceiptComment {
    const newest = lineage.at(-1);
    if (newest === undefined) {
        fail(`PR #${pullRequest.number} delivery receipt authority cannot be proven`);
    }
    const payload = assertDeliveryReceiptForHead(newest, pullRequest);
    return newestCanonicalDeliveryReceiptForKey(lineage, deliveryReceiptKey(payload), pullRequest);
}

function readStrictStableEquivalentDeliveryReceipt(
    pullRequest: PullRequestSnapshot,
    port: DeliveryPort,
    expected: DeliveryReceiptPayload
): DeliveryReceiptComment | undefined {
    const firstLineage = orderedDeliveryReceiptLineage(provenDeliveryReceiptComments(pullRequest, port), pullRequest);
    const first = authoritativeEquivalentDeliveryReceipt(firstLineage, expected, pullRequest);
    const secondLineage = orderedDeliveryReceiptLineage(provenDeliveryReceiptComments(pullRequest, port), pullRequest);
    const second = authoritativeEquivalentDeliveryReceipt(secondLineage, expected, pullRequest);
    if (first === undefined || second === undefined) {
        if (first === undefined && second === undefined) {
            return undefined;
        }
        fail(`PR #${pullRequest.number} delivery receipt changed during delivery`);
    }
    if (first.id !== second.id) {
        fail(`PR #${pullRequest.number} delivery receipt changed during delivery`);
    }
    return second;
}

function tryStableHistoricalDeliveryReceipt(
    pullRequest: PullRequestSnapshot,
    port: DeliveryPort,
    expected: DeliveryReceiptPayload
): DeliveryReceiptComment | undefined {
    try {
        return readStrictStableEquivalentDeliveryReceipt(pullRequest, port, expected);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (
            /delivery receipt authority cannot be proven/u.test(detail) ||
            /delivery receipt changed during delivery/u.test(detail)
        ) {
            return undefined;
        }
        throw error;
    }
}

function compatibleBodylessPersistedMergedRecoveryReceipt(
    lineage: DeliveryReceiptComment[],
    authority: CurrentPersistedDeliveryReceiptAuthority,
    pullRequest: Pick<PullRequestSnapshot, 'number' | 'headRefOid'>
): DeliveryReceiptComment {
    const stored = lineage.find((receipt) => receipt.id === authority.receiptId);
    if (stored === undefined) {
        fail(`PR #${pullRequest.number} delivery receipt changed during recovery`);
    }
    const storedPayload = assertDeliveryReceiptForHead(stored, pullRequest);
    if (storedPayload.schemaVersion === 1) {
        fail(`PR #${pullRequest.number} delivery receipt changed during recovery`);
    }
    if (authority.phase !== 'released') {
        const validation = authority.postMergeValidation;
        if (validation === undefined) {
            fail(`PR #${pullRequest.number} delivery receipt authority cannot be proven`);
        }
        validateReceiptPayloadAgainstPreparedPostMergeValidation(
            pullRequest.number,
            storedPayload,
            validation,
            'recovery'
        );
    }
    const authoritative = newestLogicalDeliveryReceiptAuthority(lineage, pullRequest);
    const authoritativePayload = assertDeliveryReceiptForHead(authoritative, pullRequest);
    if (
        !sameDeliveryReceiptKey(storedPayload, authoritativePayload) ||
        !sameDeliveryReceiptMode(storedPayload, authoritativePayload)
    ) {
        fail(`PR #${pullRequest.number} delivery receipt changed during recovery`);
    }
    return stored;
}

function validateLegacyPersistedMergedRecoveryReceipt(
    pullRequest: PullRequestSnapshot,
    payload: DeliveryReceiptPayload
): void {
    if (payload.schemaVersion !== 1) {
        fail(`PR #${pullRequest.number} delivery receipt changed during recovery`);
    }
    if (payload.bodySha256 !== bodySha256(pullRequest.body)) {
        fail(`PR #${pullRequest.number} delivery receipt changed during recovery`);
    }
    if ((payload.closingIssue ?? undefined) !== trackerCompletionTarget(pullRequest)) {
        fail(`PR #${pullRequest.number} delivery receipt changed during recovery`);
    }
}

function readCompatibleBodylessPersistedMergedRecoveryReceipt(
    pullRequest: PullRequestSnapshot,
    port: DeliveryPort,
    authority: CurrentPersistedDeliveryReceiptAuthority
): DeliveryReceiptComment {
    return readStableExactMergedRecoveryReceipt(
        pullRequest,
        port,
        authority.receiptId,
        (lineage, _receipt, _payload) => {
            compatibleBodylessPersistedMergedRecoveryReceipt(lineage, authority, pullRequest);
        }
    );
}

function readPersistedMergedRecoveryReceipt(
    pullRequest: PullRequestSnapshot,
    port: DeliveryPort,
    authority: PersistedDeliveryReceiptAuthority
): DeliveryReceiptComment {
    if (authority.phase === 'legacy') {
        return readStableExactMergedRecoveryReceipt(
            pullRequest,
            port,
            authority.receiptId,
            (_lineage, _receipt, payload) => validateLegacyPersistedMergedRecoveryReceipt(pullRequest, payload)
        );
    }
    if (authority.phase === 'released') {
        fail(`PR #${pullRequest.number} delivery receipt authority cannot be proven`);
    }
    if (authority.postMergeValidation === undefined) {
        fail(`PR #${pullRequest.number} delivery receipt authority cannot be proven`);
    }
    const preparedPostMergeValidation = authority.postMergeValidation;
    validatePostMergeSnapshot(preparedPostMergeValidation, pullRequest, pullRequest.number);
    if (authority.receiptBody === undefined) {
        return readCompatibleBodylessPersistedMergedRecoveryReceipt(pullRequest, port, authority);
    }
    const receipt = readStableExactMergedRecoveryReceipt(pullRequest, port, authority.receiptId, () => undefined);
    if (receipt.body !== authority.receiptBody) {
        fail(`PR #${pullRequest.number} delivery receipt changed during recovery`);
    }
    if (preparedPostMergeValidation !== undefined) {
        const payload = assertDeliveryReceiptForHead(receipt, pullRequest);
        if (payload.schemaVersion === 1) {
            validateLegacyPersistedMergedRecoveryReceipt(pullRequest, payload);
            return receipt;
        }
        validateReceiptPayloadAgainstPreparedPostMergeValidation(
            pullRequest.number,
            payload,
            preparedPostMergeValidation,
            'recovery'
        );
    }
    return receipt;
}

function validateStableDeliveryReceipt(
    number: number,
    expected: DeliveryReceiptPayload,
    recovered: DeliveryReceiptPayload
): void {
    if (!sameExactDeliveryReceipt(expected, recovered)) {
        fail(`PR #${number} delivery receipt changed during delivery`);
    }
}

function ensureDeliveryReceipt(
    pullRequest: PullRequestSnapshot,
    closingIssue: number | undefined,
    port: DeliveryPort,
    ciAdmissionMode: CiAdmissionMode
): DeliveryReceiptComment {
    const expected = expectedDeliveryReceipt(pullRequest, closingIssue, ciAdmissionMode, port);
    const expectedBody = composeDeliveryReceipt(expected);
    const persistedAuthority = port.readDeliveryReceiptAuthority(pullRequest.number);
    const currentPersistedAuthority =
        persistedAuthority !== undefined && isCurrentPersistedDeliveryReceiptAuthority(persistedAuthority)
            ? persistedAuthority
            : undefined;
    const frozenAuthority = isFrozenPersistedDeliveryReceiptAuthority(currentPersistedAuthority)
        ? currentPersistedAuthority
        : undefined;
    let receipt: DeliveryReceiptComment | undefined;
    let expectedReceipt = expected;
    if (frozenAuthority !== undefined) {
        if (frozenAuthority.receiptBody === undefined) {
            fail(`PR #${pullRequest.number} delivery receipt authority cannot be proven`);
        }
        expectedReceipt = frozenCurrentDeliveryReceiptPayload(
            pullRequest.number,
            frozenAuthority.receiptBody,
            expected
        );
        try {
            receipt = readStableExactDeliveryReceipt(pullRequest, port, frozenAuthority.receiptId);
        } catch {
            fail(`PR #${pullRequest.number} delivery receipt changed during delivery`);
        }
        if (receipt.body !== frozenAuthority.receiptBody) {
            fail(`PR #${pullRequest.number} delivery receipt changed during delivery`);
        }
        if (frozenAuthority.phase === 'prepared' && frozenAuthority.postMergeValidation !== undefined) {
            validateReceiptPayloadAgainstPreparedPostMergeValidation(
                pullRequest.number,
                expectedReceipt,
                frozenAuthority.postMergeValidation,
                'delivery'
            );
        }
        assertCanonicalDeliveryReceipt(receipt, pullRequest, expectedReceipt);
    }
    const existing =
        receipt === undefined
            ? orderedDeliveryReceiptLineage(port.deliveryReceipts(pullRequest.number), pullRequest)
            : [];
    const knownReceiptIds = new Set(existing.map((existingReceipt) => existingReceipt.id));
    const historical = authoritativeEquivalentDeliveryReceipt(existing, expected, pullRequest);
    if (receipt === undefined) {
        receipt =
            historical === undefined ? undefined : tryStableHistoricalDeliveryReceipt(pullRequest, port, expected);
    }
    if (
        receipt === undefined &&
        currentPersistedAuthority?.phase !== 'released' &&
        currentPersistedAuthority?.receiptBody === expectedBody
    ) {
        try {
            receipt = readExactDeliveryReceipt(pullRequest, port, currentPersistedAuthority.receiptId);
        } catch {
            fail(`PR #${pullRequest.number} delivery receipt was not durably verified`);
        }
    }
    if (receipt === undefined) {
        try {
            receipt = port.addDeliveryReceipt(pullRequest.number, expectedBody);
        } catch (error) {
            let recovered: DeliveryReceiptComment | undefined;
            try {
                recovered = readStrictStableEquivalentDeliveryReceipt(pullRequest, port, expected);
            } catch {
                throw error;
            }
            if (recovered === undefined || knownReceiptIds.has(recovered.id)) {
                throw error;
            }
            receipt = recovered;
        }
    }
    if (receipt === undefined) {
        fail(`PR #${pullRequest.number} delivery receipt was not durably verified`);
    }
    const receiptPayload = assertCanonicalDeliveryReceipt(receipt, pullRequest, expectedReceipt);
    persistPreparedDeliveryReceiptAuthority(pullRequest.number, receipt, port);
    let verified: DeliveryReceiptComment | undefined;
    try {
        verified =
            frozenAuthority === undefined
                ? readStrictStableEquivalentDeliveryReceipt(pullRequest, port, expectedReceipt)
                : readStableExactDeliveryReceipt(pullRequest, port, receipt.id);
    } catch {
        fail(`PR #${pullRequest.number} delivery receipt was not durably verified`);
    }
    if (
        verified === undefined ||
        verified.id !== receipt.id ||
        verified.body !== receipt.body ||
        !sameExactDeliveryReceipt(assertDeliveryReceiptForHead(verified, pullRequest), expectedReceipt)
    ) {
        fail(`PR #${pullRequest.number} delivery receipt was not durably verified`);
    }
    assertCanonicalDeliveryReceipt(verified, pullRequest, receiptPayload);
    return verified;
}

function validateDependent(current: PullRequestSnapshot, expected: StackedPullRequest): void {
    if (
        current.state !== 'OPEN' ||
        current.headRefOid !== expected.headRefOid ||
        current.headRefName !== expected.headRefName ||
        current.baseRefName !== expected.baseRefName
    ) {
        fail(`stacked PR #${expected.number} changed during delivery`);
    }
}

function validateDependentSet(before: StackedPullRequest[], after: StackedPullRequest[]): void {
    const beforeByNumber = new Map(before.map((dependent) => [dependent.number, dependent]));
    const afterByNumber = new Map(after.map((dependent) => [dependent.number, dependent]));
    if (beforeByNumber.size !== afterByNumber.size) {
        fail('stacked pull-request set changed during delivery');
    }
    for (const [number, expected] of beforeByNumber) {
        const current = afterByNumber.get(number);
        if (
            current === undefined ||
            current.state !== 'OPEN' ||
            current.headRefOid !== expected.headRefOid ||
            current.headRefName !== expected.headRefName ||
            current.baseRefName !== expected.baseRefName
        ) {
            fail(`stacked PR #${number} changed during delivery`);
        }
    }
}

function retargetDependents(dependents: StackedPullRequest[], baseBranch: string, port: DeliveryPort): void {
    for (const dependent of dependents) {
        port.retarget(dependent.number, baseBranch);
        const retargeted = port.pullRequest(dependent.number);
        if (
            retargeted.state !== 'OPEN' ||
            retargeted.headRefOid !== dependent.headRefOid ||
            retargeted.baseRefName !== baseBranch
        ) {
            fail(`stacked PR #${dependent.number} was not safely retargeted`);
        }
    }
}

function completeIssueAfterMerge(
    pullRequestNumber: number,
    issueNumber: number | undefined,
    tracker: TrackerCompletionPort
): void {
    if (issueNumber === undefined) {
        return;
    }
    try {
        tracker.complete(issueNumber);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
            `PR #${pullRequestNumber} is already merged, but issue #${issueNumber} was not completed: ${detail}`,
            { cause: error }
        );
    }
}

function validateAuthorAppMerger(pullRequest: PullRequestSnapshot): void {
    if (pullRequest.state !== 'MERGED' || !isAuthorBotNodeId(pullRequest.mergedByActorNodeId)) {
        fail(`PR #${pullRequest.number} was not merged by the author App`);
    }
}

function deliverPullRequestWithCiAdmission(
    number: number,
    port: DeliveryPort,
    tracker: TrackerCompletionPort,
    ciAdmissionMode: CiAdmissionMode,
    markRemoteMutationKnownAbsent?: () => void
): void {
    port.fetch();
    const rawInitial = port.pullRequest(number);
    if (rawInitial.state === 'CLOSED') {
        restoreDeliveryReceiptAuthorityBeforeClosedRetry(number, port);
    }
    const initial = resolveStructuralMergeability(rawInitial, port);
    if (initial.state === 'CLOSED') {
        restoreDeliveryReceiptAuthorityBeforeClosedRetry(number, port);
    }
    if (initial.state === 'MERGED') {
        validateBaseBranch(initial);
        validateAuthorAppMerger(initial);
        const receiptAuthority = port.readDeliveryReceiptAuthority(number);
        if (receiptAuthority === undefined) {
            fail(`PR #${number} delivery receipt authority cannot be proven`);
        }
        const receipt = readPersistedMergedRecoveryReceipt(initial, port, receiptAuthority);
        const receiptPayload = assertDeliveryReceiptForHead(receipt, initial);
        let recoveryPostMergeValidation: PersistedPreparedPostMergeValidation | undefined;
        if (receiptAuthority.phase === 'legacy') {
            recoveryPostMergeValidation = persistedPreparedPostMergeValidation(
                initial,
                receiptPayload.closingIssue ?? undefined
            );
        } else if (receiptAuthority.phase !== 'released') {
            recoveryPostMergeValidation = receiptAuthority.postMergeValidation;
        }
        if (receiptAuthority.phase !== 'terminal') {
            persistMergeAuthorizedDeliveryReceiptAuthority(number, receipt, recoveryPostMergeValidation, port);
        }
        const remaining = port.dependents(initial.headRefName).filter((candidate) => candidate.number !== number);
        retargetDependents(remaining, initial.baseRefName, port);
        completeIssueAfterMerge(number, receiptPayload.closingIssue, tracker);
        persistTerminalDeliveryReceiptAuthority(number, receipt, recoveryPostMergeValidation, port);
        port.log(`PR #${number} was already merged; repaired ${remaining.length} remaining dependent(s)`);
        return;
    }
    releaseStaleFrozenDeliveryReceiptAuthorityBeforeOpenRetry(initial, port);
    validateBaseBranch(initial);
    const initialTrackerTarget = trackerCompletionTarget(initial);
    validatePullRequest(initial, port, ciAdmissionMode);
    validateReview(number, port.reviewState(number, initial.headRefOid));

    const dependents = port.dependents(initial.headRefName).filter((candidate) => candidate.number !== number);
    if (dependents.length > 0 && port.repositoryDeletesMergedBranches()) {
        fail('automatic merged-branch deletion must be disabled before delivering a stacked PR');
    }
    port.log(`review size: ${initial.changedFiles} file(s), +${initial.additions}/-${initial.deletions}`);

    const receipt = ensureDeliveryReceipt(initial, initialTrackerTarget, port, ciAdmissionMode);
    const receiptPayload = assertDeliveryReceiptForHead(receipt, initial);
    const preparedPostMergeValidation = persistedPreparedPostMergeValidation(initial, initialTrackerTarget);
    const authorityBeforeFinalFetchArming = port.readDeliveryReceiptAuthority(number);
    const finalFetchArmedAuthority = preparedDeliveryReceiptAuthority(receipt, preparedPostMergeValidation);
    persistPreparedDeliveryReceiptAuthority(number, receipt, port, preparedPostMergeValidation);

    const finalSnapshot = resolveFinalSnapshotWithRestorablePreparedAuthority(
        number,
        authorityBeforeFinalFetchArming,
        finalFetchArmedAuthority,
        port
    );
    if (finalSnapshot.state === 'MERGED') {
        validatePostMergeSnapshot(preparedPostMergeValidation, finalSnapshot, number);
        const recoveredReceipt = readStableExactDeliveryReceipt(finalSnapshot, port, receipt.id);
        const recoveredPayload = assertCanonicalDeliveryReceipt(recoveredReceipt, finalSnapshot, receiptPayload);
        validateReceiptPayloadAgainstPreparedPostMergeValidation(
            number,
            recoveredPayload,
            preparedPostMergeValidation,
            'delivery'
        );
        validateStableDeliveryReceipt(number, receiptPayload, recoveredPayload);
        persistMergeAuthorizedDeliveryReceiptAuthority(number, recoveredReceipt, preparedPostMergeValidation, port);
        const finalDependents = port
            .dependents(finalSnapshot.headRefName)
            .filter((candidate) => candidate.number !== number);
        validateDependentSet(dependents, finalDependents);
        for (const dependent of finalDependents) {
            validateDependent(port.pullRequest(dependent.number), dependent);
        }
        retargetDependents(finalDependents, finalSnapshot.baseRefName, port);
        completeIssueAfterMerge(number, recoveredPayload.closingIssue, tracker);
        persistTerminalDeliveryReceiptAuthority(number, recoveredReceipt, preparedPostMergeValidation, port);
        port.log(`PR #${number} became merged during delivery; repaired ${finalDependents.length} dependent(s)`);
        return;
    }
    const { finalDependents, finalTrackerTarget, finalReceipt, finalReceiptPayload, preMergeArmedAuthority } =
        withRestorablePreArmedDeliveryReceiptAuthority(
            number,
            authorityBeforeFinalFetchArming,
            finalFetchArmedAuthority,
            port,
            () => shouldRestorePreArmedDeliveryReceiptAuthorityAfterFinalObservation(finalSnapshot),
            () => {
                restorePreArmedDeliveryReceiptAuthority(
                    number,
                    authorityBeforeFinalFetchArming,
                    finalFetchArmedAuthority,
                    port
                );
                const finalTrackerTarget = trackerCompletionTarget(finalSnapshot);
                validateStableTrackerTarget(number, initialTrackerTarget, finalTrackerTarget);
                validateStablePullRequest(initial, finalSnapshot);
                validatePullRequest(finalSnapshot, port, ciAdmissionMode);
                validateBaseBranch(finalSnapshot);
                validateReview(number, port.reviewState(number, finalSnapshot.headRefOid));
                const finalDependents = port
                    .dependents(finalSnapshot.headRefName)
                    .filter((candidate) => candidate.number !== number);
                validateDependentSet(dependents, finalDependents);
                for (const dependent of finalDependents) {
                    validateDependent(port.pullRequest(dependent.number), dependent);
                }

                const finalReceipt = ensureDeliveryReceipt(finalSnapshot, finalTrackerTarget, port, ciAdmissionMode);
                const finalReceiptPayload = assertDeliveryReceiptForHead(finalReceipt, finalSnapshot);
                const preMergeArmedAuthority = preparedDeliveryReceiptAuthority(
                    finalReceipt,
                    persistedPreparedPostMergeValidation(finalSnapshot, finalTrackerTarget)
                );
                persistPreparedDeliveryReceiptAuthority(
                    number,
                    finalReceipt,
                    port,
                    preMergeArmedAuthority.postMergeValidation
                );
                return {
                    finalDependents,
                    finalTrackerTarget,
                    finalReceipt,
                    finalReceiptPayload,
                    preMergeArmedAuthority,
                };
            }
        );
    try {
        port.merge(number, finalSnapshot.headRefOid, finalDependents.length > 0, `${finalSnapshot.title} (#${number})`);
    } catch (error) {
        if (error instanceof DeliveryMergeRejectedError) {
            if (error.certainty === 'definitive-no-merge') {
                markRemoteMutationKnownAbsent?.();
            }
            tryRestorePreArmedDeliveryReceiptAuthorityAfterMergeFailure(
                number,
                authorityBeforeFinalFetchArming,
                preMergeArmedAuthority,
                port
            );
        }
        throw error;
    }
    const mergedSnapshot = port.pullRequest(number);
    validatePostMergeSnapshot(
        persistedPreparedPostMergeValidation(finalSnapshot, finalTrackerTarget),
        mergedSnapshot,
        number
    );
    persistMergeAuthorizedDeliveryReceiptAuthority(
        number,
        finalReceipt,
        persistedPreparedPostMergeValidation(finalSnapshot, finalTrackerTarget),
        port
    );
    retargetDependents(finalDependents, finalSnapshot.baseRefName, port);
    completeIssueAfterMerge(number, finalReceiptPayload.closingIssue, tracker);
    persistTerminalDeliveryReceiptAuthority(
        number,
        finalReceipt,
        persistedPreparedPostMergeValidation(finalSnapshot, finalTrackerTarget),
        port
    );
}

export function deliverPullRequest(
    number: number,
    port: DeliveryPort,
    tracker: TrackerCompletionPort,
    markRemoteMutationKnownAbsent?: () => void
): void {
    deliverPullRequestWithCiAdmission(number, port, tracker, ACTIVE_CI_ADMISSION_MODE, markRemoteMutationKnownAbsent);
}

/** Retained as the snapshot-backed cutover path if CI becomes merge-authoritative again. */
export function deliverPullRequestWithRequiredCi(
    number: number,
    port: DeliveryPort,
    tracker: TrackerCompletionPort,
    markRemoteMutationKnownAbsent?: () => void
): void {
    deliverPullRequestWithCiAdmission(number, port, tracker, 'required', markRemoteMutationKnownAbsent);
}

function capture(command: string, args: string[]): string {
    const result = spawnSync(command, args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: false,
        ...(command === 'git' ? { env: trustedDeliveryGitEnv() } : {}),
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `${command} failed with exit ${result.status ?? 'signal'}`);
    }
    return result.stdout.trim();
}

function run(command: string, args: string[]): void {
    const result = spawnSync(command, args, {
        cwd: process.cwd(),
        stdio: 'inherit',
        shell: false,
        ...(command === 'git' ? { env: trustedDeliveryGitEnv() } : {}),
    });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${command} failed with exit ${result.status ?? 'signal'}`);
    }
}

function parseJson<Value>(value: string, label: string): Value {
    try {
        return JSON.parse(value) as Value;
    } catch (error) {
        throw new Error(`${label} returned invalid JSON`, { cause: error });
    }
}

type RepositoryMergeSettings = {
    allow_merge_commit?: unknown;
    allow_rebase_merge?: unknown;
    allow_squash_merge?: unknown;
    delete_branch_on_merge?: unknown;
};

type RepositoryMergePolicy = {
    method: 'squash';
    deletesMergedBranches: boolean;
};

function repositoryMergePolicy(repository: string, shell: ShellRunner): RepositoryMergePolicy {
    let settings: RepositoryMergeSettings;
    try {
        settings = parseJson<RepositoryMergeSettings>(
            shell.capture('gh', ['api', `repos/${repository}`]),
            'repository merge settings'
        );
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`cannot determine repository merge settings: ${detail}`, { cause: error });
    }
    if (
        typeof settings.allow_merge_commit !== 'boolean' ||
        typeof settings.allow_squash_merge !== 'boolean' ||
        typeof settings.allow_rebase_merge !== 'boolean' ||
        typeof settings.delete_branch_on_merge !== 'boolean'
    ) {
        throw new TypeError('cannot prove repository merge settings');
    }
    if (!settings.allow_squash_merge) {
        throw new Error('squash merge is not enabled for this repository');
    }
    return { method: 'squash', deletesMergedBranches: settings.delete_branch_on_merge };
}

type RollupPage = {
    totalCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: unknown[];
};

type RawRollupContexts = {
    totalCount?: unknown;
    pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } | null;
    nodes?: unknown;
};

type RawRollupEntry = {
    id?: unknown;
    __typename?: unknown;
    name?: unknown;
    status?: unknown;
    conclusion?: unknown;
    startedAt?: unknown;
    context?: unknown;
    state?: unknown;
    createdAt?: unknown;
};

type RollupNode = {
    id: string;
    checkRun: HeadCheckRun;
};

type DeliveryReceiptProofResponse = {
    data?: {
        repository?: {
            pullRequest?: {
                comments?: {
                    totalCount?: unknown;
                    pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } | null;
                    nodes?: Array<{ id?: unknown; lastEditedAt?: unknown } | null> | null;
                } | null;
            } | null;
        };
    };
};

const UNSETTLED_STATUS_CONTEXT_STATES = new Set(['PENDING', 'EXPECTED']);

const ROLLUP_PAGE_SIZE = 100;

const ROLLUP_QUERY = `query($owner:String!,$name:String!,$oid:GitObjectID!,$cursor:String){
  repository(owner:$owner,name:$name){
    object(oid:$oid){
      ... on Commit{
        statusCheckRollup{
          contexts(first:${ROLLUP_PAGE_SIZE},after:$cursor){
            totalCount
            pageInfo{hasNextPage endCursor}
            nodes{
              __typename
              ... on CheckRun{id name status conclusion startedAt}
              ... on StatusContext{id context state createdAt}
            }
          }
        }
      }
    }
  }
}`;

/**
 * `gh pr view --json statusCheckRollup` asks GitHub for the first hundred contexts and reports
 * neither a total nor a cursor, so a head that outgrew one page arrives silently truncated. Every
 * conclusion this gate draws from the rollup — a tolerated cancellation as much as a refusal — would
 * then rest on evidence that may simply be absent, and each further review event adds a whole run's
 * worth of contexts, so heads cross that line in the ordinary course of a long review. The rollup is
 * read through GraphQL instead, pinned to the first page's declared total, paged through every page
 * GitHub offers, and refused unless the terminal page accounts for that exact unique node count.
 * A partial or self-contradictory list is never merged over.
 */
function readHeadCheckRuns(pullRequestNumber: number, readPage: (cursor: string | null) => RollupPage): HeadCheckRun[] {
    const runs: HeadCheckRun[] = [];
    const seenNodeIds = new Set<string>();
    const emittedCursors = new Set<string>();
    let page = readPage(null);
    let cursor: string | null = null;
    const expectedTotalCount = page.totalCount;
    while (true) {
        if (page.totalCount !== expectedTotalCount) {
            fail(`cannot read all ${expectedTotalCount} checks on PR #${pullRequestNumber}: rollup totalCount drifted`);
        }
        for (const entry of page.nodes) {
            const node = toRollupNode(entry, pullRequestNumber);
            if (seenNodeIds.has(node.id)) {
                fail(
                    `cannot read all ${expectedTotalCount} checks on PR #${pullRequestNumber}: rollup repeated a node`
                );
            }
            seenNodeIds.add(node.id);
            runs.push(node.checkRun);
        }
        if (runs.length > expectedTotalCount) {
            fail(`cannot read all ${expectedTotalCount} checks on PR #${pullRequestNumber}: got ${runs.length}`);
        }
        if (!page.pageInfo.hasNextPage) {
            break;
        }
        if (page.pageInfo.endCursor === null || page.pageInfo.endCursor === cursor) {
            fail(`cannot read all ${expectedTotalCount} checks on PR #${pullRequestNumber}: cursor did not advance`);
        }
        if (emittedCursors.has(page.pageInfo.endCursor)) {
            fail(`cannot read all ${expectedTotalCount} checks on PR #${pullRequestNumber}: cursor did not advance`);
        }
        emittedCursors.add(page.pageInfo.endCursor);
        cursor = page.pageInfo.endCursor;
        page = readPage(cursor);
    }
    if (runs.length !== expectedTotalCount) {
        fail(`cannot read all ${expectedTotalCount} checks on PR #${pullRequestNumber}: got ${runs.length}`);
    }
    return runs;
}

function parseRollupPage(response: string, pullRequestNumber: number): RollupPage {
    const contexts = parseJson<{
        data?: { repository?: { object?: { statusCheckRollup?: { contexts?: RawRollupContexts } | null } | null } };
    }>(response, `PR #${pullRequestNumber} checks`).data?.repository?.object?.statusCheckRollup?.contexts;
    if (
        contexts === undefined ||
        typeof contexts.totalCount !== 'number' ||
        typeof contexts.pageInfo?.hasNextPage !== 'boolean' ||
        !Array.isArray(contexts.nodes)
    ) {
        fail(`cannot read the checks on PR #${pullRequestNumber}`);
    }
    return {
        totalCount: contexts.totalCount,
        pageInfo: {
            hasNextPage: contexts.pageInfo.hasNextPage,
            endCursor: typeof contexts.pageInfo.endCursor === 'string' ? contexts.pageInfo.endCursor : null,
        },
        nodes: contexts.nodes,
    };
}

/**
 * The rollup is a union. GitHub Actions reports a `CheckRun` carrying a status and a conclusion,
 * while an external integration reports a `StatusContext` whose single state carries both. Reading
 * only the `CheckRun` arm would drop a failing status context out of the evidence entirely, so an
 * entry that matches neither arm refuses rather than being skipped.
 */
function toRollupNode(value: unknown, pullRequestNumber: number): RollupNode {
    const entry = (value === null || typeof value !== 'object' ? {} : value) as RawRollupEntry;
    if (
        typeof entry.id === 'string' &&
        entry.__typename === 'CheckRun' &&
        typeof entry.name === 'string' &&
        typeof entry.status === 'string'
    ) {
        return {
            id: entry.id,
            checkRun: {
                name: entry.name,
                status: entry.status,
                conclusion: typeof entry.conclusion === 'string' && entry.conclusion !== '' ? entry.conclusion : null,
                startedAt: reportedTimestamp(entry.startedAt),
            },
        };
    }
    if (
        typeof entry.id === 'string' &&
        entry.__typename === 'StatusContext' &&
        typeof entry.context === 'string' &&
        typeof entry.state === 'string'
    ) {
        // A status context carries no start of its own; its creation is when the reporting integration
        // first spoke about this commit, which is the same ordering evidence for the same purpose.
        return {
            id: entry.id,
            checkRun: toStatusContextCheckRun(entry.context, entry.state, reportedTimestamp(entry.createdAt)),
        };
    }
    return fail(`cannot read a check on PR #${pullRequestNumber}`);
}

function reportedTimestamp(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
}

function toStatusContextCheckRun(name: string, state: string, startedAt: string | null): HeadCheckRun {
    if (UNSETTLED_STATUS_CONTEXT_STATES.has(state)) {
        return { name, status: state, conclusion: null, startedAt };
    }
    return { name, status: SETTLED_CHECK_STATUS, conclusion: state, startedAt };
}

function toDeliveryReceiptComment(value: unknown): DeliveryReceiptComment {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail('invalid delivery receipt comment');
    }
    const comment = value as {
        node_id?: unknown;
        body?: unknown;
        user?: { node_id?: unknown; login?: unknown; type?: unknown } | null;
        created_at?: unknown;
        updated_at?: unknown;
    };
    if (
        typeof comment.node_id !== 'string' ||
        typeof comment.body !== 'string' ||
        typeof comment.created_at !== 'string' ||
        typeof comment.updated_at !== 'string'
    ) {
        fail('invalid delivery receipt comment');
    }
    return {
        id: comment.node_id,
        body: comment.body,
        authorNodeId: typeof comment.user?.node_id === 'string' ? comment.user.node_id : null,
        authorLogin: typeof comment.user?.login === 'string' ? comment.user.login : null,
        authorType: typeof comment.user?.type === 'string' ? comment.user.type : null,
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
    };
}

function toPullRequestSnapshot(value: string, number: number): PullRequestSnapshot {
    const parsed = parseJson<
        Omit<PullRequestSnapshot, 'mergedByActorNodeId'> & {
            mergedBy?: { is_bot?: unknown; login?: unknown } | null;
        }
    >(value, `PR #${number}`);
    const { mergedBy: _mergedBy, ...snapshot } = parsed;
    return {
        ...snapshot,
        mergedByActorNodeId: null,
    };
}

function readMergedByActorNodeId(
    number: number,
    repository: { owner: string; name: string },
    shell: Pick<ShellRunner, 'capture'>
): string {
    const query =
        'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){mergedBy{__typename ... on Bot{id}}}}}';
    const response = parseJson<{
        data?: {
            repository?: {
                pullRequest?: {
                    mergedBy?: { __typename?: unknown; id?: unknown } | null;
                };
            };
        };
    }>(
        shell.capture('gh', [
            'api',
            'graphql',
            '-f',
            `query=${query}`,
            '-f',
            `owner=${repository.owner}`,
            '-f',
            `name=${repository.name}`,
            '-F',
            `number=${number}`,
        ]),
        `PR #${number} merger query`
    );
    const mergedBy = response.data?.repository?.pullRequest?.mergedBy;
    if (mergedBy?.__typename !== 'Bot' || typeof mergedBy.id !== 'string') {
        fail(`PR #${number} merger cannot be verified`);
    }
    return mergedBy.id;
}

function readDeliveryReceiptProofFromGithub(
    number: number,
    repository: { owner: string; name: string },
    shell: Pick<ShellRunner, 'capture'>
): DeliveryReceiptProof {
    const query = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){comments(first:${ROLLUP_PAGE_SIZE},after:$cursor,orderBy:{field:UPDATED_AT,direction:ASC}){totalCount pageInfo{hasNextPage endCursor} nodes{id lastEditedAt}}}}}`;
    const readPage = (cursor: string | null) => {
        const response = parseJson<DeliveryReceiptProofResponse>(
            shell.capture('gh', [
                'api',
                'graphql',
                '-f',
                `query=${query}`,
                '-f',
                `owner=${repository.owner}`,
                '-f',
                `name=${repository.name}`,
                '-F',
                `number=${number}`,
                ...(cursor === null ? [] : ['-f', `cursor=${cursor}`]),
            ]),
            `PR #${number} delivery receipt proof`
        );
        const comments = response.data?.repository?.pullRequest?.comments;
        if (
            typeof comments?.totalCount !== 'number' ||
            typeof comments.pageInfo?.hasNextPage !== 'boolean' ||
            !Array.isArray(comments.nodes)
        ) {
            fail(`cannot inspect delivery receipts for PR #${number}`);
        }
        return {
            totalCount: comments.totalCount,
            pageInfo: {
                hasNextPage: comments.pageInfo.hasNextPage,
                endCursor: typeof comments.pageInfo.endCursor === 'string' ? comments.pageInfo.endCursor : null,
            },
            nodes: comments.nodes.map((comment) => {
                if (comment === null || comment === undefined || typeof comment.id !== 'string') {
                    fail(`cannot inspect delivery receipts for PR #${number}`);
                }
                if (
                    comment.lastEditedAt !== undefined &&
                    comment.lastEditedAt !== null &&
                    typeof comment.lastEditedAt !== 'string'
                ) {
                    fail(`cannot inspect delivery receipts for PR #${number}`);
                }
                return {
                    id: comment.id,
                    lastEditedAt: typeof comment.lastEditedAt === 'string' ? comment.lastEditedAt : undefined,
                };
            }),
        };
    };
    let page = readPage(null);
    const expectedTotalCount = page.totalCount;
    const commentIds: string[] = [];
    const editedCommentIds: string[] = [];
    const seenCommentIds = new Set<string>();
    const emittedCursors = new Set<string>();
    let cursor: string | null = null;
    while (true) {
        if (page.totalCount !== expectedTotalCount) {
            fail(`cannot inspect delivery receipts for PR #${number}`);
        }
        let pageContributed = 0;
        for (const node of page.nodes) {
            if (seenCommentIds.has(node.id)) {
                fail(`cannot inspect delivery receipts for PR #${number}`);
            }
            seenCommentIds.add(node.id);
            commentIds.push(node.id);
            if (node.lastEditedAt !== undefined) {
                editedCommentIds.push(node.id);
            }
            pageContributed += 1;
        }
        if (commentIds.length > expectedTotalCount) {
            fail(`cannot inspect delivery receipts for PR #${number}`);
        }
        if (!page.pageInfo.hasNextPage) {
            break;
        }
        if (cursor !== null && pageContributed === 0) {
            fail(`cannot inspect delivery receipts for PR #${number}`);
        }
        if (page.pageInfo.endCursor === null || page.pageInfo.endCursor === cursor) {
            fail(`cannot inspect delivery receipts for PR #${number}`);
        }
        if (commentIds.length >= expectedTotalCount) {
            fail(`cannot inspect delivery receipts for PR #${number}`);
        }
        if (emittedCursors.has(page.pageInfo.endCursor)) {
            fail(`cannot inspect delivery receipts for PR #${number}`);
        }
        emittedCursors.add(page.pageInfo.endCursor);
        cursor = page.pageInfo.endCursor;
        page = readPage(cursor);
    }
    if (commentIds.length !== expectedTotalCount) {
        fail(`cannot inspect delivery receipts for PR #${number}`);
    }
    return {
        totalCount: expectedTotalCount,
        latestCommentId: commentIds.at(-1),
        commentIds,
        editedCommentIds,
    };
}

type PullRequestReviewRecord = {
    id: string;
    state: string;
    submittedAt: string | null;
    author: { id: string | null; login: string; __typename: string } | null;
    commitOid: string | null;
};

type ReviewThreadRecord = {
    id: string;
    isResolved: boolean;
};

type ReviewStatePage = {
    pullRequestId: string;
    headRefOid: string;
    reviews: {
        nodes: PullRequestReviewRecord[];
        pageInfo: { hasPreviousPage: boolean; startCursor: string | null };
    };
    reviewThreads: {
        nodes: ReviewThreadRecord[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
};

type CompleteReviewState = {
    pullRequestId: string;
    headRefOid: string;
    reviews: PullRequestReviewRecord[];
    reviewThreads: ReviewThreadRecord[];
};

const REVIEW_STATE_PAGE_SIZE = 100;
const REVIEW_STATE_PAGE_LIMIT = 1_000;
const REVIEW_STATE_QUERY = `query($owner:String!,$name:String!,$number:Int!,$reviewsBefore:String,$threadsAfter:String){repository(owner:$owner,name:$name){pullRequest(number:$number){id headRefOid reviews(last:${REVIEW_STATE_PAGE_SIZE},before:$reviewsBefore){nodes{id state submittedAt author{login __typename ... on Bot{id}} commit{oid}} pageInfo{hasPreviousPage startCursor}} reviewThreads(first:${REVIEW_STATE_PAGE_SIZE},after:$threadsAfter){nodes{id isResolved} pageInfo{hasNextPage endCursor}}}}}`;

function invalidReviewState(number: number): never {
    fail(`cannot prove complete review state for PR #${number}`);
}

function requiredReviewStateString(value: unknown, number: number): string {
    if (typeof value !== 'string' || value.trim() === '') {
        invalidReviewState(number);
    }
    return value;
}

function parseReviewAuthor(value: unknown, number: number): PullRequestReviewRecord['author'] {
    if (value === null) {
        return null;
    }
    if (!isRecord(value)) {
        invalidReviewState(number);
    }
    if (value.id !== undefined && (typeof value.id !== 'string' || value.id.trim() === '')) {
        invalidReviewState(number);
    }
    return {
        id: typeof value.id === 'string' ? value.id : null,
        login: requiredReviewStateString(value.login, number),
        __typename: requiredReviewStateString(value.__typename, number),
    };
}

function parseReviewRecord(value: unknown, number: number): PullRequestReviewRecord {
    if (!isRecord(value)) {
        invalidReviewState(number);
    }
    if (value.submittedAt !== null && typeof value.submittedAt !== 'string') {
        invalidReviewState(number);
    }
    let commitOid: string | null = null;
    if (value.commit !== null) {
        if (!isRecord(value.commit)) {
            invalidReviewState(number);
        }
        commitOid = requiredReviewStateString(value.commit.oid, number);
    }
    return {
        id: requiredReviewStateString(value.id, number),
        state: requiredReviewStateString(value.state, number),
        submittedAt: value.submittedAt,
        author: parseReviewAuthor(value.author, number),
        commitOid,
    };
}

function parseReviewThreadRecord(value: unknown, number: number): ReviewThreadRecord {
    if (!isRecord(value) || typeof value.isResolved !== 'boolean') {
        invalidReviewState(number);
    }
    return {
        id: requiredReviewStateString(value.id, number),
        isResolved: value.isResolved,
    };
}

function parseReviewStatePage(response: string, number: number): ReviewStatePage {
    const envelope = parseJson<unknown>(response, 'review query');
    if (
        !isRecord(envelope) ||
        (Object.hasOwn(envelope, 'errors') && (!Array.isArray(envelope.errors) || envelope.errors.length > 0)) ||
        !isRecord(envelope.data) ||
        !isRecord(envelope.data.repository)
    ) {
        invalidReviewState(number);
    }
    const pullRequest = envelope.data.repository.pullRequest;
    if (
        !isRecord(pullRequest) ||
        !isRecord(pullRequest.reviews) ||
        !Array.isArray(pullRequest.reviews.nodes) ||
        !isRecord(pullRequest.reviews.pageInfo) ||
        typeof pullRequest.reviews.pageInfo.hasPreviousPage !== 'boolean' ||
        (pullRequest.reviews.pageInfo.startCursor !== null &&
            typeof pullRequest.reviews.pageInfo.startCursor !== 'string') ||
        !isRecord(pullRequest.reviewThreads) ||
        !Array.isArray(pullRequest.reviewThreads.nodes) ||
        !isRecord(pullRequest.reviewThreads.pageInfo) ||
        typeof pullRequest.reviewThreads.pageInfo.hasNextPage !== 'boolean' ||
        (pullRequest.reviewThreads.pageInfo.endCursor !== null &&
            typeof pullRequest.reviewThreads.pageInfo.endCursor !== 'string')
    ) {
        invalidReviewState(number);
    }
    return {
        pullRequestId: requiredReviewStateString(pullRequest.id, number),
        headRefOid: requiredReviewStateString(pullRequest.headRefOid, number),
        reviews: {
            nodes: pullRequest.reviews.nodes.map((node) => parseReviewRecord(node, number)),
            pageInfo: {
                hasPreviousPage: pullRequest.reviews.pageInfo.hasPreviousPage,
                startCursor: pullRequest.reviews.pageInfo.startCursor,
            },
        },
        reviewThreads: {
            nodes: pullRequest.reviewThreads.nodes.map((node) => parseReviewThreadRecord(node, number)),
            pageInfo: {
                hasNextPage: pullRequest.reviewThreads.pageInfo.hasNextPage,
                endCursor: pullRequest.reviewThreads.pageInfo.endCursor,
            },
        },
    };
}

function nextReviewStateCursor(number: number, cursor: string | null, seen: Set<string>): string {
    if (cursor === null || cursor.trim() === '' || seen.has(cursor)) {
        fail(`cannot prove complete review state for PR #${number}`);
    }
    seen.add(cursor);
    return cursor;
}

function assertReviewStatePageBudget(number: number, pagesRead: number): void {
    if (pagesRead >= REVIEW_STATE_PAGE_LIMIT) {
        fail(`cannot prove complete review state for PR #${number}`);
    }
}

function assertReviewStatePageIdentity(
    number: number,
    page: ReviewStatePage,
    pullRequestId: string,
    expectedHead: string
): void {
    if (page.pullRequestId !== pullRequestId || page.headRefOid !== expectedHead) {
        invalidReviewState(number);
    }
}

function readCompleteReviewState(
    number: number,
    expectedHead: string,
    expectedPullRequestId: string | undefined,
    readPage: (reviewsBefore: string | null, threadsAfter: string | null) => ReviewStatePage
): CompleteReviewState {
    const initialPage = readPage(null, null);
    const pullRequestId = expectedPullRequestId ?? initialPage.pullRequestId;
    assertReviewStatePageIdentity(number, initialPage, pullRequestId, expectedHead);
    const reviewPages = [initialPage.reviews.nodes];
    const reviewCursors = new Set<string>();
    let reviewPage = initialPage.reviews;
    let reviewPagesRead = 1;
    while (reviewPage.pageInfo.hasPreviousPage) {
        assertReviewStatePageBudget(number, reviewPagesRead);
        const cursor = nextReviewStateCursor(number, reviewPage.pageInfo.startCursor, reviewCursors);
        const nextPage = readPage(cursor, null);
        assertReviewStatePageIdentity(number, nextPage, pullRequestId, expectedHead);
        reviewPage = nextPage.reviews;
        reviewPages.push(reviewPage.nodes);
        reviewPagesRead += 1;
    }

    const reviewThreads = [...initialPage.reviewThreads.nodes];
    const threadCursors = new Set<string>();
    let threadPage = initialPage.reviewThreads;
    let threadPagesRead = 1;
    while (threadPage.pageInfo.hasNextPage) {
        assertReviewStatePageBudget(number, threadPagesRead);
        const cursor = nextReviewStateCursor(number, threadPage.pageInfo.endCursor, threadCursors);
        const nextPage = readPage(null, cursor);
        assertReviewStatePageIdentity(number, nextPage, pullRequestId, expectedHead);
        threadPage = nextPage.reviewThreads;
        reviewThreads.push(...threadPage.nodes);
        threadPagesRead += 1;
    }

    return {
        pullRequestId,
        headRefOid: expectedHead,
        reviews: reviewPages.reverse().flat(),
        reviewThreads,
    };
}

type BranchRulesetRule = {
    type: string;
    parameters?: {
        required_status_checks?: Array<{ context: string }>;
    };
};

/**
 * A live read of the rule GitHub itself merges against, as opposed to `readGateRequiredCheckNames`,
 * which derives a name from the pinned workflow for the required-CI path's own, unrelated purpose.
 * This one exists only to name what a `BLOCKED` head is waiting on, and the caller's own "found
 * nothing" outcome — every required check already succeeded, so the block is something else — is
 * only true when the ruleset itself explicitly says so. A missing or malformed
 * `required_status_checks` rule has not said that; it is a failed read, and must land in the caller's
 * could-not-be-listed branch rather than being mistaken for an explicit, empty requirement.
 *
 * `rules/branches/main` aggregates every ruleset that applies to the branch, not one: more than one
 * can carry its own `required_status_checks` rule, and the merge is blocked on the union of what any
 * of them require. Keeping only the first, as `find` would, silently drops a second rule's contexts —
 * and dropping only the rules that failed to parse, keeping the rest, has the same failure shape:
 * the union comes back short of one rule's contexts and reads as complete. The union is trustworthy
 * only when every matching rule parsed, so one unparsed rule fails the whole read.
 */
function readRequiredStatusCheckContexts(repository: string, shell: ShellRunner): string[] {
    const rules = parseJson<BranchRulesetRule[]>(
        shell.capture('gh', ['api', `repos/${repository}/rules/branches/main`]),
        `branch ruleset for ${repository}`
    );
    const requiredStatusCheckRules = rules.filter((rule) => rule.type === 'required_status_checks');
    if (requiredStatusCheckRules.length === 0) {
        fail(`branch ruleset for ${repository} carries no required_status_checks rule with a parameters array`);
    }
    const requiredStatusCheckArrays = requiredStatusCheckRules
        .map((rule) => rule.parameters?.required_status_checks)
        .filter((contexts): contexts is Array<{ context: string }> => contexts !== undefined);
    if (requiredStatusCheckArrays.length !== requiredStatusCheckRules.length) {
        fail(`branch ruleset for ${repository} carries a required_status_checks rule with no parameters array`);
    }
    return [...new Set(requiredStatusCheckArrays.flat().map((check) => check.context))];
}

export function shellPort(
    repository: string,
    shell: ShellRunner = { capture, run },
    options: {
        gitToken?: string;
        helperDir?: string;
        primaryRoot?: string;
        markRemoteMutationAttempt?: PullRequestRemoteMutationBoundary['markRemoteMutationAttempt'];
    } = {}
): DeliveryPort {
    const [owner, name] = repository.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${repository}`);
    }
    const primaryRoot = options.primaryRoot ?? process.cwd();
    const pullRequestFields = [
        'number',
        'state',
        'isDraft',
        'title',
        'body',
        'headRefName',
        'headRefOid',
        'baseRefName',
        'baseRefOid',
        'mergeable',
        'mergeStateStatus',
        'reviewDecision',
        'changedFiles',
        'additions',
        'deletions',
        'mergedBy',
    ].join(',');
    const readRollupPage = (number: number, headRefOid: string, cursor: string | null): RollupPage =>
        parseRollupPage(
            shell.capture('gh', [
                'api',
                'graphql',
                '-f',
                `query=${ROLLUP_QUERY}`,
                '-f',
                `owner=${owner}`,
                '-f',
                `name=${name}`,
                '-f',
                `oid=${headRefOid}`,
                ...(cursor === null ? [] : ['-f', `cursor=${cursor}`]),
            ]),
            number
        );

    return {
        fetch: () => {
            if (options.gitToken !== undefined) {
                const helperDir =
                    options.helperDir ?? fail('authenticated git fetch requires a credential helper directory');
                shell.run(
                    'git',
                    gitAuthenticatedArgs(options.gitToken, helperDir, [
                        'fetch',
                        '--prune',
                        GITHUB_HTTPS_REMOTE,
                        '+refs/heads/*:refs/remotes/origin/*',
                    ])
                );
                return;
            }
            shell.run('git', ['fetch', '--prune', 'origin']);
        },
        pullRequest: (number) => {
            const snapshot = toPullRequestSnapshot(
                shell.capture('gh', ['pr', 'view', String(number), '--repo', repository, '--json', pullRequestFields]),
                number
            );
            if (snapshot.state !== 'MERGED') {
                return snapshot;
            }
            return {
                ...snapshot,
                mergedByActorNodeId: readMergedByActorNodeId(number, { owner, name }, shell),
            };
        },
        headCheckRuns: (number, headRefOid) =>
            readHeadCheckRuns(number, (cursor) => readRollupPage(number, headRefOid, cursor)),
        gateRequiredCheckNames: () => readGateRequiredCheckNames(),
        requiredStatusCheckContexts: () => readRequiredStatusCheckContexts(repository, shell),
        reviewState: (number, expectedHead) => {
            const readPage = (reviewsBefore: string | null, threadsAfter: string | null) =>
                parseReviewStatePage(
                    shell.capture('gh', [
                        'api',
                        'graphql',
                        '-f',
                        `query=${REVIEW_STATE_QUERY}`,
                        '-f',
                        `owner=${owner}`,
                        '-f',
                        `name=${name}`,
                        '-F',
                        `number=${number}`,
                        ...(reviewsBefore === null ? [] : ['-f', `reviewsBefore=${reviewsBefore}`]),
                        ...(threadsAfter === null ? [] : ['-f', `threadsAfter=${threadsAfter}`]),
                    ]),
                    number
                );
            const firstScan = readCompleteReviewState(number, expectedHead, undefined, readPage);
            const secondScan = readCompleteReviewState(number, expectedHead, firstScan.pullRequestId, readPage);
            if (!isDeepStrictEqual(firstScan, secondScan)) {
                fail(`cannot prove stable review state for PR #${number}`);
            }
            const review = secondScan;
            const onHead = review.reviews.filter(
                (candidate) =>
                    candidate.state !== 'DISMISSED' &&
                    candidate.state !== 'PENDING' &&
                    candidate.commitOid === expectedHead &&
                    candidate.author?.__typename === 'Bot' &&
                    isReviewerBotNodeId(candidate.author.id)
            );
            onHead.sort((left, right) => (left.submittedAt ?? '').localeCompare(right.submittedAt ?? ''));
            return {
                latestReviewerStateOnHead: onHead.at(-1)?.state ?? null,
                unresolvedThreads: review.reviewThreads.filter((thread) => !thread.isResolved).length,
            };
        },
        dependents: (baseBranch) => {
            const pages = parseJson<
                Array<
                    Array<{
                        number: number;
                        state: string;
                        head: { ref: string; sha: string };
                        base: { ref: string };
                    }>
                >
            >(
                shell.capture('gh', [
                    'api',
                    '--paginate',
                    '--slurp',
                    `repos/${repository}/pulls?state=open&base=${encodeURIComponent(baseBranch)}&per_page=100`,
                ]),
                'stacked pull-request query'
            );
            return pages.flat().map((pullRequest) => ({
                number: pullRequest.number,
                state: pullRequest.state.toUpperCase(),
                headRefName: pullRequest.head.ref,
                headRefOid: pullRequest.head.sha,
                baseRefName: pullRequest.base.ref,
            }));
        },
        repositoryDeletesMergedBranches: () =>
            shell.capture('gh', ['api', `repos/${repository}`, '--jq', '.delete_branch_on_merge']) === 'true',
        merge: (number, expectedHead, hasDependents, expectedTitle) => {
            const policy = repositoryMergePolicy(repository, shell);
            if (hasDependents && policy.deletesMergedBranches) {
                fail('automatic merged-branch deletion must be disabled before delivering a stacked PR');
            }
            options.markRemoteMutationAttempt?.();
            const mergeArgs = [
                'api',
                '--method',
                'PUT',
                `repos/${repository}/pulls/${number}/merge`,
                '-f',
                `sha=${expectedHead}`,
                '-f',
                `merge_method=${policy.method}`,
                ...(expectedTitle === undefined ? [] : ['-f', `commit_title=${expectedTitle}`]),
            ];
            let response: string;
            try {
                response = shell.capture('gh', mergeArgs);
            } catch (error) {
                const rejection = classifyGithubMergeRejection(number, error);
                if (rejection !== undefined) {
                    throw rejection;
                }
                throw error;
            }
            const result = parseJson<{ merged: boolean; message: string }>(response, 'merge request');
            if (!result.merged) {
                throw new DeliveryMergeRejectedError(
                    `PR #${number} was not merged: ${result.message}`,
                    'definitive-no-merge'
                );
            }
        },
        retarget: (number, baseBranch) => {
            options.markRemoteMutationAttempt?.();
            shell.run('gh', [
                'api',
                '--method',
                'PATCH',
                `repos/${repository}/pulls/${number}`,
                '-f',
                `base=${baseBranch}`,
                '--silent',
            ]);
        },
        // REST issue comments are returned in ascending comment-ID order. Pagination, flattening,
        // and filtering preserve that immutable order; receipt authority must never sort by time.
        deliveryReceipts: (number) => {
            const pages = parseJson<unknown>(
                shell.capture('gh', [
                    'api',
                    '--paginate',
                    '--slurp',
                    `repos/${repository}/issues/${number}/comments?per_page=100`,
                ]),
                `delivery receipts for PR #${number}`
            );
            if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
                fail(`cannot inspect delivery receipts for PR #${number}`);
            }
            const comments = pages.flat().map(toDeliveryReceiptComment);
            if (new Set(comments.map((comment) => comment.id)).size !== comments.length) {
                fail(`duplicate comment identity on PR #${number}`);
            }
            return comments;
        },
        deliveryReceiptProof: (number) => readDeliveryReceiptProofFromGithub(number, { owner, name }, shell),
        addDeliveryReceipt: (number, body) => {
            options.markRemoteMutationAttempt?.();
            return toDeliveryReceiptComment(
                parseJson<unknown>(
                    shell.capture('gh', [
                        'api',
                        '--method',
                        'POST',
                        `repos/${repository}/issues/${number}/comments`,
                        '-f',
                        `body=${body}`,
                    ]),
                    `delivery receipt for PR #${number}`
                )
            );
        },
        readDeliveryReceiptAuthority: (number) => readDeliveryReceiptAuthority(primaryRoot, number),
        writeDeliveryReceiptAuthority: (number, authority, expectedCurrent) =>
            writeDeliveryReceiptAuthority(primaryRoot, number, authority, expectedCurrent),
        clearDeliveryReceiptAuthority: (number, expectedCurrent) =>
            clearDeliveryReceiptAuthority(primaryRoot, number, expectedCurrent),
        log: (message) => console.log(message),
    };
}

const DELIVER_USAGE = [
    'Usage:',
    '  pnpm deliver <pr-number>',
    '  pnpm deliver --recover-lock <pr-number> --owner <owner-oid>',
].join('\n');

export type DeliverCliArgs = { number?: number; recoverLockArgs?: string[]; help: boolean };

export function parseCliArgs(args: string[]): DeliverCliArgs {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
    }
    if (args[0] === '--recover-lock') {
        return { help: false, recoverLockArgs: args.slice(1) };
    }
    const number = Number(args[0]);
    if (!Number.isSafeInteger(number) || number <= 0) {
        fail('usage: pnpm deliver <pr-number>');
    }
    if (args.length !== 1) {
        fail(`unknown option: ${args[1] ?? ''}`);
    }
    return { number, help: false };
}

export type DeliveryAuthentication = {
    minted: { token: string; login: string; actorNodeId: string; permissions: Record<string, string> };
    session: { configDir: string; env: NodeJS.ProcessEnv; dispose: () => void };
};

type DeliveryReceiptAuthority = StoredDeliveryReceiptAuthority;

function deliveryReceiptAuthorityRef(number: number): string {
    if (!Number.isSafeInteger(number) || number <= 0) {
        fail('delivery receipt authority requires a positive pull-request number');
    }
    return `refs/sourdaw/delivery-receipt/pr-${number}`;
}

function deliveryLockGit(primaryRoot: string, args: string[], input?: string) {
    return spawnSync('git', args, {
        cwd: primaryRoot,
        env: trustedDeliveryGitEnv(),
        encoding: 'utf8',
        shell: false,
        ...(input === undefined ? {} : { input }),
    });
}

function trustedDeliveryGitEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    return {
        ...parent,
        GIT_NO_REPLACE_OBJECTS: '1',
    };
}

function deliveryObjectId(value: string, invalidMessage: string): string {
    const oid = value.trim();
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(oid)) {
        fail(invalidMessage);
    }
    return oid;
}

function isPersistedPreparedPostMergeValidation(value: unknown): value is PersistedPreparedPostMergeValidation {
    const allowedKeys = new Set(['headRefOid', 'headRefName', 'baseRefName', 'title', 'bodySha256', 'trackerTarget']);
    const keys = typeof value === 'object' && value !== null ? Object.keys(value) : [];
    return (
        typeof value === 'object' &&
        value !== null &&
        (keys.length === 5 || keys.length === 6) &&
        keys.every((key) => allowedKeys.has(key)) &&
        'headRefOid' in value &&
        typeof value.headRefOid === 'string' &&
        value.headRefOid !== '' &&
        'headRefName' in value &&
        typeof value.headRefName === 'string' &&
        value.headRefName !== '' &&
        'baseRefName' in value &&
        typeof value.baseRefName === 'string' &&
        value.baseRefName !== '' &&
        'bodySha256' in value &&
        typeof value.bodySha256 === 'string' &&
        /^[0-9a-f]{64}$/u.test(value.bodySha256) &&
        (!('title' in value) || (typeof value.title === 'string' && value.title !== '')) &&
        'trackerTarget' in value &&
        (value.trackerTarget === null ||
            (typeof value.trackerTarget === 'number' &&
                Number.isSafeInteger(value.trackerTarget) &&
                value.trackerTarget > 0))
    );
}

function skipJsonWhitespace(source: string, index: number): number {
    while (index < source.length && /\s/u.test(source[index] ?? '')) {
        index += 1;
    }
    return index;
}

function readJsonStringToken(source: string, start: number): { value: string; end: number } {
    if (source[start] !== '"') {
        throw new Error('expected JSON string');
    }
    let index = start + 1;
    while (index < source.length) {
        const character = source[index];
        if (character === '"') {
            const end = index + 1;
            return { value: JSON.parse(source.slice(start, end)) as string, end };
        }
        if (character === '\\') {
            index += 2;
            continue;
        }
        if (character === undefined || character < ' ') {
            throw new Error('invalid JSON string');
        }
        index += 1;
    }
    throw new Error('unterminated JSON string');
}

function readJsonNumberEnd(source: string, start: number): number {
    let index = start;
    if (source[index] === '-') {
        index += 1;
    }
    const firstDigit = source[index];
    if (firstDigit === '0') {
        index += 1;
    } else {
        if (firstDigit === undefined || firstDigit < '1' || firstDigit > '9') {
            throw new Error('invalid JSON number');
        }
        index += 1;
        while (index < source.length) {
            const digit = source[index];
            if (digit === undefined || digit < '0' || digit > '9') {
                break;
            }
            index += 1;
        }
    }
    if (source[index] === '.') {
        index += 1;
        const fractionDigit = source[index];
        if (fractionDigit === undefined || fractionDigit < '0' || fractionDigit > '9') {
            throw new Error('invalid JSON number');
        }
        index += 1;
        while (index < source.length) {
            const digit = source[index];
            if (digit === undefined || digit < '0' || digit > '9') {
                break;
            }
            index += 1;
        }
    }
    const exponent = source[index];
    if (exponent === 'e' || exponent === 'E') {
        index += 1;
        const sign = source[index];
        if (sign === '+' || sign === '-') {
            index += 1;
        }
        const exponentDigit = source[index];
        if (exponentDigit === undefined || exponentDigit < '0' || exponentDigit > '9') {
            throw new Error('invalid JSON number');
        }
        index += 1;
        while (index < source.length) {
            const digit = source[index];
            if (digit === undefined || digit < '0' || digit > '9') {
                break;
            }
            index += 1;
        }
    }
    return index;
}

function readJsonLiteralEnd(source: string, start: number, literal: 'true' | 'false' | 'null'): number {
    if (!source.startsWith(literal, start)) {
        throw new Error(`invalid JSON literal ${literal}`);
    }
    return start + literal.length;
}

function scanJsonValueForDuplicateMembers(source: string, start: number): number {
    const index = skipJsonWhitespace(source, start);
    const character = source[index];
    if (character === '{') {
        return scanJsonObjectForDuplicateMembers(source, index);
    }
    if (character === '[') {
        return scanJsonArrayForDuplicateMembers(source, index);
    }
    if (character === '"') {
        return readJsonStringToken(source, index).end;
    }
    if (character === 't') {
        return readJsonLiteralEnd(source, index, 'true');
    }
    if (character === 'f') {
        return readJsonLiteralEnd(source, index, 'false');
    }
    if (character === 'n') {
        return readJsonLiteralEnd(source, index, 'null');
    }
    return readJsonNumberEnd(source, index);
}

function scanJsonObjectForDuplicateMembers(source: string, start: number): number {
    let index = skipJsonWhitespace(source, start + 1);
    const keys = new Set<string>();
    if (source[index] === '}') {
        return index + 1;
    }
    while (true) {
        const key = readJsonStringToken(source, index);
        if (keys.has(key.value)) {
            throw new Error(`duplicate key ${key.value}`);
        }
        keys.add(key.value);
        index = skipJsonWhitespace(source, key.end);
        if (source[index] !== ':') {
            throw new Error('expected object colon');
        }
        index = scanJsonValueForDuplicateMembers(source, index + 1);
        index = skipJsonWhitespace(source, index);
        if (source[index] === '}') {
            return index + 1;
        }
        if (source[index] !== ',') {
            throw new Error('expected object comma');
        }
        index = skipJsonWhitespace(source, index + 1);
    }
}

function scanJsonArrayForDuplicateMembers(source: string, start: number): number {
    let index = skipJsonWhitespace(source, start + 1);
    if (source[index] === ']') {
        return index + 1;
    }
    while (true) {
        index = scanJsonValueForDuplicateMembers(source, index);
        index = skipJsonWhitespace(source, index);
        if (source[index] === ']') {
            return index + 1;
        }
        if (source[index] !== ',') {
            throw new Error('expected array comma');
        }
        index = skipJsonWhitespace(source, index + 1);
    }
}

function parseJsonWithoutDuplicateMembers<Value>(source: string): Value {
    const end = scanJsonValueForDuplicateMembers(source, 0);
    if (skipJsonWhitespace(source, end) !== source.length) {
        throw new Error('unexpected trailing JSON content');
    }
    return JSON.parse(source) as Value;
}

function parseDeliveryReceiptAuthority(contents: string, number: number): DeliveryReceiptAuthority {
    let value: unknown;
    try {
        value = parseJsonWithoutDuplicateMembers<unknown>(contents);
    } catch {
        fail(`PR #${number} delivery receipt authority is malformed`);
    }
    if (typeof value !== 'object' || value === null) {
        fail(`PR #${number} delivery receipt authority is malformed`);
    }
    const authority = value as Record<string, unknown>;
    if (
        Object.keys(authority).length === 2 &&
        authority.version === 1 &&
        typeof authority.receiptId === 'string' &&
        authority.receiptId !== ''
    ) {
        return { version: 1, receiptId: authority.receiptId };
    }
    const keys = Object.keys(authority);
    if (
        !keys.includes('version') ||
        authority.version !== 2 ||
        !keys.includes('phase') ||
        (authority.phase !== 'released' &&
            authority.phase !== 'prepared' &&
            authority.phase !== 'merge-authorized' &&
            authority.phase !== 'terminal') ||
        !keys.includes('receiptId') ||
        typeof authority.receiptId !== 'string' ||
        authority.receiptId === '' ||
        keys.some((key) => !['version', 'phase', 'receiptId', 'receiptBody', 'postMergeValidation'].includes(key))
    ) {
        fail(`PR #${number} delivery receipt authority is malformed`);
    }
    if (
        authority.receiptBody !== undefined &&
        (typeof authority.receiptBody !== 'string' || authority.receiptBody === '')
    ) {
        fail(`PR #${number} delivery receipt authority is malformed`);
    }
    if (authority.phase === 'released' && authority.postMergeValidation !== undefined) {
        fail(`PR #${number} delivery receipt authority is malformed`);
    }
    if (
        authority.postMergeValidation !== undefined &&
        !isPersistedPreparedPostMergeValidation(authority.postMergeValidation)
    ) {
        fail(`PR #${number} delivery receipt authority is malformed`);
    }
    const receiptBody = typeof authority.receiptBody === 'string' ? authority.receiptBody : undefined;
    const postMergeValidation =
        authority.phase !== 'released' && isPersistedPreparedPostMergeValidation(authority.postMergeValidation)
            ? authority.postMergeValidation
            : undefined;
    return {
        version: 2,
        phase: authority.phase,
        receiptId: authority.receiptId,
        ...(receiptBody === undefined ? {} : { receiptBody }),
        ...(postMergeValidation === undefined ? {} : { postMergeValidation }),
    };
}

function writeDeliveryReceiptAuthorityBlob(
    primaryRoot: string,
    authority: DeliveryReceiptAuthority,
    number: number
): string {
    const result = deliveryLockGit(primaryRoot, ['hash-object', '-w', '--stdin'], JSON.stringify(authority));
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail(`PR #${number} delivery receipt authority could not be stored`);
    }
    return deliveryObjectId(result.stdout, `PR #${number} delivery receipt authority object identity is malformed`);
}

function readOptionalDeliveryRefOid(
    primaryRoot: string,
    ref: string,
    number: number,
    label: string
): string | undefined {
    const refPath = deliveryLockGit(primaryRoot, ['rev-parse', '--git-path', ref]);
    if (refPath.error !== undefined) {
        throw refPath.error;
    }
    if (refPath.status !== 0) {
        fail(`PR #${number} ${label} cannot be verified`);
    }
    const exactRefPath = resolve(primaryRoot, refPath.stdout.trim());
    let exactPathKind: 'missing' | 'directory' | 'regular' = 'missing';
    let refStats: ReturnType<typeof lstatSync> | undefined;
    try {
        refStats = lstatSync(exactRefPath);
    } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
            throw error;
        }
        exactPathKind = 'missing';
    }
    if (refStats !== undefined) {
        if (refStats.isDirectory()) {
            exactPathKind = 'directory';
        } else if (refStats.isFile()) {
            exactPathKind = 'regular';
        } else {
            fail(`PR #${number} ${label} cannot be verified`);
        }
    }
    const result = deliveryLockGit(primaryRoot, [
        'for-each-ref',
        '--format=%(refname)%00%(objectname)%00%(symref)',
        '--',
        ref,
    ]);
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail(`PR #${number} ${label} cannot be verified`);
    }
    const entries = result.stdout
        .split('\n')
        .filter((entry) => entry.length > 0)
        .map((entry) => entry.split('\u0000'));
    if (entries.length > 1) {
        fail(`PR #${number} ${label} cannot be verified`);
    }
    const entry = entries[0];
    if (entry !== undefined) {
        if (exactPathKind === 'directory') {
            fail(`PR #${number} ${label} cannot be verified`);
        }
        const [resolvedRef = '', oid = '', symref = ''] = entry;
        if (resolvedRef !== ref) {
            fail(`PR #${number} ${label} cannot be verified`);
        }
        if (symref !== '') {
            fail(`PR #${number} ${label} cannot be verified`);
        }
        return deliveryObjectId(oid, `PR #${number} ${label} object identity is malformed`);
    }
    if (exactPathKind !== 'missing' && exactPathKind !== 'directory') {
        fail(`PR #${number} ${label} cannot be verified`);
    }
    return undefined;
}

function readDeliveryReceiptAuthorityBlob(primaryRoot: string, oid: string, number: number): DeliveryReceiptAuthority {
    const type = deliveryLockGit(primaryRoot, ['cat-file', '-t', oid]);
    if (type.error !== undefined) {
        throw type.error;
    }
    if (type.status !== 0 || type.stdout.trim() !== 'blob') {
        fail(`PR #${number} delivery receipt authority cannot be verified`);
    }
    const result = deliveryLockGit(primaryRoot, ['cat-file', 'blob', oid]);
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail(`PR #${number} delivery receipt authority cannot be verified`);
    }
    return parseDeliveryReceiptAuthority(result.stdout, number);
}

function updateDeliveryLockRef(primaryRoot: string, args: string[]): boolean {
    const result = deliveryLockGit(primaryRoot, ['update-ref', ...args]);
    if (result.error !== undefined) {
        throw result.error;
    }
    return result.status === 0;
}

function toPersistedDeliveryReceiptAuthority(authority: DeliveryReceiptAuthority): PersistedDeliveryReceiptAuthority {
    if (authority.version === 1) {
        return { phase: 'legacy', receiptId: authority.receiptId };
    }
    return {
        phase: authority.phase,
        receiptId: authority.receiptId,
        ...(authority.receiptBody === undefined ? {} : { receiptBody: authority.receiptBody }),
        ...(authority.phase === 'released' || authority.postMergeValidation === undefined
            ? {}
            : { postMergeValidation: authority.postMergeValidation }),
    };
}

function readDeliveryReceiptAuthority(
    primaryRoot: string,
    number: number
): PersistedDeliveryReceiptAuthority | undefined {
    return readDeliveryReceiptAuthorityEntry(primaryRoot, number)?.authority;
}

function readDeliveryReceiptAuthorityEntry(
    primaryRoot: string,
    number: number
): { oid: string; authority: PersistedDeliveryReceiptAuthority } | undefined {
    const oid = readOptionalDeliveryRefOid(
        primaryRoot,
        deliveryReceiptAuthorityRef(number),
        number,
        'delivery receipt authority'
    );
    if (oid === undefined) {
        return undefined;
    }
    return {
        oid,
        authority: toPersistedDeliveryReceiptAuthority(readDeliveryReceiptAuthorityBlob(primaryRoot, oid, number)),
    };
}

function writeDeliveryReceiptAuthority(
    primaryRoot: string,
    number: number,
    authority: PersistedDeliveryReceiptAuthority,
    expectedCurrent?: DeliveryReceiptAuthorityExpectation
): void {
    if (!isCurrentPersistedDeliveryReceiptAuthority(authority)) {
        fail(`PR #${number} delivery receipt authority is malformed`);
    }
    if (authority.receiptId === '') {
        fail(`PR #${number} delivery receipt authority is malformed`);
    }
    if (authority.receiptBody !== undefined && authority.receiptBody === '') {
        fail(`PR #${number} delivery receipt authority is malformed`);
    }
    const stored: StoredCurrentDeliveryReceiptAuthority = {
        version: 2,
        phase: authority.phase,
        receiptId: authority.receiptId,
        ...(authority.receiptBody === undefined ? {} : { receiptBody: authority.receiptBody }),
        ...(authority.phase === 'released' || authority.postMergeValidation === undefined
            ? {}
            : { postMergeValidation: authority.postMergeValidation }),
    };
    const current = readDeliveryReceiptAuthorityEntry(primaryRoot, number);
    if (
        expectedCurrent !== undefined &&
        !matchesDeliveryReceiptAuthorityExpectation(current?.authority, expectedCurrent)
    ) {
        fail(`PR #${number} delivery receipt authority could not be stored`);
    }
    if (samePersistedDeliveryReceiptAuthority(current?.authority, authority)) {
        return;
    }
    const oid = writeDeliveryReceiptAuthorityBlob(primaryRoot, stored, number);
    const expectedOldOid = current?.oid ?? '0'.repeat(oid.length);
    if (!updateDeliveryLockRef(primaryRoot, ['--no-deref', deliveryReceiptAuthorityRef(number), oid, expectedOldOid])) {
        fail(`PR #${number} delivery receipt authority could not be stored`);
    }
    const verified = readDeliveryReceiptAuthority(primaryRoot, number);
    if (!samePersistedDeliveryReceiptAuthority(verified, authority)) {
        fail(`PR #${number} delivery receipt authority could not be verified`);
    }
}

function clearDeliveryReceiptAuthority(
    primaryRoot: string,
    number: number,
    expectedCurrent?: DeliveryReceiptAuthorityExpectation
): void {
    const ref = deliveryReceiptAuthorityRef(number);
    const current = readDeliveryReceiptAuthorityEntry(primaryRoot, number);
    if (
        expectedCurrent !== undefined &&
        !matchesDeliveryReceiptAuthorityExpectation(current?.authority, expectedCurrent)
    ) {
        fail(`PR #${number} delivery receipt authority could not be cleared`);
    }
    if (current === undefined) {
        return;
    }
    if (!updateDeliveryLockRef(primaryRoot, ['--no-deref', '-d', ref, current.oid])) {
        fail(`PR #${number} delivery receipt authority could not be cleared`);
    }
    if (readDeliveryReceiptAuthority(primaryRoot, number) !== undefined) {
        fail(`PR #${number} delivery receipt authority could not be verified`);
    }
}

export type DeliverySerialization = PullRequestMutationSerialization;
export { withPullRequestMutationLock as withPullRequestDeliveryLock };

export type DeliveryCoordinatorDependencies = {
    primaryRoot: () => string;
    serializeDelivery: DeliverySerialization;
    authenticateAuthor: (primaryRoot: string) => Promise<DeliveryAuthentication>;
    authenticateTracker: (primaryRoot: string) => Promise<DeliveryAuthentication>;
    repositoryName: (session: DeliveryAuthentication['session'], primaryRoot: string) => string;
    deliveryPort: (
        repository: string,
        authentication: DeliveryAuthentication,
        primaryRoot: string,
        markRemoteMutationAttempt: PullRequestRemoteMutationBoundary['markRemoteMutationAttempt']
    ) => DeliveryPort;
    trackerPort: (session: DeliveryAuthentication['session']) => ReconcileTrackerIssuePort;
    completeIssue: (issueNumber: number, actorNodeId: string, port: ReconcileTrackerIssuePort) => void;
    deliver: (
        number: number,
        port: DeliveryPort,
        tracker: TrackerCompletionPort,
        markRemoteMutationKnownAbsent?: () => void
    ) => void;
};

function defaultDeliveryCoordinatorDependencies(cwd: string): DeliveryCoordinatorDependencies {
    return {
        primaryRoot: () => resolvePrimaryRoot(),
        serializeDelivery: withPullRequestMutationLock,
        authenticateAuthor: (primaryRoot) => authenticateRole({ primaryRoot, role: 'author' }),
        authenticateTracker: (primaryRoot) => authenticateTrackerAuthor({ primaryRoot }),
        repositoryName: (session, primaryRoot) =>
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: session.env,
                cwd: primaryRoot,
            }),
        deliveryPort: (repository, authentication, primaryRoot, markRemoteMutationAttempt) => {
            const shell: ShellRunner = {
                capture: (command, args) =>
                    spawnCapture(command, args, {
                        env:
                            command === 'git'
                                ? trustedDeliveryGitEnv(authentication.session.env)
                                : authentication.session.env,
                        cwd: primaryRoot,
                    }),
                run: (command, args) =>
                    spawnRun(command, args, {
                        env:
                            command === 'git'
                                ? trustedDeliveryGitEnv(authentication.session.env)
                                : authentication.session.env,
                        cwd: primaryRoot,
                    }),
            };
            return shellPort(repository, shell, {
                gitToken: authentication.minted.token,
                helperDir: authentication.session.configDir,
                primaryRoot,
                markRemoteMutationAttempt,
            });
        },
        trackerPort: (session) => trackerIssueShellPort(session, cwd),
        completeIssue: completeTrackerIssue,
        deliver: deliverPullRequest,
    };
}

function markTrackerMutationAttempts(
    port: ReconcileTrackerIssuePort,
    markRemoteMutationAttempt: PullRequestRemoteMutationBoundary['markRemoteMutationAttempt']
): ReconcileTrackerIssuePort {
    return {
        ...port,
        update: (number, input) => {
            markRemoteMutationAttempt();
            return port.update(number, input);
        },
        comment: (number, body) => {
            markRemoteMutationAttempt();
            return port.comment(number, body);
        },
    };
}

export async function coordinateDelivery(
    number: number,
    dependencies: DeliveryCoordinatorDependencies = defaultDeliveryCoordinatorDependencies(process.cwd())
): Promise<void> {
    const primaryRoot = dependencies.primaryRoot();
    await dependencies.serializeDelivery(
        primaryRoot,
        number,
        async ({ markRemoteMutationAttempt, markRemoteMutationKnownAbsent }) => {
            const authorAuth = await dependencies.authenticateAuthor(primaryRoot);
            let trackerAuth: DeliveryAuthentication | undefined;
            try {
                if (!isAuthorBotNodeId(authorAuth.minted.actorNodeId)) {
                    fail(`minted actor ${authorAuth.minted.actorNodeId} is not ${AUTHOR_BOT_NODE_ID}`);
                }
                const repository = dependencies.repositoryName(authorAuth.session, primaryRoot);
                assertRequiredRepository(repository);
                const authenticatedTracker = await dependencies.authenticateTracker(primaryRoot);
                trackerAuth = authenticatedTracker;
                const trackerPort = markTrackerMutationAttempts(
                    dependencies.trackerPort(authenticatedTracker.session),
                    markRemoteMutationAttempt
                );
                dependencies.deliver(
                    number,
                    dependencies.deliveryPort(repository, authorAuth, primaryRoot, markRemoteMutationAttempt),
                    {
                        complete: (issueNumber) =>
                            dependencies.completeIssue(
                                issueNumber,
                                authenticatedTracker.minted.actorNodeId,
                                trackerPort
                            ),
                    },
                    markRemoteMutationKnownAbsent
                );
            } finally {
                trackerAuth?.session.dispose();
                authorAuth.session.dispose();
            }
        }
    );
}

export type DeliverCliTrustedDependencies = {
    trustedLauncher?: DeliveryLockRecoveryTrustedLauncher;
    recovery?: DeliveryLockRecoveryDependencies;
};

export type DeliverCliDependencies = DeliveryCoordinatorDependencies | DeliverCliTrustedDependencies;

function isDeliveryCoordinatorDependencies(
    dependencies: DeliverCliDependencies | undefined
): dependencies is DeliveryCoordinatorDependencies {
    return dependencies !== undefined && 'primaryRoot' in dependencies;
}

function recoveryDependencies(
    dependencies: DeliverCliDependencies | undefined
): DeliveryLockRecoveryDependencies | undefined {
    if (dependencies === undefined || isDeliveryCoordinatorDependencies(dependencies)) {
        return undefined;
    }
    return dependencies.recovery ?? { trustedLauncher: dependencies.trustedLauncher };
}

export async function runDeliverCli(args: string[], dependencies?: DeliverCliDependencies): Promise<number> {
    const parsed = parseCliArgs(args);
    if (parsed.help) {
        console.log(DELIVER_USAGE);
        return 0;
    }
    if (parsed.recoverLockArgs !== undefined) {
        return runRecoverDeliveryLockCli(parsed.recoverLockArgs, recoveryDependencies(dependencies));
    }
    if (parsed.number === undefined) {
        fail('usage: pnpm deliver <pr-number>');
    }
    await coordinateDelivery(parsed.number, isDeliveryCoordinatorDependencies(dependencies) ? dependencies : undefined);
    return 0;
}
