#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

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
    mergeStateStatus: string;
    reviewDecision: string;
    changedFiles: number;
    additions: number;
    deletions: number;
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
/**
 * `SKIPPED` is a designed outcome: the workflow's path filters skip whole legs, and `Gate` is built
 * to pass on a skipped dependency. Nothing in it is designed to conclude `NEUTRAL`, which reports a
 * check that ran and reached no verdict — the same undecided state a cancellation with no success
 * beside it is refused for. An irreversible merge does not step over it.
 */
const NON_BLOCKING_CONCLUSIONS = new Set(['SUCCESS', 'SKIPPED']);
const CHECKS_PENDING_MERGE_STATE = 'UNSTABLE';

function validatePullRequest(pullRequest: PullRequestSnapshot, checks: CheckEvidencePort): void {
    if (pullRequest.state !== 'OPEN') {
        fail(`PR #${pullRequest.number} is ${pullRequest.state.toLowerCase()}`);
    }
    if (pullRequest.isDraft) {
        fail(`PR #${pullRequest.number} is still a draft`);
    }
    if (!TITLE_PATTERN.test(pullRequest.title)) {
        fail(`PR #${pullRequest.number} title is not conventional`);
    }
    validateMergeState(pullRequest, checks);
    if (pullRequest.reviewDecision === 'CHANGES_REQUESTED') {
        fail(`PR #${pullRequest.number} has requested changes`);
    }
}

/**
 * An approving review re-runs the health gates in the same concurrency group as the push run that
 * is still in flight, so that earlier run is cancelled and its check runs — its `Gate` included —
 * stay `CANCELLED` on the head forever. GitHub reports the head `UNSTABLE` for those corpses even
 * though the review-triggered run the branch ruleset reads succeeded on the same commit. Tolerating
 * that state means proving the head green here instead of trusting the aggregate: nothing failed,
 * nothing is still running, the one required check succeeded, and every cancelled name also
 * succeeded. Every other status still refuses, because it reports something other than checks.
 */
function validateMergeState(pullRequest: PullRequestSnapshot, checks: CheckEvidencePort): void {
    if (pullRequest.mergeStateStatus === 'CLEAN') {
        return;
    }
    if (pullRequest.mergeStateStatus !== CHECKS_PENDING_MERGE_STATE) {
        fail(`PR #${pullRequest.number} merge state is ${pullRequest.mergeStateStatus}`);
    }
    validateSupersededChecks(pullRequest, checks);
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
 * Tolerating a cancellation rests on the review-triggered run having re-run that same job on the
 * same commit, which is only observable as a success under the same check name. A name that was
 * cancelled and never succeeded on the head therefore carries no verdict at all, and a skipped
 * sibling does not supply one: the review-triggered run skips every job gated on `pull_request`,
 * `Gate` passes on `skipped`, so a green `Gate` says nothing about whether that job ran.
 * `Dependency review` has exactly this shape on an approval run — one cancellation, skips beside
 * it, no success anywhere. This rule consequently refuses such a head rather than merging with no
 * dependency-scan verdict, which is the honest outcome: an undecided scan is not a passing scan.
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
const JOB_INDENT = 2;
const JOB_FIELD_INDENT = 4;
const JOB_SEQUENCE_INDENT = 6;
const JOB_ID_PATTERN = /^([A-Za-z_][A-Za-z0-9_-]*):$/;
const SEQUENCE_ITEM_PREFIX = '- ';
const EXPRESSION_OPENER = '${{';

type WorkflowLine = { indent: number; text: string };
type WorkflowJobs = ReadonlyMap<string, readonly WorkflowLine[]>;

function failUnreadableWorkflowJobs(): never {
    return fail(`cannot read the jobs in ${HEALTH_GATES_WORKFLOW_PATH} to determine which checks gate the merge`);
}

/**
 * The delivery scripts execute from a snapshot directory that holds nothing but `scripts/`, so a
 * bare package specifier does not resolve there and the repository's YAML parser is out of reach at
 * the exact moment this runs. What the gate needs is one list and one field per named job, so this
 * reads that shape and nothing else — an indentation the file does not match is a shape this code
 * cannot claim to understand, and it refuses rather than guessing at a narrower answer.
 */
function workflowLines(source: string): WorkflowLine[] {
    return source
        .split('\n')
        .map((line) => line.replace(/\r$/, ''))
        .map((line) => ({ indent: line.length - line.trimStart().length, text: line.trim() }))
        .filter((line) => line.text !== '' && !line.text.startsWith('#'));
}

function jobsSection(lines: readonly WorkflowLine[]): readonly WorkflowLine[] {
    const start = lines.findIndex((line) => line.indent === 0 && line.text === 'jobs:');
    if (start < 0) {
        failUnreadableWorkflowJobs();
    }
    const body = lines.slice(start + 1);
    const end = body.findIndex((line) => line.indent === 0);
    return end < 0 ? body : body.slice(0, end);
}

function parseWorkflowJobs(source: string): WorkflowJobs {
    const jobs = new Map<string, WorkflowLine[]>();
    let current: WorkflowLine[] | undefined;
    for (const line of jobsSection(workflowLines(source))) {
        if (line.indent === JOB_INDENT) {
            const id = JOB_ID_PATTERN.exec(line.text)?.[1] ?? failUnreadableWorkflowJobs();
            current = [];
            jobs.set(id, current);
            continue;
        }
        if (line.indent < JOB_INDENT || current === undefined) {
            failUnreadableWorkflowJobs();
        }
        current.push(line);
    }
    return jobs;
}

/**
 * A check name that does not match what GitHub reports is worse than no name at all: it silently
 * matches nothing, and every cancellation under the real name is then tolerated. This reads the two
 * spellings a workflow uses for a name — plain and quoted — and refuses every other one rather than
 * handing back a string that only looks like a name. A block scalar, an anchor, an alias and a tag
 * all begin with a character no plain scalar may start with; an unquoted value carrying ` #` ends at
 * the comment; and an escape inside a double-quoted value is a spelling this reader cannot resolve.
 */
const UNREADABLE_SCALAR_PREFIXES = ['|', '>', '&', '*', '!'];
const PLAIN_SCALAR_COMMENT = ' #';

function failUnreadableScalar(text: string): never {
    return fail(`cannot read ${text} in ${HEALTH_GATES_WORKFLOW_PATH} as a plain or quoted scalar`);
}

function scalarValue(text: string): string {
    const trimmed = text.trim();
    const quote = trimmed.slice(0, 1);
    if ((quote === "'" || quote === '"') && trimmed.length > 1 && trimmed.endsWith(quote)) {
        return quotedScalarValue(trimmed, quote);
    }
    if (UNREADABLE_SCALAR_PREFIXES.includes(quote) || trimmed.includes(PLAIN_SCALAR_COMMENT)) {
        failUnreadableScalar(trimmed);
    }
    return trimmed;
}

function quotedScalarValue(trimmed: string, quote: string): string {
    const inner = trimmed.slice(1, -1);
    if (quote === "'") {
        return inner.replaceAll("''", "'");
    }
    if (inner.includes('\\')) {
        failUnreadableScalar(trimmed);
    }
    return inner;
}

function jobFieldValue(job: readonly WorkflowLine[], key: string): string | undefined {
    const field = job.find((line) => line.indent === JOB_FIELD_INDENT && line.text.startsWith(`${key}:`));
    return field === undefined ? undefined : scalarValue(field.text.slice(`${key}:`.length));
}

function flowSequenceItems(text: string): string[] {
    return text
        .slice(1, -1)
        .split(',')
        .map(scalarValue)
        .filter((item) => item !== '');
}

function blockSequenceItems(job: readonly WorkflowLine[], declaration: WorkflowLine): string[] {
    const items: string[] = [];
    for (const line of job.slice(job.indexOf(declaration) + 1)) {
        if (line.indent !== JOB_SEQUENCE_INDENT || !line.text.startsWith(SEQUENCE_ITEM_PREFIX)) {
            break;
        }
        items.push(scalarValue(line.text.slice(SEQUENCE_ITEM_PREFIX.length)));
    }
    return items;
}

function jobNeeds(job: readonly WorkflowLine[]): string[] {
    const declaration = job.find((line) => line.indent === JOB_FIELD_INDENT && line.text.startsWith('needs:'));
    if (declaration === undefined) {
        return [];
    }
    const inline = declaration.text.slice('needs:'.length).trim();
    if (inline === '') {
        return blockSequenceItems(job, declaration);
    }
    return inline.startsWith('[') && inline.endsWith(']') ? flowSequenceItems(inline) : [scalarValue(inline)];
}

/**
 * The name a job declares is a template, and GitHub reports one check per matrix job with the
 * expression substituted, so a matrix job's declared name matches no check GitHub ever reports and
 * every cancellation under a real shard name would pass unseen. Promoting such a job into the gate
 * refuses here rather than adding an entry that matches nothing.
 */
function requiredCheckName(jobId: string, jobs: WorkflowJobs): string {
    const job = jobs.get(jobId);
    if (job === undefined) {
        fail(
            `the ${GATE_JOB_ID} job in ${HEALTH_GATES_WORKFLOW_PATH} needs ${jobId}, ` +
                `which no job in that workflow defines`
        );
    }
    const name = jobFieldValue(job, 'name');
    if (name === undefined || name === '') {
        return jobId;
    }
    if (name.includes(EXPRESSION_OPENER)) {
        fail(
            `the ${jobId} job in ${HEALTH_GATES_WORKFLOW_PATH} names its check ${name}, ` +
                `which GitHub substitutes per matrix job before reporting it`
        );
    }
    return name;
}

/**
 * The names GitHub labels the checks that decide this merge with. Only `Gate` is required by the
 * ruleset, and `Gate` passes when each job it needs succeeded or was skipped, so the jobs in that
 * `needs` list are exactly the ones whose verdict the merge rests on. Deriving the list from the
 * workflow keeps a job promoted into the gate from silently escaping this gate, and a job that
 * never gated it from blocking one. A gate that cannot work out what it must check refuses.
 */
export function gateRequiredCheckNames(workflowSource: string): ReadonlySet<string> {
    const jobs = parseWorkflowJobs(workflowSource);
    const gate = jobs.get(GATE_JOB_ID);
    if (gate === undefined) {
        fail(
            `${HEALTH_GATES_WORKFLOW_PATH} declares no ${GATE_JOB_ID} job, ` +
                `so no check can be proven to gate the merge`
        );
    }
    const needs = jobNeeds(gate);
    if (needs.length === 0) {
        fail(
            `the ${GATE_JOB_ID} job in ${HEALTH_GATES_WORKFLOW_PATH} needs no job, ` +
                `so no check can be proven to gate the merge`
        );
    }
    return new Set(needs.map((jobId) => requiredCheckName(jobId, jobs)));
}

/**
 * Read from the primary checkout, because a lane's copy of the workflow is the very thing under
 * review and must not decide its own merge gate — and read as the git object at that checkout's
 * `HEAD`, because a working-tree file is not a pinned input: one stray uncommitted edit there would
 * silently reshape the gate for every delivery, in either direction. `HEAD:` is spelled out; the
 * bare `:path` form reads the index rather than the commit, and misresolves a path that looks like a
 * stage prefix.
 */
export function readGateRequiredCheckNames(
    repositoryRoot: string,
    shell: ShellRunner = { capture, run }
): ReadonlySet<string> {
    let source: string;
    try {
        source = shell.capture('git', ['-C', repositoryRoot, 'show', `HEAD:${HEALTH_GATES_WORKFLOW_PATH}`]);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        fail(`cannot read ${HEALTH_GATES_WORKFLOW_PATH} to determine which checks gate the merge: ${detail}`);
    }
    return gateRequiredCheckNames(source);
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

function deliveryReceiptCandidates(
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
        comment.createdAt !== comment.updatedAt ||
        payload.pullRequest !== pullRequestNumber
    ) {
        fail(`PR #${pullRequestNumber} has an invalid delivery receipt`);
    }
}

function assertCanonicalDeliveryReceipt(
    comment: DeliveryReceiptComment,
    pullRequest: Pick<PullRequestSnapshot, 'number' | 'headRefOid'>,
    expected?: DeliveryReceiptPayload
): DeliveryReceiptPayload {
    const payload = parseDeliveryReceipt(comment.body);
    if (payload === undefined) {
        fail(`PR #${pullRequest.number} has an invalid delivery receipt`);
    }
    assertOwnedDeliveryReceipt(comment, payload, pullRequest.number);
    if (
        payload.head !== pullRequest.headRefOid ||
        (expected !== undefined && comment.body !== composeDeliveryReceipt(expected))
    ) {
        fail(`PR #${pullRequest.number} has an invalid delivery receipt`);
    }
    return payload;
}

function readDeliveryReceipt(pullRequest: PullRequestSnapshot, port: DeliveryPort): DeliveryReceiptPayload {
    const candidates = deliveryReceiptCandidates(port.deliveryReceipts(pullRequest.number), pullRequest);
    const receipt = candidates[0];
    if (candidates.length !== 1 || receipt === undefined) {
        fail(`PR #${pullRequest.number} must have exactly one canonical delivery receipt`);
    }
    return assertCanonicalDeliveryReceipt(receipt, pullRequest);
}

function ensureDeliveryReceipt(
    pullRequest: PullRequestSnapshot,
    closingIssue: number | undefined,
    port: DeliveryPort
): DeliveryReceiptPayload {
    const expected = expectedDeliveryReceipt(pullRequest, closingIssue);
    const existing = deliveryReceiptCandidates(port.deliveryReceipts(pullRequest.number), pullRequest);
    if (existing.length > 1) {
        fail(`PR #${pullRequest.number} has duplicate delivery receipts`);
    }
    let receipt = existing[0];
    if (receipt === undefined) {
        const body = composeDeliveryReceipt(expected);
        try {
            receipt = port.addDeliveryReceipt(pullRequest.number, body);
        } catch (error) {
            const recovered = deliveryReceiptCandidates(port.deliveryReceipts(pullRequest.number), pullRequest);
            if (recovered.length !== 1 || recovered[0] === undefined) {
                throw error;
            }
            receipt = recovered[0];
        }
    }
    assertCanonicalDeliveryReceipt(receipt, pullRequest, expected);
    const verified = deliveryReceiptCandidates(port.deliveryReceipts(pullRequest.number), pullRequest);
    if (verified.length !== 1 || verified[0]?.id !== receipt.id) {
        fail(`PR #${pullRequest.number} delivery receipt was not durably verified`);
    }
    return assertCanonicalDeliveryReceipt(verified[0], pullRequest, expected);
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

export function deliverPullRequest(number: number, port: DeliveryPort, tracker: TrackerCompletionPort): void {
    port.fetch();
    const initial = port.pullRequest(number);
    validateBaseBranch(initial);
    if (initial.state === 'MERGED') {
        const receipt = readDeliveryReceipt(initial, port);
        const remaining = port.dependents(initial.headRefName).filter((candidate) => candidate.number !== number);
        retargetDependents(remaining, initial.baseRefName, port);
        completeIssueAfterMerge(number, receipt.closingIssue, tracker);
        port.log(`PR #${number} was already merged; repaired ${remaining.length} remaining dependent(s)`);
        return;
    }
    const initialTrackerTarget = trackerCompletionTarget(initial);
    validatePullRequest(initial, port);
    validateReview(number, port.reviewState(number, initial.headRefOid));

    const dependents = port.dependents(initial.headRefName).filter((candidate) => candidate.number !== number);
    if (dependents.length > 0 && port.repositoryDeletesMergedBranches()) {
        fail('automatic merged-branch deletion must be disabled before delivering a stacked PR');
    }
    port.log(`review size: ${initial.changedFiles} file(s), +${initial.additions}/-${initial.deletions}`);

    port.fetch();
    const current = port.pullRequest(number);
    const currentTrackerTarget = trackerCompletionTarget(current);
    validatePullRequest(current, port);
    validateStableTrackerTarget(number, initialTrackerTarget, currentTrackerTarget);
    validateStablePullRequest(initial, current);
    validateReview(number, port.reviewState(number, current.headRefOid));
    const currentDependents = port.dependents(current.headRefName).filter((candidate) => candidate.number !== number);
    validateDependentSet(dependents, currentDependents);
    for (const dependent of currentDependents) {
        validateDependent(port.pullRequest(dependent.number), dependent);
    }

    const receipt = ensureDeliveryReceipt(current, currentTrackerTarget, port);
    port.merge(number, current.headRefOid, currentDependents.length > 0);
    retargetDependents(currentDependents, current.baseRefName, port);
    completeIssueAfterMerge(number, receipt.closingIssue, tracker);
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

export function shellPort(
    repository: string,
    shell: ShellRunner = { capture, run },
    options: { gitToken?: string; helperDir?: string; repositoryRoot?: string } = {}
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
        'mergeStateStatus',
        'reviewDecision',
        'changedFiles',
        'additions',
        'deletions',
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
        pullRequest: (number) =>
            parseJson<PullRequestSnapshot>(
                shell.capture('gh', ['pr', 'view', String(number), '--repo', repository, '--json', pullRequestFields]),
                `PR #${number}`
            ),
        headCheckRuns: (number, headRefOid) =>
            readHeadCheckRuns(number, (cursor) => readRollupPage(number, headRefOid, cursor)),
        gateRequiredCheckNames: () => readGateRequiredCheckNames(options.repositoryRoot ?? process.cwd(), shell),
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

export type DeliveryCoordinatorDependencies = {
    primaryRoot: () => string;
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
                repositoryRoot: primaryRoot,
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
