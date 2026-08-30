#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';

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
    deliveryReceiptProof: (number: number) => DeliveryReceiptProof;
    addDeliveryReceipt: (number: number, body: string) => DeliveryReceiptComment;
    readDeliveryReceiptAuthority: (number: number) => PersistedDeliveryReceiptAuthority | undefined;
    writeDeliveryReceiptAuthority: (number: number, authority: PersistedDeliveryReceiptAuthority) => void;
    clearDeliveryReceiptAuthority: (number: number) => void;
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

export type DeliveryReceiptProof = {
    totalCount: number;
    latestCommentId: string | undefined;
    commentIds?: string[];
};

export type ShellRunner = {
    capture: (command: string, args: string[]) => string;
    run: (command: string, args: string[]) => void;
};

const REQUIRED_CHECK_NAME = 'Gate';
const SETTLED_CHECK_STATUS = 'COMPLETED';
const SUPERSEDED_CONCLUSION = 'CANCELLED';
const PASSING_CONCLUSION = 'SUCCESS';
/**
 * `SKIPPED` is a designed outcome: the workflow's path filters skip whole legs, and `Gate` is built
 * to pass on a skipped dependency. Nothing in it is designed to conclude `NEUTRAL`, which reports a
 * check that ran and reached no verdict — the same undecided state a cancellation with no success
 * beside it is refused for. An irreversible merge does not step over it.
 */
const NON_BLOCKING_CONCLUSIONS = new Set(['SUCCESS', 'SKIPPED']);
const CHECKS_PENDING_MERGE_STATE = 'UNSTABLE';
const STRUCTURAL_MERGEABILITY_REFRESH_LIMIT = 1;

type CiAdmissionMode = 'advisory' | 'required';

const ACTIVE_CI_ADMISSION_MODE: CiAdmissionMode = 'advisory';

export type DeliveryReceiptAuthorityPhase = 'released' | 'prepared' | 'merge-authorized' | 'terminal';

export class DeliveryMergeRejectedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DeliveryMergeRejectedError';
    }
}

function classifyGithubMergeRejection(number: number, error: unknown): DeliveryMergeRejectedError | undefined {
    const detail = error instanceof Error ? error.message : String(error);
    if (!/\bHTTP (403|404|405|409|422)\b/u.test(detail)) {
        return undefined;
    }
    return new DeliveryMergeRejectedError(`PR #${number} was not merged: ${detail}`);
}

export type PersistedPreparedPostMergeValidation = {
    headRefOid: string;
    headRefName: string;
    baseRefName: string;
    bodySha256: string;
    trackerTarget: number | null;
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

type CurrentPersistedTerminalDeliveryReceiptAuthority = CurrentPersistedDeliveryReceiptAuthorityBase & {
    phase: 'merge-authorized' | 'terminal';
};

type CurrentPersistedDeliveryReceiptAuthority =
    | CurrentPersistedReleasedDeliveryReceiptAuthority
    | CurrentPersistedPreparedDeliveryReceiptAuthority
    | CurrentPersistedTerminalDeliveryReceiptAuthority;

export type PersistedDeliveryReceiptAuthority =
    | LegacyPersistedDeliveryReceiptAuthority
    | CurrentPersistedReleasedDeliveryReceiptAuthority
    | CurrentPersistedPreparedDeliveryReceiptAuthority
    | CurrentPersistedTerminalDeliveryReceiptAuthority;

type StoredLegacyDeliveryReceiptAuthority = {
    version: 1;
    receiptId: string;
};

type StoredCurrentDeliveryReceiptAuthority =
    | ({ version: 2 } & CurrentPersistedReleasedDeliveryReceiptAuthority)
    | ({ version: 2 } & CurrentPersistedPreparedDeliveryReceiptAuthority)
    | ({ version: 2 } & CurrentPersistedTerminalDeliveryReceiptAuthority);

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
        current.phase === 'prepared' &&
        current.postMergeValidation !== undefined &&
        next.phase === 'prepared' &&
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
        return;
    }
    validateRequiredCiAdmission(pullRequest, checks);
}

/**
 * Push and approved-review runs still report on the same pull-request head, and GitHub can keep the
 * aggregate `UNSTABLE` when cancelled check runs remain on that head beside later successes on the
 * same commit. Tolerating that state means proving the head green here instead of trusting the
 * aggregate: nothing failed, nothing is still running, the one required check succeeded, and every
 * cancelled name also succeeded. Every other status still refuses, because it reports something
 * other than checks.
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
    const failed = checkRuns.find(isFailedCheckRun);
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

function bodySha256(body: string | null): string {
    return createHash('sha256')
        .update(body ?? '')
        .digest('hex');
}

function persistedPreparedPostMergeValidation(
    pullRequest: Pick<PullRequestSnapshot, 'headRefOid' | 'headRefName' | 'baseRefName' | 'body'>,
    trackerTarget: number | undefined
): PersistedPreparedPostMergeValidation {
    return {
        headRefOid: pullRequest.headRefOid,
        headRefName: pullRequest.headRefName,
        baseRefName: pullRequest.baseRefName,
        bodySha256: bodySha256(pullRequest.body),
        trackerTarget: trackerTarget ?? null,
    };
}

function validatePostMergeSnapshot(
    expected: PersistedPreparedPostMergeValidation,
    merged: PullRequestSnapshot,
    number: number
): void {
    validateAuthorAppMerger(merged);
    validateBaseBranch(merged);
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
    ciAdmissionMode: CiAdmissionMode
): DeliveryReceiptPayload {
    return {
        schemaVersion: 2,
        pullRequest: pullRequest.number,
        head: pullRequest.headRefOid,
        bodySha256: bodySha256(pullRequest.body),
        closingIssue,
        ciAdmissionMode,
        ...(ciAdmissionMode === 'advisory'
            ? { observedCiState: normalizeObservedCiState(pullRequest.mergeStateStatus) }
            : {}),
    };
}

function normalizeObservedCiState(mergeStateStatus: string): NonNullable<DeliveryReceiptPayload['observedCiState']> {
    if (mergeStateStatus === 'CLEAN') {
        return 'successful';
    }
    if (mergeStateStatus === 'BLOCKED') {
        return 'failed';
    }
    if (mergeStateStatus === 'UNKNOWN') {
        return 'pending';
    }
    if (mergeStateStatus === '') {
        return 'absent';
    }
    if (mergeStateStatus === CHECKS_PENDING_MERGE_STATE) {
        return 'unstable';
    }
    if (mergeStateStatus === 'UNAVAILABLE') {
        return 'unavailable';
    }
    return 'malformed';
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
            left?.phase === 'prepared' ? left.postMergeValidation : undefined,
            right.phase === 'prepared' ? right.postMergeValidation : undefined
        )
    );
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
            ...(next.postMergeValidation === undefined && current.postMergeValidation === undefined
                ? {}
                : { postMergeValidation: next.postMergeValidation ?? current.postMergeValidation }),
        };
    }
    return {
        phase: current.phase,
        receiptId: current.receiptId,
        ...(receiptBody === undefined ? {} : { receiptBody }),
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
    port.writeDeliveryReceiptAuthority(number, next);
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
        port.clearDeliveryReceiptAuthority(number);
        return;
    }
    if (samePersistedDeliveryReceiptAuthority(current, beforeArming)) {
        return;
    }
    port.writeDeliveryReceiptAuthority(number, beforeArming);
}

function shouldRestorePreArmedDeliveryReceiptAuthorityAfterFinalObservation(pullRequest: PullRequestSnapshot): boolean {
    return pullRequest.state === 'CLOSED' || (pullRequest.state === 'OPEN' && pullRequest.mergeable !== 'UNKNOWN');
}

function restorePreparedDeliveryReceiptAuthorityBeforeClosedRetry(number: number, port: DeliveryPort): void {
    const current = port.readDeliveryReceiptAuthority(number);
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
    let attemptedFinalSnapshotRead = false;

    try {
        port.fetch();
        attemptedFinalSnapshotRead = true;
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
            if (attemptedFinalSnapshotRead) {
                restorePreArmedDeliveryReceiptAuthority(number, beforeArming, armed, port);
                throw error;
            }
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
    restorePreArmedDeliveryReceiptAuthority(number, beforeArming, armed, port);
}

function persistMergeAuthorizedDeliveryReceiptAuthority(
    number: number,
    receipt: Pick<DeliveryReceiptComment, 'id' | 'body'>,
    port: DeliveryPort
): void {
    persistDeliveryReceiptAuthority(
        number,
        { phase: 'merge-authorized', receiptId: receipt.id, receiptBody: receipt.body },
        port
    );
}

function persistTerminalDeliveryReceiptAuthority(
    number: number,
    receipt: Pick<DeliveryReceiptComment, 'id' | 'body'>,
    port: DeliveryPort
): void {
    persistDeliveryReceiptAuthority(
        number,
        { phase: 'terminal', receiptId: receipt.id, receiptBody: receipt.body },
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
    if (proof.commentIds.length !== proof.totalCount) {
        fail(`PR #${number} delivery receipt authority cannot be proven`);
    }
    if (comments.length !== proof.totalCount) {
        fail(`PR #${number} delivery receipt authority cannot be proven`);
    }
    if (proof.totalCount === 0) {
        if (proof.latestCommentId !== undefined || proof.commentIds.length > 0) {
            fail(`PR #${number} delivery receipt authority cannot be proven`);
        }
        return;
    }
    if (
        proof.latestCommentId === undefined ||
        proof.commentIds.at(-1) !== proof.latestCommentId ||
        comments.at(-1)?.id !== proof.latestCommentId
    ) {
        fail(`PR #${number} delivery receipt authority cannot be proven`);
    }
    for (let index = 0; index < proof.commentIds.length; index += 1) {
        if (comments[index]?.id !== proof.commentIds[index]) {
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

function validatePreparedBodylessPersistedMergedRecoveryReceipt(
    pullRequest: Pick<PullRequestSnapshot, 'number'>,
    authority: CurrentPersistedPreparedDeliveryReceiptAuthority,
    payload: DeliveryReceiptPayload
): void {
    const validation = authority.postMergeValidation;
    if (validation === undefined) {
        fail(`PR #${pullRequest.number} delivery receipt authority is not merge-authorized`);
    }
    if (payload.schemaVersion === 1) {
        fail(`PR #${pullRequest.number} delivery receipt changed during recovery`);
    }
    validateReceiptPayloadAgainstPreparedPostMergeValidation(pullRequest.number, payload, validation, 'recovery');
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
        (lineage, _receipt, payload) => {
            compatibleBodylessPersistedMergedRecoveryReceipt(lineage, authority, pullRequest);
            if (authority.phase === 'prepared') {
                validatePreparedBodylessPersistedMergedRecoveryReceipt(pullRequest, authority, payload);
            }
        }
    );
}

function readStableMergedRecoveryReceipt(pullRequest: PullRequestSnapshot, port: DeliveryPort): DeliveryReceiptComment {
    const firstLineage = orderedDeliveryReceiptLineage(provenDeliveryReceiptComments(pullRequest, port), pullRequest);
    const first = newestLogicalDeliveryReceiptAuthority(firstLineage, pullRequest);
    const secondLineage = orderedDeliveryReceiptLineage(provenDeliveryReceiptComments(pullRequest, port), pullRequest);
    const second = newestLogicalDeliveryReceiptAuthority(secondLineage, pullRequest);
    if (first.id !== second.id) {
        fail(`PR #${pullRequest.number} delivery receipt changed during recovery`);
    }
    assertDeliveryReceiptForHead(second, pullRequest);
    return second;
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
            (_lineage, _receipt, payload) => {
                if (payload.schemaVersion !== 1) {
                    fail(`PR #${pullRequest.number} delivery receipt changed during recovery`);
                }
            }
        );
    }
    if (authority.phase === 'released') {
        fail(`PR #${pullRequest.number} delivery receipt authority cannot be proven`);
    }
    if (authority.phase === 'prepared' && authority.postMergeValidation === undefined) {
        fail(`PR #${pullRequest.number} delivery receipt authority cannot be proven`);
    }
    const preparedPostMergeValidation = authority.phase === 'prepared' ? authority.postMergeValidation : undefined;
    if (authority.phase === 'prepared') {
        if (preparedPostMergeValidation !== undefined) {
            validatePostMergeSnapshot(preparedPostMergeValidation, pullRequest, pullRequest.number);
        }
    }
    if (authority.receiptBody === undefined) {
        return readCompatibleBodylessPersistedMergedRecoveryReceipt(pullRequest, port, authority);
    }
    const receipt = readStableExactMergedRecoveryReceipt(pullRequest, port, authority.receiptId, () => undefined);
    if (receipt.body !== authority.receiptBody) {
        fail(`PR #${pullRequest.number} delivery receipt changed during recovery`);
    }
    if (preparedPostMergeValidation !== undefined) {
        validateReceiptPayloadAgainstPreparedPostMergeValidation(
            pullRequest.number,
            assertDeliveryReceiptForHead(receipt, pullRequest),
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
    const expected = expectedDeliveryReceipt(pullRequest, closingIssue, ciAdmissionMode);
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
    if (receipt === undefined && currentPersistedAuthority?.receiptBody === expectedBody) {
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
    ciAdmissionMode: CiAdmissionMode
): void {
    port.fetch();
    const rawInitial = port.pullRequest(number);
    if (rawInitial.state === 'CLOSED') {
        restorePreparedDeliveryReceiptAuthorityBeforeClosedRetry(number, port);
    }
    const initial = resolveStructuralMergeability(rawInitial, port);
    if (initial.state === 'CLOSED') {
        restorePreparedDeliveryReceiptAuthorityBeforeClosedRetry(number, port);
    }
    if (initial.state === 'MERGED') {
        validateBaseBranch(initial);
        validateAuthorAppMerger(initial);
        const receiptAuthority = port.readDeliveryReceiptAuthority(number);
        const receipt =
            receiptAuthority === undefined
                ? readStableMergedRecoveryReceipt(initial, port)
                : readPersistedMergedRecoveryReceipt(initial, port, receiptAuthority);
        const receiptPayload = assertDeliveryReceiptForHead(receipt, initial);
        if (receiptAuthority?.phase !== 'terminal') {
            persistMergeAuthorizedDeliveryReceiptAuthority(number, receipt, port);
        }
        const remaining = port.dependents(initial.headRefName).filter((candidate) => candidate.number !== number);
        retargetDependents(remaining, initial.baseRefName, port);
        completeIssueAfterMerge(number, receiptPayload.closingIssue, tracker);
        persistTerminalDeliveryReceiptAuthority(number, receipt, port);
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
        persistMergeAuthorizedDeliveryReceiptAuthority(number, recoveredReceipt, port);
        const finalDependents = port
            .dependents(finalSnapshot.headRefName)
            .filter((candidate) => candidate.number !== number);
        validateDependentSet(dependents, finalDependents);
        for (const dependent of finalDependents) {
            validateDependent(port.pullRequest(dependent.number), dependent);
        }
        retargetDependents(finalDependents, finalSnapshot.baseRefName, port);
        completeIssueAfterMerge(number, recoveredPayload.closingIssue, tracker);
        persistTerminalDeliveryReceiptAuthority(number, recoveredReceipt, port);
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
        port.merge(number, finalSnapshot.headRefOid, finalDependents.length > 0);
    } catch (error) {
        if (error instanceof DeliveryMergeRejectedError) {
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
    persistMergeAuthorizedDeliveryReceiptAuthority(number, finalReceipt, port);
    retargetDependents(finalDependents, finalSnapshot.baseRefName, port);
    completeIssueAfterMerge(number, finalReceiptPayload.closingIssue, tracker);
    persistTerminalDeliveryReceiptAuthority(number, finalReceipt, port);
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
    context?: unknown;
    state?: unknown;
};

type DeliveryReceiptProofResponse = {
    data?: {
        repository?: {
            pullRequest?: {
                comments?: {
                    totalCount?: unknown;
                    pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } | null;
                    nodes?: Array<{ id?: unknown } | null> | null;
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
              ... on CheckRun{name status conclusion}
              ... on StatusContext{context state}
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
        };
    }
    if (entry.__typename === 'StatusContext' && typeof entry.context === 'string' && typeof entry.state === 'string') {
        return toStatusContextCheckRun(entry.context, entry.state);
    }
    return fail(`cannot read a check on PR #${pullRequestNumber}`);
}

function toStatusContextCheckRun(name: string, state: string): HeadCheckRun {
    if (UNSETTLED_STATUS_CONTEXT_STATES.has(state)) {
        return { name, status: state, conclusion: null };
    }
    return { name, status: SETTLED_CHECK_STATUS, conclusion: state };
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
    const query = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){comments(first:${ROLLUP_PAGE_SIZE},after:$cursor){totalCount pageInfo{hasNextPage endCursor} nodes{id}}}}}`;
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
            commentIds: comments.nodes.map((comment) => {
                if (comment === null || comment === undefined || typeof comment.id !== 'string') {
                    fail(`cannot inspect delivery receipts for PR #${number}`);
                }
                return comment.id;
            }),
        };
    };
    let page = readPage(null);
    const commentIds = [...page.commentIds];
    while (page.pageInfo.hasNextPage && page.pageInfo.endCursor !== null && commentIds.length < page.totalCount) {
        page = readPage(page.pageInfo.endCursor);
        commentIds.push(...page.commentIds);
    }
    if (commentIds.length !== page.totalCount) {
        fail(`cannot inspect delivery receipts for PR #${number}`);
    }
    return {
        totalCount: page.totalCount,
        latestCommentId: commentIds.at(-1),
        commentIds,
    };
}

export function shellPort(
    repository: string,
    shell: ShellRunner = { capture, run },
    options: { gitToken?: string; helperDir?: string; primaryRoot?: string } = {}
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
            let response: string;
            try {
                response = shell.capture('gh', [
                    'api',
                    '--method',
                    'PUT',
                    `repos/${repository}/pulls/${number}/merge`,
                    '-f',
                    `sha=${expectedHead}`,
                    '-f',
                    `merge_method=${policy.method}`,
                ]);
            } catch (error) {
                const rejection = classifyGithubMergeRejection(number, error);
                if (rejection !== undefined) {
                    throw rejection;
                }
                throw error;
            }
            const result = parseJson<{ merged: boolean; message: string }>(response, 'merge request');
            if (!result.merged) {
                throw new DeliveryMergeRejectedError(`PR #${number} was not merged: ${result.message}`);
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
        deliveryReceiptProof: (number) => readDeliveryReceiptProofFromGithub(number, { owner, name }, shell),
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
        readDeliveryReceiptAuthority: (number) => readDeliveryReceiptAuthority(primaryRoot, number),
        writeDeliveryReceiptAuthority: (number, authority) =>
            writeDeliveryReceiptAuthority(primaryRoot, number, authority),
        clearDeliveryReceiptAuthority: (number) => clearDeliveryReceiptAuthority(primaryRoot, number),
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

type DeliveryReceiptAuthority = StoredDeliveryReceiptAuthority;

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

function deliveryReceiptAuthorityRef(number: number): string {
    if (!Number.isSafeInteger(number) || number <= 0) {
        fail('delivery receipt authority requires a positive pull-request number');
    }
    return `refs/sourdaw/delivery-receipt/pr-${number}`;
}

function deliveryLockGit(primaryRoot: string, args: string[], input?: string) {
    return spawnSync('git', args, {
        cwd: primaryRoot,
        encoding: 'utf8',
        shell: false,
        ...(input === undefined ? {} : { input }),
    });
}

function deliveryObjectId(value: string, invalidMessage: string): string {
    const oid = value.trim();
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(oid)) {
        fail(invalidMessage);
    }
    return oid;
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
    return deliveryObjectId(value, `PR #${number} delivery lock object identity is malformed`);
}

function isPersistedPreparedPostMergeValidation(value: unknown): value is PersistedPreparedPostMergeValidation {
    return (
        typeof value === 'object' &&
        value !== null &&
        Object.keys(value).length === 5 &&
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
    if (authority.phase !== 'prepared' && authority.postMergeValidation !== undefined) {
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
        authority.phase === 'prepared' && isPersistedPreparedPostMergeValidation(authority.postMergeValidation)
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

function readOptionalDeliveryRefOid(
    primaryRoot: string,
    ref: string,
    number: number,
    label: string
): string | undefined {
    const symbolic = deliveryLockGit(primaryRoot, ['symbolic-ref', '-q', '--', ref]);
    if (symbolic.error !== undefined) {
        throw symbolic.error;
    }
    if (symbolic.status === 0) {
        fail(`PR #${number} ${label} cannot be verified`);
    }
    if (symbolic.status !== 1) {
        fail(`PR #${number} ${label} cannot be verified`);
    }
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
    const result = deliveryLockGit(primaryRoot, ['show-ref', '--verify', '--hash', '--', ref]);
    if (result.error !== undefined) {
        throw result.error;
    }
    if (result.status === 0) {
        if (exactPathKind === 'directory') {
            fail(`PR #${number} ${label} cannot be verified`);
        }
        return deliveryObjectId(result.stdout, `PR #${number} ${label} object identity is malformed`);
    }
    if (exactPathKind === 'directory') {
        return undefined;
    }
    if (exactPathKind === 'missing' && /not a valid ref/u.test(result.stderr)) {
        return undefined;
    }
    if (result.status !== 1) {
        fail(`PR #${number} ${label} cannot be verified`);
    }
    if (!/not a valid ref/u.test(result.stderr)) {
        fail(`PR #${number} ${label} cannot be verified`);
    }
    fail(`PR #${number} ${label} cannot be verified`);
    return undefined;
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
        ...(authority.phase !== 'prepared' || authority.postMergeValidation === undefined
            ? {}
            : { postMergeValidation: authority.postMergeValidation }),
    };
}

function readDeliveryReceiptAuthority(
    primaryRoot: string,
    number: number
): PersistedDeliveryReceiptAuthority | undefined {
    const oid = readOptionalDeliveryRefOid(
        primaryRoot,
        deliveryReceiptAuthorityRef(number),
        number,
        'delivery receipt authority'
    );
    if (oid === undefined) {
        return undefined;
    }
    return toPersistedDeliveryReceiptAuthority(readDeliveryReceiptAuthorityBlob(primaryRoot, oid, number));
}

function writeDeliveryReceiptAuthority(
    primaryRoot: string,
    number: number,
    authority: PersistedDeliveryReceiptAuthority
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
        ...(authority.phase !== 'prepared' || authority.postMergeValidation === undefined
            ? {}
            : { postMergeValidation: authority.postMergeValidation }),
    };
    const oid = writeDeliveryReceiptAuthorityBlob(primaryRoot, stored, number);
    if (!updateDeliveryLockRef(primaryRoot, [deliveryReceiptAuthorityRef(number), oid])) {
        fail(`PR #${number} delivery receipt authority could not be stored`);
    }
    const verified = readDeliveryReceiptAuthority(primaryRoot, number);
    if (!samePersistedDeliveryReceiptAuthority(verified, authority)) {
        fail(`PR #${number} delivery receipt authority could not be verified`);
    }
}

function clearDeliveryReceiptAuthority(primaryRoot: string, number: number): void {
    const ref = deliveryReceiptAuthorityRef(number);
    const oid = readOptionalDeliveryRefOid(primaryRoot, ref, number, 'delivery receipt authority');
    if (oid === undefined) {
        return;
    }
    if (!updateDeliveryLockRef(primaryRoot, ['-d', ref, oid])) {
        fail(`PR #${number} delivery receipt authority could not be cleared`);
    }
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
                primaryRoot,
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
