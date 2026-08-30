#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

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
import { shellPort as trackerIssueShellPort } from './reconcileTrackerIssue.ts';
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
};

export type DeliveryPort = CheckEvidencePort & {
    fetch: () => void;
    pullRequest: (number: number) => PullRequestSnapshot;
    reviewState: (number: number, expectedHead: string) => ReviewState;
    dependents: (baseBranch: string) => StackedPullRequest[];
    repositoryDeletesMergedBranches: () => boolean;
    merge: (number: number, expectedHead: string, hasDependents: boolean) => void;
    retarget: (number: number, baseBranch: string) => void;
    deliveryReceipts: (number: number) => DeliveryReceiptComment[];
    addDeliveryReceipt: (number: number, body: string) => DeliveryReceiptComment;
    log: (message: string) => void;
};

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
const STRUCTURAL_MERGEABILITY_REFRESH_LIMIT = 1;

type CiAdmissionMode = 'advisory' | 'required';

const ACTIVE_CI_ADMISSION_MODE: CiAdmissionMode = 'advisory';

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
        return;
    }
    validateRequiredCiAdmission(pullRequest, checks);
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

function resolveStructuralMergeability(
    initial: PullRequestSnapshot,
    port: Pick<DeliveryPort, 'pullRequest'>
): PullRequestSnapshot {
    let pullRequest = initial;
    if (pullRequest.state === 'MERGED') {
        return pullRequest;
    }
    for (
        let refreshes = 0;
        pullRequest.state !== 'MERGED' &&
        pullRequest.mergeable === 'UNKNOWN' &&
        refreshes < STRUCTURAL_MERGEABILITY_REFRESH_LIMIT;
        refreshes += 1
    ) {
        pullRequest = port.pullRequest(initial.number);
        validateStablePullRequest(initial, pullRequest);
        if (pullRequest.state === 'MERGED') {
            return pullRequest;
        }
    }
    if (pullRequest.state === 'MERGED') {
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
 * drop a real failure out of the evidence — the one direction this rule must never move. Health
 * gates no longer subscribe to `pull_request_review`, so this repository no longer mints that skip
 * itself; a skipped later attempt from any other path would still be the same shape. Were a skip
 * allowed to retire, it would stamp a fresh non-verdict over a genuine failing execution and the
 * head would merge.
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
type WorkflowJob = { name?: unknown; needs?: unknown; uses?: unknown };
type WorkflowJobs = Record<string, WorkflowJob>;

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
    const jobs = workflowJobs(serialized);
    const gate = jobs[GATE_JOB_ID];
    if (gate === undefined) {
        fail(
            `${HEALTH_GATES_WORKFLOW_PATH} declares no ${GATE_JOB_ID} job, ` +
                `so no check can be proven to gate the merge`
        );
    }
    return new Set(gateNeeds(gate.needs).map((jobId) => requiredCheckName(jobId, jobs)));
}

function workflowJobs(serialized: string): WorkflowJobs {
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
    const jobs = summary.jobs;
    if (!isRecord(jobs)) {
        failUnreadableWorkflow(`${GATE_WORKFLOW_ENV} carries no jobs mapping`);
    }
    // Every job id here is workflow-controlled text, so a plain object literal would let one resolve
    // against `Object.prototype`: `__proto__` moves the prototype rather than becoming an own key,
    // and `toString` or `constructor` answers a lookup no job declares. A prototype-free map is the
    // only one where "the workflow declares this job" and "this key reads back" are the same claim.
    const declared: WorkflowJobs = Object.create(null) as WorkflowJobs;
    for (const [jobId, job] of Object.entries(jobs)) {
        if (!isRecord(job)) {
            failUnreadableWorkflow(`the ${jobId} job is not a mapping`);
        }
        declared[jobId] = job;
    }
    return declared;
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
 * The name GitHub labels a job's check with, or a refusal where this gate cannot produce it. A
 * matrix name is a template GitHub substitutes per shard, and a reusable workflow reports one check
 * per inner job as `<job name> / <inner job name>` — in both cases the declared name matches no
 * check on the head, so it would silently match nothing and tolerate every real cancellation. Both
 * refuse instead. The matrix refusal is recorded as issue #2924.
 */
function requiredCheckName(jobId: string, jobs: WorkflowJobs): string {
    const job = jobs[jobId];
    if (job === undefined) {
        fail(
            `the ${GATE_JOB_ID} job in ${HEALTH_GATES_WORKFLOW_PATH} needs ${jobId}, ` +
                `which no job in that workflow defines`
        );
    }
    if (job.uses !== undefined && job.uses !== null) {
        fail(
            `the ${jobId} job in ${HEALTH_GATES_WORKFLOW_PATH} calls a reusable workflow, ` +
                `whose checks GitHub reports as one name per inner job rather than the one name this gate derives`
        );
    }
    const name = declaredCheckName(jobId, job.name);
    if (name.includes(EXPRESSION_OPENER)) {
        fail(
            `the ${jobId} job in ${HEALTH_GATES_WORKFLOW_PATH} names its check ${name}, ` +
                `which GitHub substitutes per matrix job before reporting it`
        );
    }
    return name;
}

/** A job that declares no name is labelled with its job id, which is what GitHub reports for it. */
function declaredCheckName(jobId: string, name: unknown): string {
    if (name === undefined || name === null || name === '') {
        return jobId;
    }
    if (typeof name !== 'string') {
        fail(
            `the ${jobId} job in ${HEALTH_GATES_WORKFLOW_PATH} declares a name that is not text, ` +
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
    const fields: Array<keyof PullRequestSnapshot> = ['headRefOid', 'headRefName', 'baseRefName', 'body'];
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

function validatePostMergeSnapshot(
    authorized: PullRequestSnapshot,
    merged: PullRequestSnapshot,
    number: number,
    expectedTrackerTarget: number | undefined
): void {
    validateAuthorAppMerger(merged);
    validateBaseBranch(merged);
    validateStableTrackerTarget(number, expectedTrackerTarget, trackerCompletionTarget(merged));
    validateStablePullRequest(authorized, merged);
}

function expectedDeliveryReceipt(
    pullRequest: PullRequestSnapshot,
    closingIssue: number | undefined
): DeliveryReceiptPayload {
    return {
        pullRequest: pullRequest.number,
        head: pullRequest.headRefOid,
        bodySha256: createHash('sha256')
            .update(pullRequest.body ?? '')
            .digest('hex'),
        closingIssue,
    };
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
    for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1];
        const current = ordered[index];
        if (previous === undefined || current === undefined) {
            fail(`PR #${pullRequest.number} has an invalid delivery receipt lineage`);
        }
        if (previous.body === current.body) {
            fail(`PR #${pullRequest.number} has duplicate delivery receipts`);
        }
    }
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
    if (comment.body !== composeDeliveryReceipt(expected)) {
        fail(`PR #${pullRequest.number} has an invalid delivery receipt`);
    }
    return payload;
}

function newestDeliveryReceipt(lineage: DeliveryReceiptComment[], pullRequestNumber: number): DeliveryReceiptComment {
    const receipt = lineage.at(-1);
    if (receipt === undefined) {
        fail(`PR #${pullRequestNumber} has no delivery receipt for its current head`);
    }
    return receipt;
}

function readDeliveryReceipt(pullRequest: PullRequestSnapshot, port: DeliveryPort): DeliveryReceiptPayload {
    const lineage = orderedDeliveryReceiptLineage(port.deliveryReceipts(pullRequest.number), pullRequest);
    return assertDeliveryReceiptForHead(newestDeliveryReceipt(lineage, pullRequest.number), pullRequest);
}

function validateStableDeliveryReceipt(
    number: number,
    expected: DeliveryReceiptPayload,
    recovered: DeliveryReceiptPayload
): void {
    if (composeDeliveryReceipt(expected) !== composeDeliveryReceipt(recovered)) {
        fail(`PR #${number} delivery receipt changed during delivery`);
    }
}

function ensureDeliveryReceipt(
    pullRequest: PullRequestSnapshot,
    closingIssue: number | undefined,
    port: DeliveryPort
): DeliveryReceiptPayload {
    const expected = expectedDeliveryReceipt(pullRequest, closingIssue);
    const expectedBody = composeDeliveryReceipt(expected);
    const existing = orderedDeliveryReceiptLineage(port.deliveryReceipts(pullRequest.number), pullRequest);
    let receipt = existing.at(-1);
    if (receipt?.body !== expectedBody) {
        try {
            receipt = port.addDeliveryReceipt(pullRequest.number, expectedBody);
        } catch (error) {
            const recovered = orderedDeliveryReceiptLineage(port.deliveryReceipts(pullRequest.number), pullRequest).at(
                -1
            );
            if (recovered?.body !== expectedBody) {
                throw error;
            }
            receipt = recovered;
        }
    }
    if (receipt === undefined) {
        fail(`PR #${pullRequest.number} delivery receipt was not durably verified`);
    }
    assertCanonicalDeliveryReceipt(receipt, pullRequest, expected);
    const verified = orderedDeliveryReceiptLineage(port.deliveryReceipts(pullRequest.number), pullRequest).at(-1);
    if (verified === undefined || verified.id !== receipt.id || verified.body !== expectedBody) {
        fail(`PR #${pullRequest.number} delivery receipt was not durably verified`);
    }
    return assertCanonicalDeliveryReceipt(verified, pullRequest, expected);
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
    ciAdmissionMode: CiAdmissionMode
): void {
    port.fetch();
    const initial = resolveStructuralMergeability(port.pullRequest(number), port);
    if (initial.state === 'MERGED') {
        validateBaseBranch(initial);
        validateAuthorAppMerger(initial);
        const receipt = readDeliveryReceipt(initial, port);
        const remaining = port.dependents(initial.headRefName).filter((candidate) => candidate.number !== number);
        retargetDependents(remaining, initial.baseRefName, port);
        completeIssueAfterMerge(number, receipt.closingIssue, tracker);
        port.log(`PR #${number} was already merged; repaired ${remaining.length} remaining dependent(s)`);
        return;
    }
    validateBaseBranch(initial);
    const initialTrackerTarget = trackerCompletionTarget(initial);
    validatePullRequest(initial, port, ciAdmissionMode);
    validateReview(number, port.reviewState(number, initial.headRefOid));

    const dependents = port.dependents(initial.headRefName).filter((candidate) => candidate.number !== number);
    if (dependents.length > 0 && port.repositoryDeletesMergedBranches()) {
        fail('automatic merged-branch deletion must be disabled before delivering a stacked PR');
    }
    port.log(`review size: ${initial.changedFiles} file(s), +${initial.additions}/-${initial.deletions}`);

    const receipt = ensureDeliveryReceipt(initial, initialTrackerTarget, port);

    port.fetch();
    const finalSnapshot = resolveStructuralMergeability(port.pullRequest(number), port);
    if (finalSnapshot.state === 'MERGED') {
        validateAuthorAppMerger(finalSnapshot);
    }
    const finalTrackerTarget = trackerCompletionTarget(finalSnapshot);
    validateStableTrackerTarget(number, initialTrackerTarget, finalTrackerTarget);
    validateStablePullRequest(initial, finalSnapshot);
    if (finalSnapshot.state === 'MERGED') {
        validateBaseBranch(finalSnapshot);
        const recoveredReceipt = readDeliveryReceipt(finalSnapshot, port);
        validateStableDeliveryReceipt(number, receipt, recoveredReceipt);
        const finalDependents = port
            .dependents(finalSnapshot.headRefName)
            .filter((candidate) => candidate.number !== number);
        validateDependentSet(dependents, finalDependents);
        for (const dependent of finalDependents) {
            validateDependent(port.pullRequest(dependent.number), dependent);
        }
        retargetDependents(finalDependents, finalSnapshot.baseRefName, port);
        completeIssueAfterMerge(number, recoveredReceipt.closingIssue, tracker);
        port.log(`PR #${number} became merged during delivery; repaired ${finalDependents.length} dependent(s)`);
        return;
    }
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

    port.merge(number, finalSnapshot.headRefOid, finalDependents.length > 0);
    const mergedSnapshot = port.pullRequest(number);
    validatePostMergeSnapshot(finalSnapshot, mergedSnapshot, number, finalTrackerTarget);
    retargetDependents(finalDependents, finalSnapshot.baseRefName, port);
    completeIssueAfterMerge(number, receipt.closingIssue, tracker);
}

export function deliverPullRequest(number: number, port: DeliveryPort, tracker: TrackerCompletionPort): void {
    deliverPullRequestWithCiAdmission(number, port, tracker, ACTIVE_CI_ADMISSION_MODE);
}

/** Retained as the snapshot-backed cutover path if CI becomes merge-authoritative again. */
export function deliverPullRequestWithRequiredCi(
    number: number,
    port: DeliveryPort,
    tracker: TrackerCompletionPort
): void {
    deliverPullRequestWithCiAdmission(number, port, tracker, 'required');
}

function capture(command: string, args: string[]): string {
    const result = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8', shell: false });
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `${command} failed with exit ${result.status ?? 'signal'}`);
    }
    return result.stdout.trim();
}

function run(command: string, args: string[]): void {
    const result = spawnSync(command, args, { cwd: process.cwd(), stdio: 'inherit', shell: false });
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
    __typename?: unknown;
    name?: unknown;
    status?: unknown;
    conclusion?: unknown;
    startedAt?: unknown;
    context?: unknown;
    state?: unknown;
    createdAt?: unknown;
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
              ... on CheckRun{name status conclusion startedAt}
              ... on StatusContext{context state createdAt}
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
 * read through GraphQL instead, paged until the nodes account for `totalCount`, and refused when
 * they do not. A partial list is never merged over.
 */
function readHeadCheckRuns(pullRequestNumber: number, readPage: (cursor: string | null) => RollupPage): HeadCheckRun[] {
    let page = readPage(null);
    const nodes: unknown[] = [...page.nodes];
    while (page.pageInfo.hasNextPage && page.pageInfo.endCursor !== null && nodes.length < page.totalCount) {
        page = readPage(page.pageInfo.endCursor);
        nodes.push(...page.nodes);
    }
    if (nodes.length !== page.totalCount) {
        fail(`cannot read all ${page.totalCount} checks on PR #${pullRequestNumber}: got ${nodes.length}`);
    }
    return nodes.map((entry) => toHeadCheckRun(entry, pullRequestNumber));
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
function toHeadCheckRun(value: unknown, pullRequestNumber: number): HeadCheckRun {
    const entry = (value === null || typeof value !== 'object' ? {} : value) as RawRollupEntry;
    if (entry.__typename === 'CheckRun' && typeof entry.name === 'string' && typeof entry.status === 'string') {
        return {
            name: entry.name,
            status: entry.status,
            conclusion: typeof entry.conclusion === 'string' && entry.conclusion !== '' ? entry.conclusion : null,
            startedAt: reportedTimestamp(entry.startedAt),
        };
    }
    if (entry.__typename === 'StatusContext' && typeof entry.context === 'string' && typeof entry.state === 'string') {
        // A status context carries no start of its own; its creation is when the reporting integration
        // first spoke about this commit, which is the same ordering evidence for the same purpose.
        return toStatusContextCheckRun(entry.context, entry.state, reportedTimestamp(entry.createdAt));
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

export function shellPort(
    repository: string,
    shell: ShellRunner = { capture, run },
    options: { gitToken?: string; helperDir?: string } = {}
): DeliveryPort {
    const [owner, name] = repository.split('/');
    if (owner === undefined || name === undefined) {
        fail(`invalid GitHub repository: ${repository}`);
    }
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
        reviewState: (number, expectedHead) => {
            const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviews(last:100){nodes{state submittedAt author{login __typename ... on Bot{id}} commit{oid}} pageInfo{hasPreviousPage}} reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}}}}`;
            const response = parseJson<{
                data?: {
                    repository?: {
                        pullRequest?: {
                            reviews: {
                                nodes: Array<{
                                    state: string;
                                    submittedAt?: string | null;
                                    author: { id?: string; login: string; __typename: string } | null;
                                    commit: { oid: string } | null;
                                }>;
                                pageInfo: { hasPreviousPage: boolean };
                            };
                            reviewThreads: {
                                nodes: Array<{ isResolved: boolean }>;
                                pageInfo: { hasNextPage: boolean };
                            };
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
                    `owner=${owner}`,
                    '-f',
                    `name=${name}`,
                    '-F',
                    `number=${number}`,
                ]),
                'review query'
            );
            const review = response.data?.repository?.pullRequest;
            if (
                review === undefined ||
                review.reviews.pageInfo.hasPreviousPage ||
                review.reviewThreads.pageInfo.hasNextPage
            ) {
                fail(`cannot prove complete review state for PR #${number}`);
            }
            const onHead = review.reviews.nodes.filter(
                (candidate) =>
                    candidate.state !== 'DISMISSED' &&
                    candidate.state !== 'PENDING' &&
                    candidate.commit?.oid === expectedHead &&
                    candidate.author?.__typename === 'Bot' &&
                    isReviewerBotNodeId(candidate.author.id)
            );
            onHead.sort((left, right) => (left.submittedAt ?? '').localeCompare(right.submittedAt ?? ''));
            return {
                latestReviewerStateOnHead: onHead.at(-1)?.state ?? null,
                unresolvedThreads: review.reviewThreads.nodes.filter((thread) => !thread.isResolved).length,
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
        merge: (number, expectedHead, hasDependents) => {
            const policy = repositoryMergePolicy(repository, shell);
            if (hasDependents && policy.deletesMergedBranches) {
                fail('automatic merged-branch deletion must be disabled before delivering a stacked PR');
            }
            const result = parseJson<{ merged: boolean; message: string }>(
                shell.capture('gh', [
                    'api',
                    '--method',
                    'PUT',
                    `repos/${repository}/pulls/${number}/merge`,
                    '-f',
                    `sha=${expectedHead}`,
                    '-f',
                    `merge_method=${policy.method}`,
                ]),
                'merge request'
            );
            if (!result.merged) {
                fail(`PR #${number} was not merged: ${result.message}`);
            }
        },
        retarget: (number, baseBranch) =>
            shell.run('gh', [
                'api',
                '--method',
                'PATCH',
                `repos/${repository}/pulls/${number}`,
                '-f',
                `base=${baseBranch}`,
                '--silent',
            ]),
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
        addDeliveryReceipt: (number, body) =>
            toDeliveryReceiptComment(
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
            ),
        log: (message) => console.log(message),
    };
}

export function parseCliArgs(args: string[]): { number?: number; help: boolean } {
    if (args[0] === '--help') {
        if (args.length !== 1) {
            fail('--help takes no other arguments');
        }
        return { help: true };
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

type DeliveryLockOwner = {
    version: 1;
    pid: number;
    token: string;
};

export type DeliverySerialization = <Value>(
    primaryRoot: string,
    number: number,
    operation: () => Promise<Value>
) => Promise<Value>;

const DELIVERY_LOCK_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function deliveryLockRef(number: number): string {
    if (!Number.isSafeInteger(number) || number <= 0) {
        fail('delivery lock requires a positive pull-request number');
    }
    return `refs/sourdaw/delivery/pr-${number}`;
}

function deliveryLockGit(primaryRoot: string, args: string[], input?: string) {
    return spawnSync('git', args, {
        cwd: primaryRoot,
        encoding: 'utf8',
        shell: false,
        ...(input === undefined ? {} : { input }),
    });
}

function parseDeliveryLockOwner(contents: string, number: number): DeliveryLockOwner {
    let value: unknown;
    try {
        value = JSON.parse(contents) as unknown;
    } catch {
        fail(`PR #${number} delivery lock ownership is malformed`);
    }
    if (
        typeof value !== 'object' ||
        value === null ||
        Object.keys(value).length !== 3 ||
        !('version' in value) ||
        value.version !== 1 ||
        !('pid' in value) ||
        typeof value.pid !== 'number' ||
        !Number.isSafeInteger(value.pid) ||
        value.pid <= 0 ||
        !('token' in value) ||
        typeof value.token !== 'string' ||
        !DELIVERY_LOCK_TOKEN_PATTERN.test(value.token)
    ) {
        fail(`PR #${number} delivery lock ownership is malformed`);
    }
    return { version: 1, pid: value.pid, token: value.token };
}

function deliveryLockObjectId(value: string, number: number): string {
    const oid = value.trim();
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(oid)) {
        fail(`PR #${number} delivery lock object identity is malformed`);
    }
    return oid;
}

function writeDeliveryLockOwner(primaryRoot: string, owner: DeliveryLockOwner, number: number): string {
    const result = deliveryLockGit(primaryRoot, ['hash-object', '-w', '--stdin'], JSON.stringify(owner));
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail(`PR #${number} delivery lock owner could not be stored`);
    }
    return deliveryLockObjectId(result.stdout, number);
}

function readDeliveryLockOid(primaryRoot: string, ref: string, number: number): string | undefined {
    const result = deliveryLockGit(primaryRoot, ['show-ref', '--verify', '--hash', ref]);
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status === 1) {
        return undefined;
    }
    if (result.status !== 0) {
        fail(`PR #${number} delivery lock ownership cannot be verified`);
    }
    return deliveryLockObjectId(result.stdout, number);
}

function readDeliveryLockOwner(primaryRoot: string, oid: string, number: number): DeliveryLockOwner {
    const result = deliveryLockGit(primaryRoot, ['cat-file', 'blob', oid]);
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status !== 0) {
        fail(`PR #${number} delivery lock ownership cannot be verified`);
    }
    return parseDeliveryLockOwner(result.stdout, number);
}

function updateDeliveryLockRef(primaryRoot: string, args: string[]): boolean {
    const result = deliveryLockGit(primaryRoot, ['update-ref', ...args]);
    if (result.error !== undefined) {
        throw result.error;
    }
    return result.status === 0;
}

function acquireDeliveryLock(primaryRoot: string, number: number): { ref: string; oid: string } {
    const ref = deliveryLockRef(number);
    const owner: DeliveryLockOwner = { version: 1, pid: process.pid, token: randomUUID() };
    const oid = writeDeliveryLockOwner(primaryRoot, owner, number);
    if (updateDeliveryLockRef(primaryRoot, [ref, oid, '0'.repeat(oid.length)])) {
        return { ref, oid };
    }

    const previousOid = readDeliveryLockOid(primaryRoot, ref, number);
    if (previousOid === undefined) {
        fail(`PR #${number} delivery lock could not be acquired`);
    }
    const previousOwner = readDeliveryLockOwner(primaryRoot, previousOid, number);
    return fail(`PR #${number} is already being delivered by process ${previousOwner.pid}`);
}

function releaseDeliveryLock(primaryRoot: string, ref: string, oid: string, number: number): void {
    if (!updateDeliveryLockRef(primaryRoot, ['-d', ref, oid])) {
        fail(`PR #${number} delivery lock ownership changed before release`);
    }
}

export async function withPullRequestDeliveryLock<Value>(
    primaryRoot: string,
    number: number,
    operation: () => Promise<Value>
): Promise<Value> {
    const lock = acquireDeliveryLock(primaryRoot, number);
    try {
        return await operation();
    } finally {
        releaseDeliveryLock(primaryRoot, lock.ref, lock.oid, number);
    }
}

export type DeliveryCoordinatorDependencies = {
    primaryRoot: () => string;
    serializeDelivery: DeliverySerialization;
    authenticateAuthor: (primaryRoot: string) => Promise<DeliveryAuthentication>;
    authenticateTracker: (primaryRoot: string) => Promise<DeliveryAuthentication>;
    repositoryName: (session: DeliveryAuthentication['session'], primaryRoot: string) => string;
    deliveryPort: (repository: string, authentication: DeliveryAuthentication, primaryRoot: string) => DeliveryPort;
    trackerPort: (session: DeliveryAuthentication['session']) => ReconcileTrackerIssuePort;
    completeIssue: (issueNumber: number, actorNodeId: string, port: ReconcileTrackerIssuePort) => void;
    deliver: (number: number, port: DeliveryPort, tracker: TrackerCompletionPort) => void;
};

function defaultDeliveryCoordinatorDependencies(cwd: string): DeliveryCoordinatorDependencies {
    return {
        primaryRoot: () => resolvePrimaryRoot(),
        serializeDelivery: withPullRequestDeliveryLock,
        authenticateAuthor: (primaryRoot) => authenticateRole({ primaryRoot, role: 'author' }),
        authenticateTracker: (primaryRoot) => authenticateTrackerAuthor({ primaryRoot }),
        repositoryName: (session, primaryRoot) =>
            spawnCapture('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
                env: session.env,
                cwd: primaryRoot,
            }),
        deliveryPort: (repository, authentication, primaryRoot) => {
            const shell: ShellRunner = {
                capture: (command, args) =>
                    spawnCapture(command, args, { env: authentication.session.env, cwd: primaryRoot }),
                run: (command, args) => spawnRun(command, args, { env: authentication.session.env, cwd: primaryRoot }),
            };
            return shellPort(repository, shell, {
                gitToken: authentication.minted.token,
                helperDir: authentication.session.configDir,
            });
        },
        trackerPort: (session) => trackerIssueShellPort(session, cwd),
        completeIssue: completeTrackerIssue,
        deliver: deliverPullRequest,
    };
}

export async function coordinateDelivery(
    number: number,
    dependencies: DeliveryCoordinatorDependencies = defaultDeliveryCoordinatorDependencies(process.cwd())
): Promise<void> {
    const primaryRoot = dependencies.primaryRoot();
    await dependencies.serializeDelivery(primaryRoot, number, async () => {
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
            const trackerPort = dependencies.trackerPort(authenticatedTracker.session);
            dependencies.deliver(number, dependencies.deliveryPort(repository, authorAuth, primaryRoot), {
                complete: (issueNumber) =>
                    dependencies.completeIssue(issueNumber, authenticatedTracker.minted.actorNodeId, trackerPort),
            });
        } finally {
            trackerAuth?.session.dispose();
            authorAuth.session.dispose();
        }
    });
}

export async function runDeliverCli(args: string[], dependencies?: DeliveryCoordinatorDependencies): Promise<number> {
    const parsed = parseCliArgs(args);
    if (parsed.help) {
        console.log('Usage: pnpm deliver <pr-number>');
        return 0;
    }
    if (parsed.number === undefined) {
        fail('usage: pnpm deliver <pr-number>');
    }
    await coordinateDelivery(parsed.number, dependencies);
    return 0;
}
