import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import {
    DeliveryMergeRejectedError,
    deliverPullRequest as deliverPullRequestWithTracker,
    deliverPullRequestWithRequiredCi as deliverPullRequestWithRequiredCiAndTracker,
    expectedAbsentDeliveryReceiptAuthority,
    gateRequiredCheckNames,
    parseCliArgs,
    readGateRequiredCheckNames,
    shellPort,
    type DeliveryReceiptAuthorityExpectation,
    type DeliveryReceiptProof,
    type DeliveryPort,
    type HeadCheckRun,
    type PersistedDeliveryReceiptAuthority,
    type PullRequestSnapshot,
    type ReviewState,
    type ShellRunner,
    type StackedPullRequest,
    type TrackerCompletionPort,
} from '../deliverPullRequest';
import {
    AUTHOR_BOT_NODE_ID,
    GITHUB_HTTPS_REMOTE,
    REQUIRED_BASE_BRANCH,
    REVIEWER_BOT_NODE_ID,
} from '../githubAppIdentity.ts';
import { composeDeliveryReceipt } from '../prContract.ts';
import { summarizeGateWorkflow } from '../trustedGithubWriteBootstrap.ts';

const WORKFLOW_PATH = '.github/workflows/health-gates.yml';

/**
 * The launcher's own parse, serialized exactly as it reaches the snapshot. Going through it rather
 * than a fixture keeps these cases honest about the whole path a delivery actually takes.
 */
async function gatingNamesFor(workflowSource: string): Promise<ReadonlySet<string>> {
    return gateRequiredCheckNames(JSON.stringify(await summarizeGateWorkflow(workflowSource)));
}

async function refusalFor(workflowSource: string): Promise<string> {
    try {
        await gatingNamesFor(workflowSource);
    } catch (error) {
        return String(error);
    }
    return 'no refusal';
}

/**
 * What the `yaml` package says the check name is, derived here independently of the gate: a job's
 * declared `name`, or its job id when it declares none. Every shape below is asserted against this
 * rather than against a hand-copied expectation, so a divergence from the parser fails the test.
 */
function parserCheckName(workflowSource: string, jobId: string): string {
    const workflow = parse(workflowSource) as { jobs?: Record<string, { name?: unknown } | null> };
    const declared = workflow.jobs?.[jobId]?.name;
    return typeof declared === 'string' && declared !== '' ? declared : jobId;
}

/** The job ids the gate declares, read with the `yaml` package rather than derived by the gate. */
function parserGateNeeds(workflowSource: string): string[] {
    const workflow = parse(workflowSource) as { jobs?: Record<string, { needs?: unknown } | null> };
    const needs = workflow.jobs?.gate?.needs;
    if (!Array.isArray(needs)) {
        throw new TypeError(`${WORKFLOW_PATH} declares no gate needs list`);
    }
    return needs as string[];
}

function relationshipBody(relationship: string): string {
    return `### 🎯 What does this PR do?
Change.
### 🧪 How to test
Run.
### 🖼️ Screenshots
None.
### 📌 Related tickets & additional notes
${relationship}`;
}

function persistedPostMergeValidation(
    headRefOid: string,
    pullRequestBody: string,
    trackerTarget: number,
    options: { headRefName?: string; baseRefName?: string; title?: string } = {}
) {
    return {
        headRefOid,
        headRefName: options.headRefName ?? 'feat/gate',
        baseRefName: options.baseRefName ?? 'main',
        title: options.title ?? 'feat(delivery): add gate',
        bodySha256: createHash('sha256').update(pullRequestBody).digest('hex'),
        trackerTarget,
    };
}

const body = relationshipBody('None.');
const ORDERED_RECEIPT_PROOF_QUERY_FRAGMENT =
    'comments(first:100,after:$cursor,orderBy:{field:CREATED_AT,direction:ASC}){totalCount pageInfo{hasNextPage endCursor} nodes{id lastEditedAt}}';
const ORDERED_RECEIPT_PROOF_QUERY = `query=query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){${ORDERED_RECEIPT_PROOF_QUERY_FRAGMENT}}}}`;

type MergeSettings = {
    allow_merge_commit: boolean;
    allow_rebase_merge: boolean;
    allow_squash_merge: boolean;
    delete_branch_on_merge: boolean;
};

function mergePolicyPort(settings: string | Error) {
    const captures: Array<{ command: string; args: string[] }> = [];
    const port = shellPort('jcosta33/sourdaw', {
        capture: (command, args) => {
            captures.push({ command, args });
            if (command === 'git' && args.join(' ') === 'show -s --format=%s head') {
                return 'feat(delivery): committed subject\n';
            }
            if (args.join(' ') === 'api repos/jcosta33/sourdaw') {
                if (settings instanceof Error) {
                    throw settings;
                }
                return settings;
            }
            if (args.includes('repos/jcosta33/sourdaw/pulls/42/merge')) {
                return JSON.stringify({ merged: true, message: 'merged' });
            }
            throw new Error(`unexpected capture: ${command} ${args.join(' ')}`);
        },
        run: () => undefined,
    });
    return { captures, port };
}

function mergeSettings(settings: MergeSettings): string {
    return JSON.stringify(settings);
}

function annotatedBlobTagOid(primaryRoot: string, targetOid: string, name: string): string {
    return execFileSync('git', ['mktag'], {
        cwd: primaryRoot,
        encoding: 'utf8',
        input: `object ${targetOid}
type blob
tag ${name}
tagger Test User <test@example.com> 1704067200 +0000

delivery receipt authority tag
`,
    }).trim();
}

function stackedDeliveryPort(finalSettings: MergeSettings) {
    const captures: Array<{ command: string; args: string[] }> = [];
    let child = pullRequest({ ...stacked(), baseRefOid: 'base' });
    let deliveryReceipt: DeliveryReceiptComment | undefined;
    let primaryMerged = false;
    const port = shellPort('jcosta33/sourdaw', {
        capture: (command, args) => {
            captures.push({ command, args });
            const joined = args.join(' ');
            if (command === 'git' && joined === 'rev-parse HEAD') {
                return 'head';
            }
            if (command === 'git' && joined === 'status --porcelain=v1') {
                return '';
            }
            if (command === 'git' && joined === 'rev-parse refs/remotes/origin/main') {
                return 'base';
            }
            if (joined.includes('pr view')) {
                return JSON.stringify(
                    shellPullRequest(
                        args.includes('43') ? child : pullRequest(primaryMerged ? { state: 'MERGED' } : {})
                    )
                );
            }
            if (joined.includes('mergedBy{__typename')) {
                return shellMergedByGraphql({ __typename: 'Bot', id: AUTHOR_BOT_NODE_ID });
            }
            if (joined.includes('comments(last:1){totalCount nodes{id}}')) {
                return JSON.stringify({
                    data: {
                        repository: {
                            pullRequest: {
                                comments: {
                                    totalCount: deliveryReceipt === undefined ? 0 : 1,
                                    nodes: deliveryReceipt === undefined ? [] : [{ id: deliveryReceipt.id }],
                                },
                            },
                        },
                    },
                });
            }
            if (joined.includes('query=')) {
                return JSON.stringify({
                    data: {
                        repository: {
                            pullRequest: {
                                reviews: {
                                    nodes: [
                                        {
                                            state: 'APPROVED',
                                            submittedAt: '2026-08-19T00:00:00Z',
                                            author: {
                                                id: REVIEWER_BOT_NODE_ID,
                                                login: 'renamed-reviewer[bot]',
                                                __typename: 'Bot',
                                            },
                                            commit: { oid: 'head' },
                                        },
                                    ],
                                    pageInfo: { hasPreviousPage: false },
                                },
                                reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
                            },
                        },
                    },
                });
            }
            if (joined.includes('pulls?state=open')) {
                return JSON.stringify([
                    [
                        {
                            number: 43,
                            state: 'open',
                            head: { ref: 'feat/child', sha: 'child-head' },
                            base: { ref: 'feat/gate' },
                        },
                    ],
                ]);
            }
            if (joined.includes('.delete_branch_on_merge')) {
                return String(finalSettings.delete_branch_on_merge);
            }
            if (joined.includes('issues/42/comments?per_page=100')) {
                return JSON.stringify([
                    [
                        ...(deliveryReceipt === undefined
                            ? []
                            : [
                                  {
                                      node_id: deliveryReceipt.id,
                                      body: deliveryReceipt.body,
                                      user: {
                                          node_id: deliveryReceipt.authorNodeId,
                                          login: deliveryReceipt.authorLogin,
                                          type: deliveryReceipt.authorType,
                                      },
                                      created_at: deliveryReceipt.createdAt,
                                      updated_at: deliveryReceipt.updatedAt,
                                  },
                              ]),
                    ],
                ]);
            }
            if (joined.includes('POST repos/jcosta33/sourdaw/issues/42/comments')) {
                deliveryReceipt = {
                    id: 'IC_delivery_42',
                    body: args.find((argument) => argument.startsWith('body='))?.slice('body='.length) ?? '',
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                };
                return JSON.stringify({
                    node_id: deliveryReceipt.id,
                    body: deliveryReceipt.body,
                    user: {
                        node_id: deliveryReceipt.authorNodeId,
                        login: deliveryReceipt.authorLogin,
                        type: deliveryReceipt.authorType,
                    },
                    created_at: deliveryReceipt.createdAt,
                    updated_at: deliveryReceipt.updatedAt,
                });
            }
            if (joined === 'api repos/jcosta33/sourdaw') {
                return mergeSettings(finalSettings);
            }
            if (joined.includes('/merge')) {
                primaryMerged = true;
                return JSON.stringify({ merged: true, message: 'merged' });
            }
            throw new Error(`unexpected capture: ${command} ${joined}`);
        },
        run: (_command, args) => {
            if (args.includes('PATCH')) {
                child = { ...child, baseRefName: 'main' };
            }
        },
    });
    return { captures, port };
}

function pullRequest(overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot {
    return {
        number: 42,
        state: 'OPEN',
        isDraft: false,
        title: 'feat(delivery): add gate',
        body,
        headRefName: 'feat/gate',
        headRefOid: 'head',
        baseRefName: 'main',
        baseRefOid: 'base',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        reviewDecision: '',
        changedFiles: 3,
        additions: 40,
        deletions: 5,
        mergedByActorNodeId: overrides.state === 'MERGED' ? AUTHOR_BOT_NODE_ID : null,
        ...overrides,
    };
}

function shellPullRequest(snapshot: PullRequestSnapshot): Omit<PullRequestSnapshot, 'mergedByActorNodeId'> & {
    mergedBy: { is_bot: true; login: string } | null;
} {
    const { mergedByActorNodeId, ...fields } = snapshot;
    return {
        ...fields,
        mergedBy:
            mergedByActorNodeId === null
                ? null
                : {
                      is_bot: true,
                      login:
                          mergedByActorNodeId === AUTHOR_BOT_NODE_ID ? 'renamed-author[bot]' : 'renamed-foreign[bot]',
                  },
    };
}

function shellMergedByGraphql(mergedBy: { __typename: 'Bot'; id: string } | { __typename: 'User' } | null): string {
    return JSON.stringify({
        data: {
            repository: {
                pullRequest: {
                    mergedBy,
                },
            },
        },
    });
}

function checkRun(overrides: Partial<HeadCheckRun> = {}): HeadCheckRun {
    return { name: 'Gate', status: 'COMPLETED', conclusion: 'SUCCESS', ...overrides };
}

const LIVE_WORKFLOW_SOURCE = readFileSync(join(import.meta.dirname, '../..', WORKFLOW_PATH), 'utf8');

/**
 * Derived from the live workflow with the `yaml` package rather than copied out of it. A pinned list
 * says what the names were on the day it was written: this repository gated on twelve jobs while the
 * copy here still named eleven, and the missing one was invisible precisely because nothing compared
 * the two. Deriving it means promoting a job into the gate updates these fixtures with the workflow.
 */
const gatingCheckNames: ReadonlySet<string> = new Set(
    parserGateNeeds(LIVE_WORKFLOW_SOURCE).map((jobId) => parserCheckName(LIVE_WORKFLOW_SOURCE, jobId))
);

/**
 * A tolerated cancelled-check shape: every cancelled name succeeded again on the same commit,
 * beside a job the workflow skipped outright and never cancelled.
 */
function supersededRunCheckRuns(): HeadCheckRun[] {
    return [
        checkRun({ name: 'Lint', conclusion: 'CANCELLED' }),
        checkRun({ name: 'Gate', conclusion: 'CANCELLED' }),
        checkRun({ name: 'Native audio backend (macOS)', conclusion: 'SKIPPED' }),
        checkRun({ name: 'Lint' }),
        checkRun(),
    ];
}

type RollupPageFixture = {
    nodes: unknown[];
    totalCount?: number;
    hasNextPage?: boolean;
    endCursor?: string | null;
};

function rollupResponse(page: RollupPageFixture): string {
    return JSON.stringify({
        data: {
            repository: {
                object: {
                    statusCheckRollup: {
                        contexts: {
                            totalCount: page.totalCount ?? page.nodes.length,
                            pageInfo: {
                                hasNextPage: page.hasNextPage ?? false,
                                endCursor: page.endCursor ?? null,
                            },
                            nodes: page.nodes,
                        },
                    },
                },
            },
        },
    });
}

function rollupNodes(checkRuns: HeadCheckRun[]): unknown[] {
    return checkRuns.map((check) => ({ __typename: 'CheckRun', ...check }));
}

function deliveryReceiptProofForIds(commentIds: string[], editedCommentIds: string[] = []): DeliveryReceiptProof {
    return {
        totalCount: commentIds.length,
        latestCommentId: commentIds.at(-1),
        commentIds,
        editedCommentIds,
    };
}

function shellDeliveryReceiptProofResponse(
    commentIds: string[],
    options?: {
        hasNextPage?: boolean;
        endCursor?: string | null;
        totalCount?: number;
        editedCommentIds?: string[];
    }
) {
    return JSON.stringify({
        data: {
            repository: {
                pullRequest: {
                    comments: {
                        totalCount: options?.totalCount ?? commentIds.length,
                        pageInfo: {
                            hasNextPage: options?.hasNextPage ?? false,
                            endCursor: options?.endCursor ?? null,
                        },
                        nodes: commentIds.map((id) => ({
                            id,
                            lastEditedAt: options?.editedCommentIds?.includes(id) ? '2026-08-21T00:00:00Z' : null,
                        })),
                    },
                },
            },
        },
    });
}

function stacked(overrides: Partial<StackedPullRequest> = {}): StackedPullRequest {
    return {
        number: 43,
        state: 'OPEN',
        headRefName: 'feat/child',
        headRefOid: 'child-head',
        baseRefName: 'feat/gate',
        ...overrides,
    };
}

type FakeInput = {
    primary?: Array<PullRequestSnapshot | Error>;
    review?: ReviewState;
    reviewStates?: ReviewState[];
    dependentSets?: StackedPullRequest[][];
    dirty?: boolean;
    headCheckRuns?: HeadCheckRun[] | Error;
    headCheckRunReads?: Array<HeadCheckRun[] | Error>;
    gateRequiredCheckNames?: ReadonlySet<string> | Error;
    deletesMergedBranches?: boolean;
    failAddReceiptOnce?: boolean;
    failRetargetOnce?: number;
    mergedByActorNodeIdAfterMerge?: string | null;
    headCommitSubject?: string;
    primaryBaseRefNameOnReceiptRead?: string;
    primaryBodyOnReceiptRead?: string;
    reviewStateOnReceiptRead?: ReviewState;
    receipts?: DeliveryReceiptComment[];
    persistedReceiptAuthority?: PersistedDeliveryReceiptAuthority;
    deliveryReceiptProof?: DeliveryReceiptProof;
    mergedPrimaryAfterMerge?: Partial<PullRequestSnapshot>;
};

type DeliveryReceiptComment = {
    id: string;
    body: string;
    authorNodeId: string | null;
    authorLogin: string | null;
    authorType: string | null;
    createdAt: string;
    updatedAt: string;
};

function deliveryReceiptBody(
    pullRequestNumber: number,
    head: string,
    pullRequestBody: string,
    closingIssue: number | undefined
): string {
    const digest = createHash('sha256').update(pullRequestBody).digest('hex');
    return [
        '<!-- sourdaw-delivery-receipt:v1',
        `pull-request: ${pullRequestNumber}`,
        `head: ${head}`,
        `body-sha256: ${digest}`,
        `closing-issue: ${closingIssue === undefined ? 'none' : String(closingIssue)}`,
        '-->',
    ].join('\n');
}

function visibleDeliveryReceiptBody(
    pullRequestNumber: number,
    head: string,
    pullRequestBody: string,
    closingIssue: number | undefined,
    observedCiState:
        | 'successful'
        | 'failed'
        | 'pending'
        | 'absent'
        | 'skipped'
        | 'cancelled'
        | 'unstable'
        | 'malformed'
        | 'unavailable'
): string {
    return composeDeliveryReceipt({
        pullRequest: pullRequestNumber,
        head,
        bodySha256: createHash('sha256').update(pullRequestBody).digest('hex'),
        closingIssue,
        ciAdmissionMode: 'advisory',
        observedCiState,
    });
}

function requiredDeliveryReceiptBody(
    pullRequestNumber: number,
    head: string,
    pullRequestBody: string,
    closingIssue: number | undefined
): string {
    return composeDeliveryReceipt({
        pullRequest: pullRequestNumber,
        head,
        bodySha256: createHash('sha256').update(pullRequestBody).digest('hex'),
        closingIssue,
        ciAdmissionMode: 'required',
    });
}

function authorityTrace(authority: PersistedDeliveryReceiptAuthority | undefined): string {
    if (authority === undefined) {
        return 'none';
    }
    return `${authority.phase}:${authority.receiptId}`;
}

function sameReceiptAuthority(
    left: PersistedDeliveryReceiptAuthority | undefined,
    right: PersistedDeliveryReceiptAuthority | undefined
): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function sameReceiptAuthorityExpectation(
    current: PersistedDeliveryReceiptAuthority | undefined,
    expected: DeliveryReceiptAuthorityExpectation
): boolean {
    if (expected.mode === 'absent') {
        return current === undefined;
    }
    return sameReceiptAuthority(current, expected.authority);
}

function fakePort(input: FakeInput = {}) {
    const calls: string[] = [];
    const primary = [...(input.primary ?? [pullRequest(), pullRequest()])];
    const reviewStates = [...(input.reviewStates ?? [])];
    const dependentSets = input.dependentSets?.map((set) => [...set]) ?? [[stacked()], [stacked()]];
    const headCheckRunReads = input.headCheckRunReads?.map((entry) => (entry instanceof Error ? entry : [...entry]));
    const pullRequests = new Map<number, PullRequestSnapshot>();
    for (const set of dependentSets) {
        for (const dependent of set) {
            pullRequests.set(
                dependent.number,
                pullRequest({
                    ...dependent,
                    baseRefOid: 'base',
                })
            );
        }
    }
    let lastDependents = dependentSets.at(-1) ?? [];
    let failedAddReceipt = false;
    let failedRetarget = false;
    let primaryBaseRefName: string | undefined;
    let primaryBody: string | undefined;
    let reviewStateAfterReceipt: ReviewState | undefined;
    let lastPrimary: PullRequestSnapshot | undefined;
    let mergedPrimary: PullRequestSnapshot | undefined;
    let persistedReceiptAuthority = input.persistedReceiptAuthority;
    const receipts = [...(input.receipts ?? [])];
    const port: DeliveryPort & {
        deliveryReceipts: (number: number) => DeliveryReceiptComment[];
        addDeliveryReceipt: (number: number, body: string) => DeliveryReceiptComment;
    } = {
        fetch: () => calls.push('fetch'),
        pullRequest: (number) => {
            if (number === 42) {
                const next = primary.shift() ?? mergedPrimary;
                if (next === undefined) {
                    throw new Error('missing primary fixture');
                }
                if (next instanceof Error) {
                    throw next;
                }
                const snapshot = {
                    ...next,
                    ...(primaryBaseRefName === undefined ? {} : { baseRefName: primaryBaseRefName }),
                    ...(primaryBody === undefined || next.state === 'MERGED' ? {} : { body: primaryBody }),
                };
                lastPrimary = snapshot;
                return snapshot;
            }
            const current = pullRequests.get(number);
            if (current === undefined) {
                throw new Error(`missing PR #${number} fixture`);
            }
            return current;
        },
        gateRequiredCheckNames: () => {
            calls.push('gate-required-check-names');
            const required = input.gateRequiredCheckNames ?? gatingCheckNames;
            if (required instanceof Error) {
                throw required;
            }
            return required;
        },
        /**
         * The primary head defaults to one successful Gate run so advisory delivery cases that do not
         * care about CI observation still exercise a complete snapshot. Cases that need an unreadable
         * or non-success snapshot supply it explicitly, and any non-primary read still throws.
         */
        headCheckRuns: (number, headRefOid) => {
            calls.push(`checks:${number}:${headRefOid}`);
            const runs =
                number === 42 ? (headCheckRunReads?.shift() ?? input.headCheckRuns ?? [checkRun()]) : undefined;
            if (runs === undefined) {
                throw new Error(`PR #${number} check rollup is unreadable`);
            }
            if (runs instanceof Error) {
                throw runs;
            }
            return structuredClone(runs);
        },
        reviewState: (number, expectedHead) => {
            calls.push(`review:${number}:${expectedHead}`);
            return (
                reviewStateAfterReceipt ??
                reviewStates.shift() ??
                input.review ?? { latestReviewerStateOnHead: 'APPROVED', unresolvedThreads: 0 }
            );
        },
        headCommitSubject: (headRefOid) => {
            calls.push(`head-subject:${headRefOid}`);
            return input.headCommitSubject ?? 'feat(delivery): committed subject';
        },
        dependents: () => {
            const next = dependentSets.shift();
            if (next !== undefined) {
                lastDependents = next;
            }
            return [...lastDependents];
        },
        repositoryDeletesMergedBranches: () => input.deletesMergedBranches ?? false,
        merge: (number, head, _hasDependents, expectedTitle) => {
            calls.push(`merge:${number}:${head}`);
            calls.push(`merge-title:${expectedTitle ?? 'none'}`);
            if (lastPrimary === undefined) {
                throw new Error('merge requires a primary snapshot');
            }
            mergedPrimary = {
                ...lastPrimary,
                state: 'MERGED',
                mergedByActorNodeId:
                    input.mergedByActorNodeIdAfterMerge === undefined
                        ? AUTHOR_BOT_NODE_ID
                        : input.mergedByActorNodeIdAfterMerge,
                ...input.mergedPrimaryAfterMerge,
            };
        },
        retarget: (number, base) => {
            calls.push(`retarget:${number}:${base}`);
            if (input.failRetargetOnce === number && !failedRetarget) {
                failedRetarget = true;
                throw new Error(`retarget ${number} failed`);
            }
            const current = pullRequests.get(number);
            if (current === undefined) {
                throw new Error(`missing PR #${number} fixture`);
            }
            pullRequests.set(number, { ...current, baseRefName: base });
        },
        deliveryReceipts: (number) => {
            calls.push(`receipts:${number}`);
            primaryBaseRefName = input.primaryBaseRefNameOnReceiptRead ?? primaryBaseRefName;
            primaryBody = input.primaryBodyOnReceiptRead ?? primaryBody;
            reviewStateAfterReceipt = input.reviewStateOnReceiptRead ?? reviewStateAfterReceipt;
            return structuredClone(receipts);
        },
        deliveryReceiptProof: (number) => {
            const proof =
                input.deliveryReceiptProof ?? deliveryReceiptProofForIds(receipts.map((receipt) => receipt.id));
            const normalizedProof = {
                ...proof,
                commentIds: proof.commentIds ?? receipts.map((receipt) => receipt.id),
                editedCommentIds: proof.editedCommentIds ?? [],
            };
            calls.push(`receipt-proof:${number}:${proof.totalCount}:${proof.latestCommentId ?? 'none'}`);
            return normalizedProof;
        },
        addDeliveryReceipt: (number, receiptBody) => {
            calls.push(`add-receipt:${number}`);
            const createdAt = new Date(Date.UTC(2026, 7, 21, 0, 0, receipts.length)).toISOString();
            const receipt = {
                id: `IC_delivery_${number}_${receipts.length + 1}`,
                body: receiptBody,
                authorNodeId: AUTHOR_BOT_NODE_ID,
                authorLogin: 'renamed-author[bot]',
                authorType: 'Bot',
                createdAt,
                updatedAt: createdAt,
            };
            receipts.push(receipt);
            if (input.failAddReceiptOnce && !failedAddReceipt) {
                failedAddReceipt = true;
                throw new Error('delivery receipt response was lost');
            }
            return structuredClone(receipt);
        },
        readDeliveryReceiptAuthority: () => {
            calls.push(`receipt-authority:read:${authorityTrace(persistedReceiptAuthority)}`);
            return persistedReceiptAuthority;
        },
        writeDeliveryReceiptAuthority: (number, authority, expectedCurrent) => {
            if (
                expectedCurrent !== undefined &&
                !sameReceiptAuthorityExpectation(persistedReceiptAuthority, expectedCurrent)
            ) {
                throw new Error(`PR #${number} delivery receipt authority could not be stored`);
            }
            calls.push(`receipt-authority:write:${authorityTrace(authority)}`);
            persistedReceiptAuthority = authority;
        },
        clearDeliveryReceiptAuthority: (number, expectedCurrent) => {
            if (
                expectedCurrent !== undefined &&
                !sameReceiptAuthorityExpectation(persistedReceiptAuthority, expectedCurrent)
            ) {
                throw new Error(`PR #${number} delivery receipt authority could not be cleared`);
            }
            calls.push(`receipt-authority:clear:${authorityTrace(persistedReceiptAuthority)}`);
            persistedReceiptAuthority = undefined;
        },
        log: (message) => calls.push(message),
    };
    const tracker: TrackerCompletionPort = {
        complete: (issueNumber: number) => {
            calls.push(`complete:${issueNumber}`);
        },
    };
    return {
        port,
        calls,
        tracker,
        receipts,
        persistedReceiptAuthority: () => persistedReceiptAuthority,
    };
}

function deliverPullRequest(
    number: number,
    port: DeliveryPort,
    tracker: TrackerCompletionPort = {
        complete: (issueNumber: number) => expect.fail(`unexpected issue completion: ${issueNumber}`),
    }
): void {
    deliverPullRequestWithTracker(number, port, tracker);
}

function deliverPullRequestWithRequiredCi(
    number: number,
    port: DeliveryPort,
    tracker: TrackerCompletionPort = {
        complete: (issueNumber: number) => expect.fail(`unexpected issue completion: ${issueNumber}`),
    }
): void {
    deliverPullRequestWithRequiredCiAndTracker(number, port, tracker);
}

describe('pull-request delivery', () => {
    it('queries bot review author IDs through a Bot fragment', () => {
        const source = readFileSync(join(import.meta.dirname, '../deliverPullRequest.ts'), 'utf8');
        expect(source).not.toMatch(/\bauthor\s*\{\s*id\b/);
        expect(source.match(/author\{login __typename \.\.\. on Bot\{id\}\}/g)).toHaveLength(1);
    });

    it('completes the canonical Closes issue only after merge and dependent retargeting', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: closes })],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('complete:2372');
        expect(calls.indexOf('complete:2372')).toBeGreaterThan(calls.indexOf('merge:42:head'));
        expect(calls.indexOf('complete:2372')).toBeGreaterThan(calls.indexOf('retarget:43:main'));
    });

    it.each(['Related #2372', 'None.'])('does not complete an issue for %s', (relationship) => {
        const relatedBody = relationshipBody(relationship);
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ body: relatedBody }), pullRequest({ body: relatedBody })],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.some((call) => call.startsWith('complete:'))).toBe(false);
    });

    it('rejects Related-ticket body or target drift before merge', () => {
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({ body: relationshipBody('Closes #2372') }),
                pullRequest({ body: relationshipBody('Closes #2373') }),
            ],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/body|closing target.*changed/i);
        expect(calls).not.toContain('merge:42:head');
        expect(calls.some((call) => call.startsWith('complete:'))).toBe(false);
    });

    it('rejects body drift even when the canonical closing target is unchanged', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: `${closes}\nChanged note.` })],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/body changed during delivery/i);
        expect(calls).not.toContain('merge:42:head');
        expect(calls.some((call) => call.startsWith('complete:'))).toBe(false);
    });

    it('refuses foreign-merged X after open Y wrote a receipt and refuses its merged retry', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const { port, calls, receipts, tracker } = fakePort({
            primary: [
                pullRequest({ body: bodyY }),
                pullRequest({ state: 'MERGED', body: bodyX, mergedByActorNodeId: REVIEWER_BOT_NODE_ID }),
                pullRequest({ state: 'MERGED', body: bodyX, mergedByActorNodeId: REVIEWER_BOT_NODE_ID }),
            ],
            dependentSets: [[]],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/not merged by the author App/);
        expect(receipts.map((receipt) => receipt.body)).toEqual([
            visibleDeliveryReceiptBody(42, 'head', bodyY, 2373, 'successful'),
        ]);
        expect(calls.some((call) => call.startsWith('complete:'))).toBe(false);

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/not merged by the author App/);
        expect(calls.some((call) => call.startsWith('complete:'))).toBe(false);
        expect(calls).not.toContain('merge:42:head');
    });

    it('recovers a stable final author-App merge without re-reviewing or merging again', () => {
        const closes = relationshipBody('Closes #2372');
        const child = stacked();
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ state: 'MERGED', body: closes, mergedByActorNodeId: AUTHOR_BOT_NODE_ID }),
            ],
            dependentSets: [[child], [child]],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'receipts:42')).toHaveLength(5);
        expect(calls.filter((call) => call === 'review:42:head')).toHaveLength(1);
        expect(calls).not.toContain('merge:42:head');
        expect(calls).toContain('retarget:43:main');
        expect(calls).toContain('complete:2372');
    });

    it.each([
        {
            label: 'head OID drift',
            mergedPrimaryAfterMerge: { headRefOid: 'moved-head' },
            error: /headRefOid changed during delivery/,
        },
        {
            label: 'base branch drift',
            mergedPrimaryAfterMerge: { baseRefName: 'release/1.0' },
            error: /targets release\/1.0, not main|baseRefName changed during delivery/,
        },
        {
            label: 'body drift',
            mergedPrimaryAfterMerge: { body: `${relationshipBody('Closes #2372')}\nChanged note.` },
            error: /body changed during delivery/,
        },
        {
            label: 'closing target drift',
            mergedPrimaryAfterMerge: {
                body: relationshipBody('Closes #9999'),
            },
            authorizedBody: relationshipBody('Related #2372'),
            error: /body changed during delivery/,
        },
    ])(
        'detects post-merge $label before retarget or tracker completion',
        ({ mergedPrimaryAfterMerge, authorizedBody, error }) => {
            const bodyUnderReview = authorizedBody ?? relationshipBody('Closes #2372');
            const { port, calls, tracker } = fakePort({
                primary: [pullRequest({ body: bodyUnderReview }), pullRequest({ body: bodyUnderReview })],
                mergedPrimaryAfterMerge,
            });

            expect(() => deliverPullRequest(42, port, tracker)).toThrow(error);
            expect(calls).toContain('merge:42:head');
            expect(calls).not.toContain('retarget:43:main');
            expect(calls.some((call) => call.startsWith('complete:'))).toBe(false);
        }
    );

    it('detects post-merge headRefName drift before retarget or tracker completion when all other validated inputs stay stable', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: closes })],
            mergedPrimaryAfterMerge: {
                headRefName: 'feat/rewritten-head',
            },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/headRefName changed during delivery/);
        expect(calls).toContain('merge:42:head');
        expect(calls).not.toContain('retarget:43:main');
        expect(calls.some((call) => call.startsWith('complete:'))).toBe(false);
    });

    it('refuses to merge when the reviewed title drifts before the final open snapshot', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ body: closes, title: 'feat(delivery): renamed gate' }),
            ],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/title changed during delivery/i);
        expect(calls).not.toContain('merge:42:head');
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('retarget:'))).toHaveLength(0);
    });

    it('merges with the approved head commit subject instead of the mutable pull-request title', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({ body: closes, title: 'feat(delivery): retitled in UI' }),
                pullRequest({ body: closes, title: 'feat(delivery): retitled in UI' }),
            ],
            headCommitSubject: 'feat(delivery): committed subject',
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('head-subject:head');
        expect(calls).toContain('merge-title:feat(delivery): committed subject');
        expect(calls).not.toContain('merge-title:feat(delivery): retitled in UI');
    });

    it('fails closed when an UNKNOWN initial refresh becomes a merged author-App head with no persisted receipt authority', () => {
        const closes = relationshipBody('Closes #2372');
        const child = stacked();
        const seededReceipt: DeliveryReceiptComment = {
            id: 'IC_seeded_x',
            body: deliveryReceiptBody(42, 'head', closes, 2372),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:00.000Z',
            updatedAt: '2026-08-21T00:00:00.000Z',
        };
        const { port, calls, tracker, receipts } = fakePort({
            primary: [
                pullRequest({ mergeable: 'UNKNOWN', body: closes }),
                pullRequest({
                    state: 'MERGED',
                    mergeable: 'UNKNOWN',
                    body: closes,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[child]],
            receipts: [seededReceipt],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls.filter((call) => call === 'review:42:head')).toHaveLength(0);
        expect(calls.filter((call) => call === 'receipts:42')).toHaveLength(0);
        expect(calls).not.toContain('receipt-proof:42:1:IC_seeded_x');
        expect(calls).not.toContain('receipt-authority:write:merge-authorized:IC_seeded_x');
        expect(calls).not.toContain('merge:42:head');
        expect(calls).not.toContain('retarget:43:main');
        expect(calls).not.toContain('complete:2372');
        expect(calls).not.toContain('receipt-authority:write:terminal:IC_seeded_x');
        expect(calls).not.toContain('PR #42 was already merged; repaired 1 remaining dependent(s)');
        expect(receipts.map((receipt) => receipt.body)).toEqual([deliveryReceiptBody(42, 'head', closes, 2372)]);
    });

    it('recovers a final UNKNOWN refresh that becomes a merged author-App head without re-reviewing', () => {
        const closes = relationshipBody('Closes #2372');
        const child = stacked();
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ mergeable: 'UNKNOWN', body: closes }),
                pullRequest({
                    state: 'MERGED',
                    mergeable: 'UNKNOWN',
                    body: closes,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[child], [child]],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'review:42:head')).toHaveLength(1);
        expect(calls.filter((call) => call === 'receipts:42')).toHaveLength(5);
        expect(calls).not.toContain('merge:42:head');
        expect(calls).toContain('retarget:43:main');
        expect(calls).toContain('complete:2372');
        expect(calls).toContain('PR #42 became merged during delivery; repaired 1 dependent(s)');
    });

    it('fails closed when the final refresh is already merged on a different closing target than the armed receipt', () => {
        const closesX = relationshipBody('Closes #2372');
        const closesY = relationshipBody('Closes #2373');
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({ body: closesX }),
                pullRequest({
                    state: 'MERGED',
                    body: closesY,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[]],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(
            /body changed during delivery|closing target changed during delivery/i
        );
        expect(calls).not.toContain('receipt-authority:write:merge-authorized:IC_delivery_42_1');
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('retarget:'))).toHaveLength(0);
    });

    it('fails closed when the final merged refresh only has a stale exact receipt listing and proof says a newer receipt exists', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({
                    state: 'MERGED',
                    body: closes,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[]],
        });
        let proofReads = 0;
        port.deliveryReceiptProof = (number) => {
            proofReads += 1;
            const proof =
                proofReads <= 2
                    ? deliveryReceiptProofForIds(['IC_delivery_42_1'])
                    : deliveryReceiptProofForIds(['IC_delivery_42_1', 'IC_hidden_newer']);
            calls.push(`receipt-proof:${number}:${proof.totalCount}:${proof.latestCommentId ?? 'none'}`);
            return proof;
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls).not.toContain('receipt-authority:write:merge-authorized:IC_delivery_42_1');
        expect(calls).not.toContain('complete:2372');
        expect(calls).not.toContain('retarget:43:main');
    });

    it.each([
        { merger: 'automatic', actorNodeId: 'MDQ6QXBwOTk5OTk5' },
        { merger: 'unknown', actorNodeId: null },
    ])('refuses $merger merger authority before receipt recovery', ({ actorNodeId }) => {
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', mergedByActorNodeId: actorNodeId })],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/not merged by the author App/);
        expect(calls).not.toContain('receipts:42');
        expect(calls.some((call) => call.startsWith('complete:'))).toBe(false);
    });

    it('appends a new X receipt after newer Y, then fails closed on merged body drift before recovery can reuse it', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const receipt = (
            id: string,
            body: string,
            closingIssue: number,
            createdAt: string
        ): DeliveryReceiptComment => ({
            id,
            body: deliveryReceiptBody(42, 'head', body, closingIssue),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt,
            updatedAt: createdAt,
        });
        const { port, calls, receipts, tracker } = fakePort({
            primary: [
                pullRequest({ body: bodyX }),
                pullRequest({ body: bodyX }),
                pullRequest({ state: 'MERGED', body: bodyX }),
                pullRequest({ state: 'MERGED', body: relationshipBody('None.') }),
            ],
            dependentSets: [[], []],
            receipts: [
                receipt('IC_historical_x', bodyX, 2372, '2026-08-21T00:00:00.000Z'),
                receipt('IC_historical_y', bodyY, 2373, '2026-08-21T00:00:01.000Z'),
            ],
        });
        let failTrackerOnce = true;
        tracker.complete = (issueNumber) => {
            calls.push(`complete:${issueNumber}`);
            if (failTrackerOnce) {
                failTrackerOnce = false;
                throw new Error('tracker unavailable');
            }
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(
            /PR #42.*merged.*issue #2372.*tracker unavailable/i
        );
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls.filter((call) => call === 'merge:42:head')).toHaveLength(1);
        expect(receipts.map((entry) => entry.body)).toEqual([
            deliveryReceiptBody(42, 'head', bodyX, 2372),
            deliveryReceiptBody(42, 'head', bodyY, 2373),
            visibleDeliveryReceiptBody(42, 'head', bodyX, 2372, 'successful'),
        ]);
        expect(calls.indexOf('receipt-authority:write:prepared:IC_delivery_42_3')).toBeLessThan(
            calls.indexOf('receipt-authority:write:merge-authorized:IC_delivery_42_3')
        );
        expect(calls.indexOf('receipt-authority:write:merge-authorized:IC_delivery_42_3')).toBeLessThan(
            calls.indexOf('complete:2372')
        );

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/body changed during delivery/i);
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(1);
        expect(calls.filter((call) => call === 'complete:2373')).toHaveLength(0);
        expect(calls).toContain('receipt-authority:read:merge-authorized:IC_delivery_42_3');
        expect(calls.filter((call) => call === 'receipt-authority:write:terminal:IC_delivery_42_3')).toHaveLength(0);
        expect(calls).not.toContain('PR #42 was already merged; repaired 0 remaining dependent(s)');
    });

    it('fails closed after clearing the persisted authority even when a newer exact X still survives behind older public Y after merge', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const receipt = (
            id: string,
            body: string,
            closingIssue: number,
            createdAt: string
        ): DeliveryReceiptComment => ({
            id,
            body: visibleDeliveryReceiptBody(42, 'head', body, closingIssue, 'successful'),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt,
            updatedAt: createdAt,
        });
        const { port, calls, receipts, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({ body: bodyX }),
                pullRequest({ body: bodyX }),
                pullRequest({ state: 'MERGED', body: bodyX }),
                pullRequest({ state: 'MERGED', body: relationshipBody('None.') }),
            ],
            dependentSets: [[], []],
            receipts: [
                receipt('IC_visible_x', bodyX, 2372, '2026-08-21T00:00:00.000Z'),
                receipt('IC_visible_y', bodyY, 2373, '2026-08-21T00:00:01.000Z'),
            ],
        });
        let failTrackerOnce = true;
        tracker.complete = (issueNumber) => {
            calls.push(`complete:${issueNumber}`);
            if (failTrackerOnce) {
                failTrackerOnce = false;
                throw new Error('tracker unavailable');
            }
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(
            /PR #42.*merged.*issue #2372.*tracker unavailable/i
        );
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_visible_x', 'IC_visible_y', 'IC_delivery_42_3']);
        expect(receipts.map(({ body }) => body)).toEqual([
            visibleDeliveryReceiptBody(42, 'head', bodyX, 2372, 'successful'),
            visibleDeliveryReceiptBody(42, 'head', bodyY, 2373, 'successful'),
            visibleDeliveryReceiptBody(42, 'head', bodyX, 2372, 'successful'),
        ]);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'merge-authorized',
            receiptId: 'IC_delivery_42_3',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', bodyX, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', bodyX, 2372),
        });
        expect(calls).toContain('complete:2372');
        expect(calls).not.toContain('complete:2373');

        port.clearDeliveryReceiptAuthority(42);

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls).not.toContain('complete:2373');
        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(1);
        expect(
            calls.filter((call) => call === 'receipt-authority:write:merge-authorized:IC_delivery_42_3')
        ).toHaveLength(1);
        expect(calls.filter((call) => call === 'receipt-authority:write:terminal:IC_delivery_42_3')).toHaveLength(0);
        expect(calls).not.toContain('PR #42 was already merged; repaired 0 remaining dependent(s)');
    });

    it('fails closed after clearing the persisted authority even when a canonical v2 remains newer than a trailing same-key legacy v1 after merge', () => {
        const closes = relationshipBody('Closes #2372');
        const currentVisible = visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful');
        const { port, calls, receipts, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ state: 'MERGED', body: closes }),
                pullRequest({ state: 'MERGED', body: relationshipBody('None.') }),
            ],
            dependentSets: [[], []],
            receipts: [
                {
                    id: 'IC_visible_v2',
                    body: currentVisible,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00.000Z',
                    updatedAt: '2026-08-21T00:00:00.000Z',
                },
                {
                    id: 'IC_trailing_v1',
                    body: deliveryReceiptBody(42, 'head', closes, 2372),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:01.000Z',
                    updatedAt: '2026-08-21T00:00:01.000Z',
                },
            ],
        });
        let failTrackerOnce = true;
        tracker.complete = (issueNumber) => {
            calls.push(`complete:${issueNumber}`);
            if (failTrackerOnce) {
                failTrackerOnce = false;
                throw new Error('tracker unavailable');
            }
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(
            /PR #42.*merged.*issue #2372.*tracker unavailable/i
        );
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_visible_v2', 'IC_trailing_v1', 'IC_delivery_42_3']);
        expect(receipts.map(({ body }) => body)).toEqual([
            currentVisible,
            deliveryReceiptBody(42, 'head', closes, 2372),
            currentVisible,
        ]);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'merge-authorized',
            receiptId: 'IC_delivery_42_3',
            receiptBody: currentVisible,
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });

        port.clearDeliveryReceiptAuthority(42);

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(1);
        expect(
            calls.filter((call) => call === 'receipt-authority:write:merge-authorized:IC_delivery_42_3')
        ).toHaveLength(1);
        expect(calls.filter((call) => call === 'receipt-authority:write:terminal:IC_delivery_42_3')).toHaveLength(0);
        expect(calls).not.toContain('PR #42 was already merged; repaired 0 remaining dependent(s)');
    });

    it('stops merged recovery on post-merge body drift before stale receipt lineage can matter', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const receipt = (
            id: string,
            body: string,
            closingIssue: number,
            createdAt: string
        ): DeliveryReceiptComment => ({
            id,
            body: deliveryReceiptBody(42, 'head', body, closingIssue),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt,
            updatedAt: createdAt,
        });
        const { port, calls, receipts, tracker } = fakePort({
            primary: [
                pullRequest({ body: bodyX }),
                pullRequest({ body: bodyX }),
                pullRequest({ state: 'MERGED', body: bodyX }),
                pullRequest({ state: 'MERGED', body: relationshipBody('None.') }),
                pullRequest({ state: 'MERGED', body: relationshipBody('None.') }),
            ],
            dependentSets: [[], [], []],
            receipts: [
                receipt('IC_historical_x', bodyX, 2372, '2026-08-21T00:00:00.000Z'),
                receipt('IC_hidden_y', bodyY, 2373, '2026-08-21T00:00:01.000Z'),
            ],
        });
        let failTrackerOnce = true;
        tracker.complete = (issueNumber) => {
            calls.push(`complete:${issueNumber}`);
            if (failTrackerOnce) {
                failTrackerOnce = false;
                throw new Error('tracker unavailable');
            }
        };
        let staleMergedRecovery = false;
        let receiptReadCount = 0;
        let staleMergedRecoveryReadCount = 0;
        const originalDeliveryReceipts = port.deliveryReceipts;
        port.deliveryReceipts = (number) => {
            calls.push(`receipts:${number}`);
            receiptReadCount += 1;
            if (staleMergedRecovery) {
                staleMergedRecoveryReadCount += 1;
            }
            if (staleMergedRecovery && staleMergedRecoveryReadCount <= 5) {
                return structuredClone(receipts.slice(0, 2));
            }
            return originalDeliveryReceipts(number);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(
            /PR #42.*merged.*issue #2372.*tracker unavailable/i
        );
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);

        staleMergedRecovery = true;
        staleMergedRecoveryReadCount = 0;
        const receiptReadsBeforeRecovery = calls.filter((call) => call === 'receipts:42').length;
        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/body changed during delivery/i);
        expect(calls.filter((call) => call === 'receipts:42')).toHaveLength(receiptReadsBeforeRecovery);
        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(1);
        expect(calls.filter((call) => call === 'complete:2373')).toHaveLength(0);

        staleMergedRecovery = false;
        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/body changed during delivery/i);
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(1);
        expect(calls.filter((call) => call === 'complete:2373')).toHaveLength(0);
        expect(calls).not.toContain('PR #42 was already merged; repaired 0 remaining dependent(s)');
    });

    it('fails closed when legacy merged recovery sees the same stale X prefix twice while actual history is X then Y', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const receipt = (
            id: string,
            body: string,
            closingIssue: number,
            createdAt: string
        ): DeliveryReceiptComment => ({
            id,
            body: deliveryReceiptBody(42, 'head', body, closingIssue),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt,
            updatedAt: createdAt,
        });
        const { port, calls, receipts, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
            dependentSets: [[]],
            receipts: [
                receipt('IC_historical_x', bodyX, 2372, '2026-08-21T00:00:00.000Z'),
                receipt('IC_hidden_y', bodyY, 2373, '2026-08-21T00:00:01.000Z'),
            ],
        });
        port.deliveryReceipts = (number) => {
            calls.push(`receipts:${number}`);
            return structuredClone(receipts.slice(0, 1));
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(
            /delivery receipt authority cannot be proven|delivery receipt changed during recovery/i
        );
        expect(calls).not.toContain('retarget:43:main');
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls).not.toContain('receipt-authority:write:terminal:IC_historical_x');
    });

    it('fails closed when legacy merged recovery reads disagree from stale Y back to X with no persisted authority', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const receipt = (
            id: string,
            body: string,
            closingIssue: number,
            createdAt: string
        ): DeliveryReceiptComment => ({
            id,
            body: deliveryReceiptBody(42, 'head', body, closingIssue),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt,
            updatedAt: createdAt,
        });
        const { port, calls, receipts, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
            dependentSets: [[]],
            receipts: [
                receipt('IC_historical_x', bodyX, 2372, '2026-08-21T00:00:00.000Z'),
                receipt('IC_hidden_y', bodyY, 2373, '2026-08-21T00:00:01.000Z'),
            ],
        });
        let readCount = 0;
        port.deliveryReceipts = (number) => {
            calls.push(`receipts:${number}`);
            readCount += 1;
            return structuredClone(readCount === 1 ? receipts.slice(0, 2) : receipts.slice(0, 1));
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls).not.toContain('retarget:43:main');
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('receipt-authority:write:terminal:'))).toHaveLength(0);
    });

    it('fails closed when duplicate legacy v1 receipts remain after merge with no persisted authority anchor', () => {
        const closes = relationshipBody('Closes #2372');
        const duplicate = (id: string, createdAt: string): DeliveryReceiptComment => ({
            id,
            body: deliveryReceiptBody(42, 'head', closes, 2372),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt,
            updatedAt: createdAt,
        });
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
            dependentSets: [[]],
            receipts: [duplicate('IC_v1_a', '2026-08-21T00:00:00Z'), duplicate('IC_v1_b', '2026-08-21T00:00:01Z')],
            deliveryReceiptProof: { totalCount: 2, latestCommentId: 'IC_v1_b' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('receipt-authority:write:merge-authorized:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('receipt-authority:write:terminal:'))).toHaveLength(0);
    });

    it('fails closed when compatible legacy v1 then visible v2 receipts remain after merge with no persisted authority anchor', () => {
        const closes = relationshipBody('Closes #2372');
        const legacyReceipt = {
            id: 'IC_v1_legacy',
            body: deliveryReceiptBody(42, 'head', closes, 2372),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:00Z',
            updatedAt: '2026-08-21T00:00:00Z',
        };
        const visibleReceipt = {
            id: 'IC_v2_visible',
            body: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:01Z',
            updatedAt: '2026-08-21T00:00:01Z',
        };
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
            dependentSets: [[]],
            receipts: [legacyReceipt, visibleReceipt],
            deliveryReceiptProof: { totalCount: 2, latestCommentId: 'IC_v2_visible' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('receipt-authority:write:merge-authorized:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('receipt-authority:write:terminal:'))).toHaveLength(0);
    });

    it('fails closed when merged legacy recovery sees two complete raw v1 keys with no persisted authority anchor', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const receipt = (
            id: string,
            body: string,
            closingIssue: number,
            createdAt: string
        ): DeliveryReceiptComment => ({
            id,
            body: deliveryReceiptBody(42, 'head', body, closingIssue),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt,
            updatedAt: createdAt,
        });
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
            dependentSets: [[]],
            receipts: [
                receipt('IC_historical_x', bodyX, 2372, '2026-08-21T00:00:00Z'),
                receipt('IC_historical_y', bodyY, 2373, '2026-08-21T00:00:01Z'),
            ],
            deliveryReceiptProof: { totalCount: 2, latestCommentId: 'IC_historical_y' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('receipt-authority:write:merge-authorized:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('receipt-authority:write:terminal:'))).toHaveLength(0);
    });

    it('fails closed when a merged head shows one visible receipt but no persisted authority anchors it against deleted newer comments', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: closes, mergedByActorNodeId: AUTHOR_BOT_NODE_ID })],
            dependentSets: [[]],
            receipts: [
                {
                    id: 'IC_v2_only',
                    body: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 1, latestCommentId: 'IC_v2_only' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls).not.toContain('receipt-proof:42:1:IC_v2_only');
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('receipt-authority:write:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('retarget:'))).toHaveLength(0);
        expect(calls).not.toContain('PR #42 was already merged; repaired 0 remaining dependent(s)');
    });

    it('fails closed when comments once held A then B but merged recovery can only see surviving A with no persisted authority', () => {
        const closesA = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
            dependentSets: [[]],
            receipts: [
                {
                    id: 'IC_historical_a',
                    body: deliveryReceiptBody(42, 'head', closesA, 2372),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 1, latestCommentId: 'IC_historical_a' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(
            /delivery receipt authority cannot be proven|delivery receipt changed during recovery/i
        );
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('receipt-authority:write:merge-authorized:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('receipt-authority:write:terminal:'))).toHaveLength(0);
    });

    it('recovers the exact legacy persisted receipt id instead of switching to a newer different-key receipt', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const receipt = (
            id: string,
            body: string,
            closingIssue: number,
            createdAt: string
        ): DeliveryReceiptComment => ({
            id,
            body: deliveryReceiptBody(42, 'head', body, closingIssue),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt,
            updatedAt: createdAt,
        });
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: bodyX })],
            dependentSets: [[]],
            persistedReceiptAuthority: { phase: 'legacy', receiptId: 'IC_legacy_a' },
            receipts: [
                receipt('IC_legacy_a', bodyX, 2372, '2026-08-21T00:00:00Z'),
                receipt('IC_legacy_b', bodyY, 2373, '2026-08-21T00:00:01Z'),
            ],
            deliveryReceiptProof: { totalCount: 2, latestCommentId: 'IC_legacy_b' },
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('complete:2372');
        expect(calls).not.toContain('complete:2373');
        expect(calls).toContain('receipt-authority:write:merge-authorized:IC_legacy_a');
        expect(calls).toContain('receipt-authority:write:terminal:IC_legacy_a');
    });

    it('persists merged-snapshot validation when legacy recovery promotes to merge-authorized, then resumes after a dependent-repair crash', () => {
        const closes = relationshipBody('Closes #2372');
        const child = stacked();
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({
                    state: 'MERGED',
                    body: closes,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
                pullRequest({
                    state: 'MERGED',
                    body: closes,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[child], [child], []],
            persistedReceiptAuthority: { phase: 'legacy', receiptId: 'IC_legacy_a' },
            receipts: [
                {
                    id: 'IC_legacy_a',
                    body: deliveryReceiptBody(42, 'head', closes, 2372),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 1, latestCommentId: 'IC_legacy_a' },
        });
        let dependentsReadCount = 0;
        const originalDependents = port.dependents;
        port.dependents = (baseBranch) => {
            dependentsReadCount += 1;
            if (dependentsReadCount === 1) {
                throw new Error('dependent listing unavailable');
            }
            return originalDependents(baseBranch);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/dependent listing unavailable/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'merge-authorized',
            receiptId: 'IC_legacy_a',
            receiptBody: deliveryReceiptBody(42, 'head', closes, 2372),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('receipt-authority:read:merge-authorized:IC_legacy_a');
        expect(calls).toContain('receipt-authority:write:terminal:IC_legacy_a');
        expect(calls).toContain('retarget:43:main');
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_legacy_a',
            receiptBody: deliveryReceiptBody(42, 'head', closes, 2372),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
    });

    it('fails closed when the exact legacy persisted receipt id points at a different closing issue than the merged pull request body', () => {
        const oldBody = relationshipBody('Closes #2372');
        const mergedBody = relationshipBody('Closes #2373');
        const receipt = (
            id: string,
            body: string,
            closingIssue: number,
            createdAt: string
        ): DeliveryReceiptComment => ({
            id,
            body: deliveryReceiptBody(42, 'head', body, closingIssue),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt,
            updatedAt: createdAt,
        });
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: mergedBody })],
            dependentSets: [[]],
            persistedReceiptAuthority: { phase: 'legacy', receiptId: 'IC_legacy_a' },
            receipts: [
                receipt('IC_legacy_a', oldBody, 2372, '2026-08-21T00:00:00Z'),
                receipt('IC_legacy_b', mergedBody, 2373, '2026-08-21T00:00:01Z'),
            ],
            deliveryReceiptProof: { totalCount: 2, latestCommentId: 'IC_legacy_b' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt changed during recovery/i);
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('receipt-authority:write:merge-authorized:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('receipt-authority:write:terminal:'))).toHaveLength(0);
    });

    it('fails closed when the exact legacy persisted receipt id is missing from a later complete stable read', () => {
        const closes = relationshipBody('Closes #2372');
        const receipt = (id: string): DeliveryReceiptComment => ({
            id,
            body: deliveryReceiptBody(42, 'head', closes, 2372),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:00Z',
            updatedAt: '2026-08-21T00:00:00Z',
        });
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: closes })],
            dependentSets: [[]],
            persistedReceiptAuthority: { phase: 'legacy', receiptId: 'IC_legacy_a' },
            receipts: [receipt('IC_legacy_a')],
            deliveryReceiptProof: { totalCount: 1, latestCommentId: 'IC_legacy_a' },
        });
        let readCount = 0;
        port.deliveryReceipts = (number) => {
            calls.push(`receipts:${number}`);
            readCount += 1;
            return structuredClone(readCount === 1 ? [receipt('IC_legacy_a')] : [receipt('IC_legacy_b')]);
        };
        port.deliveryReceiptProof = (number) => {
            const latestCommentId = readCount === 1 ? 'IC_legacy_a' : 'IC_legacy_b';
            calls.push(`receipt-proof:${number}:1:${latestCommentId}`);
            return deliveryReceiptProofForIds([latestCommentId]);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt changed during recovery/i);
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
    });

    it('fails closed when a proven merged lineage contains an edited author-App comment whose receipt marker was erased', () => {
        const closes = relationshipBody('Closes #2372');
        const validReceipt = {
            id: 'IC_valid_receipt',
            body: deliveryReceiptBody(42, 'head', closes, 2372),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:00Z',
            updatedAt: '2026-08-21T00:00:00Z',
        };
        const editedErasedReceipt = {
            id: 'IC_edited_erased_receipt',
            body: 'ordinary follow-up text after an edit',
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:01Z',
            updatedAt: '2026-08-21T00:00:02Z',
        };
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
            dependentSets: [[]],
            receipts: [validReceipt, editedErasedReceipt],
            deliveryReceiptProof: { totalCount: 2, latestCommentId: 'IC_edited_erased_receipt' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('retarget:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('receipt-authority:write:'))).toHaveLength(0);
    });

    it('publishes a fresh X when two pre-merge stale listings both hide newer Y, then fails closed on merged body drift', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const receipt = (
            id: string,
            body: string,
            closingIssue: number,
            createdAt: string
        ): DeliveryReceiptComment => ({
            id,
            body: deliveryReceiptBody(42, 'head', body, closingIssue),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt,
            updatedAt: createdAt,
        });
        const { port, calls, receipts, tracker } = fakePort({
            primary: [
                pullRequest({ body: bodyX }),
                pullRequest({ body: bodyX }),
                pullRequest({ state: 'MERGED', body: bodyX }),
                pullRequest({ state: 'MERGED', body: relationshipBody('None.') }),
            ],
            dependentSets: [[], []],
            receipts: [
                {
                    id: 'IC_historical_x',
                    body: visibleDeliveryReceiptBody(42, 'head', bodyX, 2372, 'successful'),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00.000Z',
                    updatedAt: '2026-08-21T00:00:00.000Z',
                },
                receipt('IC_hidden_y', bodyY, 2373, '2026-08-21T00:00:01.000Z'),
            ],
        });
        let receiptReadCount = 0;
        port.deliveryReceipts = (number) => {
            calls.push(`receipts:${number}`);
            receiptReadCount += 1;
            if (receiptReadCount <= 2) {
                return structuredClone(receipts.slice(0, 1));
            }
            return structuredClone(receipts);
        };
        let failTrackerOnce = true;
        tracker.complete = (issueNumber) => {
            calls.push(`complete:${issueNumber}`);
            if (failTrackerOnce) {
                failTrackerOnce = false;
                throw new Error('tracker unavailable');
            }
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(
            /PR #42.*merged.*issue #2372.*tracker unavailable/i
        );
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls.filter((call) => call === 'merge:42:head')).toHaveLength(1);
        expect(receipts.map((entry) => entry.body)).toEqual([
            visibleDeliveryReceiptBody(42, 'head', bodyX, 2372, 'successful'),
            deliveryReceiptBody(42, 'head', bodyY, 2373),
            visibleDeliveryReceiptBody(42, 'head', bodyX, 2372, 'successful'),
        ]);

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/body changed during delivery/i);
        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(1);
        expect(calls.filter((call) => call === 'complete:2373')).toHaveLength(0);
        expect(calls).not.toContain('PR #42 was already merged; repaired 0 remaining dependent(s)');
    });

    it('re-runs prepared merged validation and keeps rejecting body drift after merge succeeded', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({ body: bodyX }),
                pullRequest({ body: bodyX }),
                pullRequest({ state: 'MERGED', body: bodyY }),
                pullRequest({ state: 'MERGED', body: bodyY }),
            ],
            dependentSets: [[], []],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/body changed during delivery/i);
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls.filter((call) => call === 'merge:42:head')).toHaveLength(1);
        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(0);
        expect(calls.filter((call) => call === 'complete:2373')).toHaveLength(0);

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/body changed during delivery/i);
        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(0);
        expect(calls.filter((call) => call === 'complete:2373')).toHaveLength(0);
    });

    it('persists merge-authorized recovery before a final-refresh merged dependent read fails, then resumes from that authority', () => {
        const closes = relationshipBody('Closes #2372');
        const child = stacked();
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ state: 'MERGED', body: closes }),
                pullRequest({ state: 'MERGED', body: closes, mergedByActorNodeId: AUTHOR_BOT_NODE_ID }),
            ],
            dependentSets: [[child], [child], []],
        });
        let dependentsReadCount = 0;
        const originalDependents = port.dependents;
        port.dependents = (baseBranch) => {
            dependentsReadCount += 1;
            if (dependentsReadCount === 2) {
                throw new Error('dependent listing unavailable');
            }
            return originalDependents(baseBranch);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/dependent listing unavailable/i);
        expect(calls).toContain('receipt-authority:write:prepared:IC_delivery_42_1');
        expect(calls).toContain('receipt-authority:write:merge-authorized:IC_delivery_42_1');
        expect(calls).not.toContain('receipt-authority:write:terminal:IC_delivery_42_1');
        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(0);

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(1);
        expect(calls).toContain('receipt-authority:read:merge-authorized:IC_delivery_42_1');
        expect(calls.filter((call) => call === 'receipt-authority:write:terminal:IC_delivery_42_1')).toHaveLength(1);
        expect(calls).toContain('PR #42 was already merged; repaired 1 remaining dependent(s)');
    });

    it.each([
        {
            label: 'head branch',
            mergedPrimaryAfterRecovery: { headRefName: 'feat/rewritten-head' },
            error: /headRefName changed during delivery/,
        },
        {
            label: 'base branch',
            mergedPrimaryAfterRecovery: { baseRefName: 'release/1.0' },
            error: /targets release\/1.0, not main|baseRefName changed during delivery/,
        },
        {
            label: 'body and closing target',
            mergedPrimaryAfterRecovery: { body: `${relationshipBody('Closes #9999')}\nChanged note.` },
            error: /body changed during delivery/,
        },
    ])(
        'persists merge-authorized post-merge validation and refuses already-merged recovery when the $label drifts after a crash',
        ({ mergedPrimaryAfterRecovery, error }) => {
            const closes = relationshipBody('Closes #2372');
            const child = stacked();
            const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
                primary: [
                    pullRequest({ body: closes }),
                    pullRequest({ state: 'MERGED', body: closes }),
                    pullRequest({
                        state: 'MERGED',
                        body: closes,
                        mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                        ...mergedPrimaryAfterRecovery,
                    }),
                ],
                dependentSets: [[child], [child], []],
            });
            let dependentsReadCount = 0;
            const originalDependents = port.dependents;
            port.dependents = (baseBranch) => {
                dependentsReadCount += 1;
                if (dependentsReadCount === 2) {
                    throw new Error('dependent listing unavailable');
                }
                return originalDependents(baseBranch);
            };

            expect(() => deliverPullRequest(42, port, tracker)).toThrow(/dependent listing unavailable/i);
            expect(persistedReceiptAuthority()).toEqual({
                phase: 'merge-authorized',
                receiptId: 'IC_delivery_42_1',
                receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
                postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
            });
            expect(calls.filter((call) => call === 'retarget:43:main')).toHaveLength(0);
            expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);

            expect(() => deliverPullRequest(42, port, tracker)).toThrow(error);
            expect(calls.filter((call) => call === 'retarget:43:main')).toHaveLength(0);
            expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
            expect(calls).not.toContain('receipt-authority:write:terminal:IC_delivery_42_1');
        }
    );

    it('persists terminal post-merge validation and refuses already-merged headRefName drift before any effect', () => {
        const closes = relationshipBody('Closes #2372');
        const child = stacked();
        const receiptBody = visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful');
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({
                    state: 'MERGED',
                    body: closes,
                    headRefName: 'feat/rewritten-head',
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[child]],
            persistedReceiptAuthority: {
                phase: 'terminal',
                receiptId: 'IC_terminal_validated',
                receiptBody,
                postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
            },
            receipts: [
                {
                    id: 'IC_terminal_validated',
                    body: receiptBody,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 1, latestCommentId: 'IC_terminal_validated' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/headRefName changed during delivery/);
        expect(calls).not.toContain('retarget:43:main');
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_terminal_validated',
            receiptBody,
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
    });

    it('persists merged prepared authority before a transient receipt read failure, then recovers on retry', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ state: 'MERGED', body: closes }),
                pullRequest({ state: 'MERGED', body: closes }),
            ],
            dependentSets: [[], []],
        });
        let receiptReads = 0;
        const originalDeliveryReceipts = port.deliveryReceipts;
        port.deliveryReceipts = (number) => {
            receiptReads += 1;
            if (receiptReads === 4) {
                throw new Error('transient receipt read failure');
            }
            return originalDeliveryReceipts(number);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/transient receipt read failure/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
        expect(calls).not.toContain('receipt-authority:write:merge-authorized:IC_delivery_42_1');
        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(0);

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls).toContain('receipt-authority:read:prepared:IC_delivery_42_1');
        expect(calls).toContain('receipt-authority:write:merge-authorized:IC_delivery_42_1');
        expect(calls).toContain('receipt-authority:write:terminal:IC_delivery_42_1');
        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(1);
    });

    it('re-arms to the current open receipt on a stale retry and then refuses merged recovery if the merged body reverts', () => {
        const closesX = relationshipBody('Closes #2372');
        const closesY = relationshipBody('Closes #2373');
        const receiptBodyX = visibleDeliveryReceiptBody(42, 'head', closesX, 2372, 'successful');
        const receiptBodyY = visibleDeliveryReceiptBody(42, 'head', closesY, 2373, 'successful');
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({ body: closesY }),
                pullRequest({ state: 'MERGED', body: closesX }),
                pullRequest({ state: 'MERGED', body: closesX }),
            ],
            dependentSets: [[]],
            persistedReceiptAuthority: {
                phase: 'prepared',
                receiptId: 'IC_frozen_x',
                receiptBody: receiptBodyX,
                postMergeValidation: persistedPostMergeValidation('head', closesX, 2372),
            },
            receipts: [
                {
                    id: 'IC_frozen_x',
                    body: receiptBodyX,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
                {
                    id: 'IC_stale_y',
                    body: visibleDeliveryReceiptBody(42, 'head', closesY, 2373, 'successful'),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:01Z',
                    updatedAt: '2026-08-21T00:00:01Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 2, latestCommentId: 'IC_stale_y' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/body changed during delivery/i);
        expect(calls).not.toContain('add-receipt:42');
        expect(calls).not.toContain('merge:42:head');
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_stale_y',
            receiptBody: receiptBodyY,
            postMergeValidation: persistedPostMergeValidation('head', closesY, 2373),
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/body changed during delivery/i);
        expect(calls).toContain('receipt-authority:write:released:IC_frozen_x');
        expect(calls).toContain('receipt-authority:write:prepared:IC_stale_y');
        expect(calls).not.toContain('receipt-authority:write:merge-authorized:IC_frozen_x');
        expect(calls).not.toContain('receipt-authority:write:terminal:IC_frozen_x');
        expect(calls).not.toContain('receipt-authority:write:merge-authorized:IC_stale_y');
        expect(calls).not.toContain('receipt-authority:write:terminal:IC_stale_y');
        expect(calls).not.toContain('complete:2372');
        expect(calls).not.toContain('complete:2373');
    });

    it('recovers from a late-merged merge-authorized write failure using prepared post-merge validation', () => {
        const closes = relationshipBody('Closes #2372');
        const child = stacked();
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ state: 'MERGED', body: closes }),
                pullRequest({ state: 'MERGED', body: closes }),
            ],
            dependentSets: [[child], [child], []],
        });
        const originalWriteDeliveryReceiptAuthority = port.writeDeliveryReceiptAuthority;
        let failMergeAuthorizedWrite = true;
        port.writeDeliveryReceiptAuthority = (number, authority) => {
            if (authority.phase === 'merge-authorized' && failMergeAuthorizedWrite) {
                failMergeAuthorizedWrite = false;
                throw new Error('authority persistence unavailable');
            }
            originalWriteDeliveryReceiptAuthority(number, authority);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/authority persistence unavailable/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
        expect(calls).toContain('receipt-authority:write:prepared:IC_delivery_42_1');
        expect(calls).not.toContain('receipt-authority:write:terminal:IC_delivery_42_1');
        expect(calls).not.toContain('retarget:43:main');
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls).toContain('receipt-authority:read:prepared:IC_delivery_42_1');
        expect(calls).toContain('receipt-authority:write:merge-authorized:IC_delivery_42_1');
        expect(calls).toContain('retarget:43:main');
        expect(calls).toContain('complete:2372');
        expect(calls).toContain('receipt-authority:write:terminal:IC_delivery_42_1');
        expect(calls).toContain('PR #42 was already merged; repaired 1 remaining dependent(s)');
    });

    it('persists prepared post-merge validation before a second fetch throws after merge, then recovers on retry', () => {
        const closes = relationshipBody('Closes #2372');
        const child = stacked();
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ state: 'MERGED', body: closes }),
                pullRequest({ state: 'MERGED', body: closes, mergedByActorNodeId: AUTHOR_BOT_NODE_ID }),
            ],
            dependentSets: [[child], [child], []],
        });
        const originalFetch = port.fetch;
        let fetchCount = 0;
        port.fetch = () => {
            fetchCount += 1;
            originalFetch();
            if (fetchCount === 2) {
                throw new Error('fetch interrupted after merge');
            }
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/fetch interrupted after merge/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
        expect(calls).toContain('receipt-authority:write:prepared:IC_delivery_42_1');
        expect(calls).not.toContain('merge:42:head');
        expect(calls).not.toContain('retarget:43:main');
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls).toContain('receipt-authority:read:prepared:IC_delivery_42_1');
        expect(calls).toContain('retarget:43:main');
        expect(calls).toContain('complete:2372');
        expect(calls).toContain('receipt-authority:write:terminal:IC_delivery_42_1');
    });

    it('disarms a failed open final-refresh validation so a later body-drift retry can deliver the current receipt', () => {
        const closesX = relationshipBody('Closes #2372');
        const closesY = relationshipBody('Closes #2373');
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ body: closesX }),
                pullRequest({ body: closesY }),
                pullRequest({ body: closesY }),
                pullRequest({ body: closesY }),
            ],
            dependentSets: [[], []],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/closing target changed during delivery/i);
        expect(calls.filter((call) => call === 'merge:42:head')).toHaveLength(0);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closesX, 2372, 'successful'),
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(calls.filter((call) => call === 'merge:42:head')).toHaveLength(1);
        expect(calls).toContain('complete:2373');
        expect(calls).not.toContain('complete:2372');
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closesY, 2373, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closesY, 2373),
        });
    });

    it('disarms a failed merge attempt that left the PR open so a later body-drift retry can deliver the current receipt', () => {
        const closesX = relationshipBody('Closes #2372');
        const closesY = relationshipBody('Closes #2373');
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ body: closesX }),
                pullRequest({ body: closesX }),
                pullRequest({ body: closesX }),
                pullRequest({ body: closesY }),
                pullRequest({ body: closesY }),
            ],
            dependentSets: [[], []],
        });
        const originalMerge = port.merge;
        let failMergeOnce = true;
        port.merge = (number, head, hasDependents) => {
            if (failMergeOnce) {
                failMergeOnce = false;
                calls.push(`merge:${number}:${head}`);
                throw new DeliveryMergeRejectedError('PR #42 was not merged: merge unavailable');
            }
            originalMerge(number, head, hasDependents);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/was not merged: merge unavailable/i);
        expect(calls.filter((call) => call === 'merge:42:head')).toHaveLength(1);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closesX, 2372, 'successful'),
        });
        expect(calls).not.toContain('complete:2372');
        expect(calls).not.toContain('complete:2373');

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(calls.filter((call) => call === 'merge:42:head')).toHaveLength(2);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(calls).toContain('complete:2373');
        expect(calls).not.toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closesY, 2373, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closesY, 2373),
        });
    });

    it('disarms a proven merge rejection after head drift leaves the PR open, so the new head can deliver on retry', () => {
        const closes = relationshipBody('Closes #2372');
        const nextHead = 'rewritten-head';
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ headRefOid: 'head', body: closes }),
                pullRequest({ headRefOid: 'head', body: closes }),
                pullRequest({ headRefOid: nextHead, body: closes }),
                pullRequest({ headRefOid: nextHead, body: closes }),
                pullRequest({ headRefOid: nextHead, body: closes }),
            ],
            dependentSets: [[], []],
        });
        const originalMerge = port.merge;
        let rejectOnce = true;
        port.merge = (number, head, hasDependents) => {
            if (rejectOnce) {
                rejectOnce = false;
                calls.push(`merge:${number}:${head}`);
                throw new DeliveryMergeRejectedError('PR #42 was not merged: gh: HTTP 409: head SHA changed');
            }
            originalMerge(number, head, hasDependents);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/HTTP 409: head SHA changed/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
        });
        expect(calls).not.toContain('complete:2372');

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(calls).toContain(`merge:42:${nextHead}`);
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, nextHead, closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation(nextHead, closes, 2372),
        });
    });

    it('disarms a merge rejection when the follow-up refresh observes a corrected OPEN head before drift aborts the read, then lets that head deliver on retry', () => {
        const closes = relationshipBody('Closes #2372');
        const nextHead = 'rewritten-head';
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ headRefOid: 'head', body: closes }),
                pullRequest({ headRefOid: 'head', body: closes }),
                pullRequest({ headRefOid: 'head', body: closes, mergeable: 'UNKNOWN' }),
                pullRequest({ headRefOid: nextHead, body: closes, mergeable: 'MERGEABLE' }),
                pullRequest({ headRefOid: nextHead, body: closes }),
                pullRequest({ headRefOid: nextHead, body: closes }),
            ],
            dependentSets: [[], []],
        });
        const originalMerge = port.merge;
        let rejectOnce = true;
        port.merge = (number, head, hasDependents) => {
            if (rejectOnce) {
                rejectOnce = false;
                calls.push(`merge:${number}:${head}`);
                throw new DeliveryMergeRejectedError('PR #42 was not merged: gh: HTTP 409: head SHA changed');
            }
            originalMerge(number, head, hasDependents);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/HTTP 409: head SHA changed/i);
        expect(calls).toContain('merge:42:head');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
        });
        expect(calls).not.toContain('complete:2372');

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(calls.filter((call) => call.startsWith('merge:42:'))).toEqual(['merge:42:head', `merge:42:${nextHead}`]);
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, nextHead, closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation(nextHead, closes, 2372),
        });
    });

    it('disarms a proven merge rejection after the PR closes unmerged, then lets a reopened new head deliver on retry', () => {
        const closes = relationshipBody('Closes #2372');
        const nextHead = 'reopened-head';
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ headRefOid: 'head', body: closes }),
                pullRequest({ headRefOid: 'head', body: closes }),
                pullRequest({ state: 'CLOSED', headRefOid: 'head', body: closes }),
                pullRequest({ state: 'OPEN', headRefOid: nextHead, body: closes }),
                pullRequest({ state: 'OPEN', headRefOid: nextHead, body: closes }),
            ],
            dependentSets: [[], []],
        });
        const originalMerge = port.merge;
        let rejectOnce = true;
        port.merge = (number, head, hasDependents) => {
            if (rejectOnce) {
                rejectOnce = false;
                calls.push(`merge:${number}:${head}`);
                throw new DeliveryMergeRejectedError('PR #42 was not merged: gh: HTTP 409: closed without merge');
            }
            originalMerge(number, head, hasDependents);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/HTTP 409: closed without merge/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
        });
        expect(calls).not.toContain('complete:2372');

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(calls).toContain(`merge:42:${nextHead}`);
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, nextHead, closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation(nextHead, closes, 2372),
        });
    });

    it('disarms a definitive CLOSED unmerged rejection before an UNKNOWN refresh can reopen on a new head', () => {
        const closes = relationshipBody('Closes #2372');
        const nextHead = 'reopened-head';
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ headRefOid: 'head', body: closes }),
                pullRequest({ headRefOid: 'head', body: closes }),
                pullRequest({ state: 'CLOSED', headRefOid: 'head', body: closes, mergeable: 'UNKNOWN' }),
                pullRequest({ state: 'OPEN', headRefOid: nextHead, body: closes }),
                pullRequest({ state: 'OPEN', headRefOid: nextHead, body: closes }),
            ],
            dependentSets: [[], []],
        });
        const originalMerge = port.merge;
        let rejectOnce = true;
        port.merge = (number, head, hasDependents) => {
            if (rejectOnce) {
                rejectOnce = false;
                calls.push(`merge:${number}:${head}`);
                throw new DeliveryMergeRejectedError('PR #42 was not merged: gh: HTTP 409: closed without merge');
            }
            originalMerge(number, head, hasDependents);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/HTTP 409: closed without merge/i);
        expect(calls).toContain('merge:42:head');
        expect(calls).not.toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(calls).toContain(`merge:42:${nextHead}`);
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, nextHead, closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation(nextHead, closes, 2372),
        });
    });

    it('restores the pre-final-fetch prepared authority when the final fetch resolves to OPEN CONFLICTING, then lets a corrected head deliver on retry', () => {
        const closes = relationshipBody('Closes #2372');
        const nextHead = 'corrected-head';
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ headRefOid: 'head', body: closes }),
                pullRequest({ headRefOid: 'head', body: closes, mergeable: 'UNKNOWN' }),
                pullRequest({ headRefOid: 'head', body: closes, mergeable: 'CONFLICTING' }),
                pullRequest({ headRefOid: nextHead, body: closes }),
                pullRequest({ headRefOid: nextHead, body: closes }),
            ],
            dependentSets: [[], []],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/conflicting changes/i);
        expect(calls).not.toContain('merge:42:head');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
        });
        expect(calls).not.toContain('complete:2372');

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(calls).toContain(`merge:42:${nextHead}`);
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, nextHead, closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation(nextHead, closes, 2372),
        });
    });

    it('releases retained authority when an OPEN UNKNOWN retry resolves to CLOSED before validation, then lets a reopened head and body deliver', () => {
        const closesX = relationshipBody('Closes #2372');
        const closesY = relationshipBody('Closes #2373');
        const nextHead = 'reopened-head';
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ body: closesX }),
                pullRequest({ body: closesX }),
                pullRequest({ body: closesX, mergeable: 'UNKNOWN' }),
                new Error('PR #42 merge recovery became unreadable'),
                pullRequest({ body: closesX, mergeable: 'UNKNOWN' }),
                pullRequest({ state: 'CLOSED', headRefOid: nextHead, body: closesY, mergeable: 'UNKNOWN' }),
                pullRequest({ headRefOid: nextHead, body: closesY }),
                pullRequest({ headRefOid: nextHead, body: closesY }),
            ],
            dependentSets: [[], [], []],
        });
        const originalMerge = port.merge;
        let rejectOnce = true;
        port.merge = (number, head, hasDependents) => {
            if (rejectOnce) {
                rejectOnce = false;
                calls.push(`merge:${number}:${head}`);
                throw new DeliveryMergeRejectedError('PR #42 was not merged: gh: HTTP 409: merge result ambiguous');
            }
            originalMerge(number, head, hasDependents);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/HTTP 409: merge result ambiguous/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closesX, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closesX, 2372),
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/PR #42 is closed/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'released',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closesX, 2372, 'successful'),
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(calls).toContain(`merge:42:${nextHead}`);
        expect(calls).toContain('complete:2373');
        expect(calls).not.toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, nextHead, closesY, 2373, 'successful'),
            postMergeValidation: persistedPostMergeValidation(nextHead, closesY, 2373),
        });
    });

    it('releases legacy authority after a definitive CLOSED result, then refuses merged recovery until a later OPEN delivery re-arms it', () => {
        const closes = relationshipBody('Closes #2372');
        const nextHead = 'reopened-head';
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ state: 'CLOSED', headRefOid: 'head', body: closes }),
                pullRequest({ state: 'MERGED', headRefOid: nextHead, body: closes }),
                pullRequest({ state: 'OPEN', headRefOid: nextHead, body: closes }),
                pullRequest({ state: 'OPEN', headRefOid: nextHead, body: closes }),
            ],
            dependentSets: [[], []],
            persistedReceiptAuthority: { phase: 'legacy', receiptId: 'IC_legacy_v1' },
            receipts: [
                {
                    id: 'IC_legacy_v1',
                    body: deliveryReceiptBody(42, 'head', closes, 2372),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/PR #42 is closed/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'released',
            receiptId: 'IC_legacy_v1',
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(0);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_legacy_v1']);

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_legacy_v1', 'IC_delivery_42_2']);
        expect(calls).toContain(`merge:42:${nextHead}`);
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, nextHead, closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation(nextHead, closes, 2372),
        });
    });

    it('fails closed when merged recovery only has a trailing same-key legacy v1 comment after the persisted authority is gone', () => {
        const closes = relationshipBody('Closes #2372');
        const currentVisible = visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful');
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
            receipts: [
                {
                    id: 'IC_visible_v2',
                    body: currentVisible,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00.000Z',
                    updatedAt: '2026-08-21T00:00:00.000Z',
                },
                {
                    id: 'IC_trailing_v1',
                    body: deliveryReceiptBody(42, 'head', closes, 2372),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:01.000Z',
                    updatedAt: '2026-08-21T00:00:01.000Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 2, latestCommentId: 'IC_trailing_v1' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls).not.toContain('receipt-proof:42:2:IC_trailing_v1');
        expect(calls).not.toContain('receipt-authority:write:merge-authorized:IC_trailing_v1');
        expect(calls).not.toContain('receipt-authority:write:terminal:IC_trailing_v1');
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls).not.toContain('add-receipt:42');
    });

    it('restores the pre-final-fetch prepared authority when an UNKNOWN refresh discovers a corrected OPEN MERGEABLE head, then lets that head deliver on retry', () => {
        const closes = relationshipBody('Closes #2372');
        const nextHead = 'corrected-head';
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ headRefOid: 'head', body: closes }),
                pullRequest({ headRefOid: 'head', body: closes, mergeable: 'UNKNOWN' }),
                pullRequest({ headRefOid: nextHead, body: closes, mergeable: 'MERGEABLE' }),
                pullRequest({ headRefOid: nextHead, body: closes }),
                pullRequest({ headRefOid: nextHead, body: closes }),
            ],
            dependentSets: [[], []],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/headRefOid changed during delivery/);
        expect(calls).not.toContain('merge:42:head');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
        });
        expect(calls).not.toContain('complete:2372');

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(calls.filter((call) => call.startsWith('merge:42:'))).toEqual([`merge:42:${nextHead}`]);
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, nextHead, closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation(nextHead, closes, 2372),
        });
    });

    it('retains the final-fetch armed authority when an UNKNOWN refresh becomes unreadable before it can disprove a merge, then recovers on merged retry', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ headRefOid: 'head', body: closes }),
                pullRequest({ headRefOid: 'head', body: closes, mergeable: 'UNKNOWN' }),
                new Error('PR #42 final refresh became unreadable'),
                pullRequest({ state: 'MERGED', body: closes, mergedByActorNodeId: AUTHOR_BOT_NODE_ID }),
            ],
            dependentSets: [[], []],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/final refresh became unreadable/);
        expect(calls).not.toContain('merge:42:head');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });

        deliverPullRequest(42, port, tracker);

        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1']);
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
    });

    it.each([
        {
            label: 'head drift',
            retryHead: 'next-head',
            retryBody: relationshipBody('Closes #2372'),
            retryMergeStateStatus: 'CLEAN',
            expectedIssue: 2372,
            expectedCiState: 'successful',
        },
        {
            label: 'body drift',
            retryHead: 'head',
            retryBody: relationshipBody('Closes #2373'),
            retryMergeStateStatus: 'CLEAN',
            expectedIssue: 2373,
            expectedCiState: 'successful',
        },
        {
            label: 'CI drift',
            retryHead: 'head',
            retryBody: relationshipBody('Closes #2372'),
            retryMergeStateStatus: 'UNSTABLE',
            expectedIssue: 2372,
            expectedCiState: 'unstable',
        },
    ] satisfies Array<{
        label: string;
        retryHead: string;
        retryBody: string;
        retryMergeStateStatus: 'CLEAN' | 'UNSTABLE';
        expectedIssue: number;
        expectedCiState: 'successful' | 'unstable';
    }>)(
        'restores the pre-final-fetch prepared authority when the final fetch throws before any snapshot, so a later $label retry can deliver',
        ({ retryHead, retryBody, retryMergeStateStatus, expectedIssue, expectedCiState }) => {
            const closes = relationshipBody('Closes #2372');
            const retryHeadCheckRuns =
                retryMergeStateStatus === 'UNSTABLE'
                    ? supersededRunCheckRuns()
                    : ([checkRun()] satisfies HeadCheckRun[]);
            const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
                primary: [
                    pullRequest({ headRefOid: 'head', body: closes, mergeStateStatus: 'CLEAN' }),
                    new Error('PR #42 final fetch failed before any snapshot'),
                    pullRequest({ headRefOid: retryHead, body: retryBody, mergeStateStatus: retryMergeStateStatus }),
                    pullRequest({ headRefOid: retryHead, body: retryBody, mergeStateStatus: retryMergeStateStatus }),
                    pullRequest({ headRefOid: retryHead, body: retryBody, mergeStateStatus: retryMergeStateStatus }),
                ],
                dependentSets: [[], []],
                headCheckRunReads:
                    retryMergeStateStatus === 'UNSTABLE'
                        ? [[checkRun()], retryHeadCheckRuns, retryHeadCheckRuns]
                        : undefined,
            });

            expect(() => deliverPullRequest(42, port, tracker)).toThrow(/final fetch failed before any snapshot/i);
            expect(calls).not.toContain('merge:42:head');
            expect(persistedReceiptAuthority()).toEqual({
                phase: 'prepared',
                receiptId: 'IC_delivery_42_1',
                receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            });

            deliverPullRequest(42, port, tracker);

            expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
            expect(calls).toContain(`merge:42:${retryHead}`);
            expect(calls).toContain(`complete:${expectedIssue}`);
            expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
            expect(persistedReceiptAuthority()).toEqual({
                phase: 'terminal',
                receiptId: 'IC_delivery_42_2',
                receiptBody: visibleDeliveryReceiptBody(42, retryHead, retryBody, expectedIssue, expectedCiState),
                postMergeValidation: persistedPostMergeValidation(retryHead, retryBody, expectedIssue),
            });
        }
    );

    it('retains the final-fetch armed authority when fetch succeeds but the final snapshot read fails before any observation, then recovers on merged retry', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ headRefOid: 'head', body: closes, mergeStateStatus: 'CLEAN' }),
                new Error('PR #42 final snapshot read failed'),
                pullRequest({ state: 'MERGED', body: closes, mergedByActorNodeId: AUTHOR_BOT_NODE_ID }),
                pullRequest({ state: 'MERGED', body: closes, mergedByActorNodeId: AUTHOR_BOT_NODE_ID }),
            ],
            dependentSets: [[], []],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/final snapshot read failed/i);
        expect(calls).not.toContain('merge:42:head');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });

        deliverPullRequest(42, port, tracker);

        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1']);
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
    });

    it('retains the armed receipt authority after an OPEN UNKNOWN merge-rejection refresh resolves to an unrecognized state, then recovers on merged retry', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ body: closes, mergeable: 'UNKNOWN' }),
                pullRequest({ state: 'UNRECOGNIZED', body: closes, mergeable: 'MERGEABLE' }),
                pullRequest({
                    state: 'MERGED',
                    body: closes,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[], []],
        });
        let rejectOnce = true;
        port.merge = (number, head) => {
            calls.push(`merge:${number}:${head}`);
            if (rejectOnce) {
                rejectOnce = false;
                throw new DeliveryMergeRejectedError('PR #42 was not merged: gh: HTTP 409: merge result ambiguous');
            }
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/HTTP 409: merge result ambiguous/i);
        expect(calls).toContain('merge:42:head');
        expect(calls).not.toContain('receipt-authority:clear:prepared:IC_delivery_42_1');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
        expect(calls).not.toContain('complete:2372');

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls).toContain('receipt-authority:read:prepared:IC_delivery_42_1');
        expect(calls).toContain('receipt-authority:write:merge-authorized:IC_delivery_42_1');
        expect(calls).toContain('receipt-authority:write:terminal:IC_delivery_42_1');
        expect(calls).toContain('complete:2372');
        expect(calls).toContain('PR #42 was already merged; repaired 0 remaining dependent(s)');
    });

    it('retains the armed receipt authority after an OPEN UNKNOWN merge-rejection follow-up becomes unreadable, then recovers on merged retry', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ body: closes, mergeable: 'UNKNOWN' }),
                new Error('PR #42 merge recovery became unreadable'),
                pullRequest({
                    state: 'MERGED',
                    body: closes,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[], []],
        });
        let rejectOnce = true;
        port.merge = (number, head) => {
            calls.push(`merge:${number}:${head}`);
            if (rejectOnce) {
                rejectOnce = false;
                throw new DeliveryMergeRejectedError('PR #42 was not merged: gh: HTTP 409: merge result ambiguous');
            }
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/HTTP 409: merge result ambiguous/i);
        expect(calls).toContain('merge:42:head');
        expect(calls).not.toContain('receipt-authority:clear:prepared:IC_delivery_42_1');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls).toContain('receipt-authority:read:prepared:IC_delivery_42_1');
        expect(calls).toContain('receipt-authority:write:merge-authorized:IC_delivery_42_1');
        expect(calls).toContain('receipt-authority:write:terminal:IC_delivery_42_1');
        expect(calls).toContain('complete:2372');
        expect(calls).toContain('PR #42 was already merged; repaired 0 remaining dependent(s)');
    });

    it('retains the armed receipt authority after a merge rejection when every recovery read stays OPEN UNKNOWN, then recovers on merged retry', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ body: closes, mergeable: 'UNKNOWN' }),
                pullRequest({ body: closes, mergeable: 'UNKNOWN' }),
                pullRequest({
                    state: 'MERGED',
                    body: closes,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[], []],
        });
        let rejectOnce = true;
        port.merge = (number, head) => {
            calls.push(`merge:${number}:${head}`);
            if (rejectOnce) {
                rejectOnce = false;
                throw new DeliveryMergeRejectedError('PR #42 was not merged: gh: HTTP 409: merge result ambiguous');
            }
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/HTTP 409: merge result ambiguous/i);
        expect(calls).toContain('merge:42:head');
        expect(calls).not.toContain('receipt-authority:clear:prepared:IC_delivery_42_1');
        expect(calls).not.toContain('receipt-authority:write:released:IC_delivery_42_1');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
        expect(calls).not.toContain('complete:2372');

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls).toContain('receipt-authority:read:prepared:IC_delivery_42_1');
        expect(calls).toContain('receipt-authority:write:merge-authorized:IC_delivery_42_1');
        expect(calls).toContain('receipt-authority:write:terminal:IC_delivery_42_1');
        expect(calls).toContain('complete:2372');
        expect(calls).toContain('PR #42 was already merged; repaired 0 remaining dependent(s)');
    });

    it('restores the pre-armed authority after a merge rejection when recovery proves OPEN CONFLICTING, then lets a corrected head deliver', () => {
        const closes = relationshipBody('Closes #2372');
        const nextHead = 'corrected-head';
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ body: closes, mergeable: 'UNKNOWN' }),
                pullRequest({ body: closes, mergeable: 'CONFLICTING' }),
                pullRequest({ headRefOid: nextHead, body: closes }),
                pullRequest({ headRefOid: nextHead, body: closes }),
            ],
            dependentSets: [[], [], []],
        });
        const originalMerge = port.merge;
        let rejectOnce = true;
        port.merge = (number, head, hasDependents) => {
            if (rejectOnce) {
                rejectOnce = false;
                calls.push(`merge:${number}:${head}`);
                throw new DeliveryMergeRejectedError('PR #42 was not merged: gh: HTTP 409: merge result ambiguous');
            }
            originalMerge(number, head, hasDependents);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/HTTP 409: merge result ambiguous/i);
        expect(calls).toContain('receipt-authority:write:prepared:IC_delivery_42_1');
        expect(calls).not.toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(calls.filter((call) => call.startsWith('merge:42:'))).toEqual(['merge:42:head', `merge:42:${nextHead}`]);
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, nextHead, closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation(nextHead, closes, 2372),
        });
    });

    it('retains the armed receipt authority after an ambiguous merge error even when one follow-up read still looks open, then recovers on merged retry', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({
                    state: 'MERGED',
                    body: closes,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[], []],
        });
        const originalMerge = port.merge;
        const originalPullRequest = port.pullRequest;
        let failMergeOnce = true;
        let staleOpenRead = true;
        port.merge = (number, head, hasDependents) => {
            originalMerge(number, head, hasDependents);
            if (failMergeOnce) {
                failMergeOnce = false;
                throw new Error('merge response lost');
            }
        };
        port.pullRequest = (number) => {
            if (staleOpenRead) {
                staleOpenRead = false;
                return pullRequest({ body: closes });
            }
            return originalPullRequest(number);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/merge response lost/i);
        expect(calls).toContain('merge:42:head');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
        expect(calls).not.toContain('complete:2372');

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls).toContain('receipt-authority:read:prepared:IC_delivery_42_1');
        expect(calls).toContain('receipt-authority:write:merge-authorized:IC_delivery_42_1');
        expect(calls).toContain('receipt-authority:write:terminal:IC_delivery_42_1');
        expect(calls).toContain('complete:2372');
    });

    it('releases retained ambiguous merge authority when a later retry stays OPEN on a new head, then lets that head deliver', () => {
        const closes = relationshipBody('Closes #2372');
        const nextHead = 'rewritten-head';
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ body: closes, mergeable: 'UNKNOWN' }),
                new Error('PR #42 merge recovery became unreadable'),
                pullRequest({ headRefOid: nextHead, body: closes }),
                pullRequest({ headRefOid: nextHead, body: closes }),
            ],
            dependentSets: [[], [], []],
        });
        const originalMerge = port.merge;
        let rejectOnce = true;
        port.merge = (number, head, hasDependents) => {
            if (rejectOnce) {
                rejectOnce = false;
                calls.push(`merge:${number}:${head}`);
                throw new DeliveryMergeRejectedError('PR #42 was not merged: gh: HTTP 409: merge result ambiguous');
            }
            originalMerge(number, head, hasDependents);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/HTTP 409: merge result ambiguous/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('receipt-authority:write:released:IC_delivery_42_1');
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(calls.filter((call) => call.startsWith('merge:42:'))).toEqual(['merge:42:head', `merge:42:${nextHead}`]);
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, nextHead, closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation(nextHead, closes, 2372),
        });
    });

    it('fails closed when stale ambiguous authority changes before an OPEN new-head retry can release it', () => {
        const closes = relationshipBody('Closes #2372');
        const nextHead = 'rewritten-head';
        const hostileHead = 'hostile-head';
        const { port, calls, tracker, receipts, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ body: closes, mergeable: 'UNKNOWN' }),
                new Error('PR #42 merge recovery became unreadable'),
                pullRequest({ headRefOid: nextHead, body: closes }),
            ],
            dependentSets: [[], [], []],
        });
        const originalMerge = port.merge;
        let rejectOnce = true;
        port.merge = (number, head, hasDependents) => {
            if (rejectOnce) {
                rejectOnce = false;
                calls.push(`merge:${number}:${head}`);
                throw new DeliveryMergeRejectedError('PR #42 was not merged: gh: HTTP 409: merge result ambiguous');
            }
            originalMerge(number, head, hasDependents);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/HTTP 409: merge result ambiguous/i);

        const hostileAuthority: PersistedDeliveryReceiptAuthority = {
            phase: 'prepared',
            receiptId: 'IC_hostile',
            receiptBody: visibleDeliveryReceiptBody(42, hostileHead, closes, 2372, 'successful'),
            postMergeValidation: {
                headRefOid: hostileHead,
                headRefName: 'feat/hostile',
                baseRefName: 'main',
                title: 'feat(delivery): add gate',
                bodySha256: createHash('sha256').update(closes).digest('hex'),
                trackerTarget: 2372,
            },
        };
        receipts.push({
            id: 'IC_hostile',
            body: visibleDeliveryReceiptBody(42, hostileHead, closes, 2372, 'successful'),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:01Z',
            updatedAt: '2026-08-21T00:00:01Z',
        });
        let currentAuthority = persistedReceiptAuthority();
        let swapAfterRead = true;
        port.readDeliveryReceiptAuthority = () => {
            calls.push(`receipt-authority:read:${authorityTrace(currentAuthority)}`);
            const observed = currentAuthority;
            if (swapAfterRead && observed?.phase === 'prepared' && observed.receiptId === 'IC_delivery_42_1') {
                swapAfterRead = false;
                currentAuthority = hostileAuthority;
            }
            return observed;
        };
        port.writeDeliveryReceiptAuthority = (number, authority, expectedCurrent) => {
            if (expectedCurrent !== undefined && !sameReceiptAuthorityExpectation(currentAuthority, expectedCurrent)) {
                throw new Error(`PR #${number} delivery receipt authority could not be stored`);
            }
            calls.push(`receipt-authority:write:${authorityTrace(authority)}`);
            currentAuthority = authority;
        };
        port.clearDeliveryReceiptAuthority = (number, expectedCurrent) => {
            if (expectedCurrent !== undefined && !sameReceiptAuthorityExpectation(currentAuthority, expectedCurrent)) {
                throw new Error(`PR #${number} delivery receipt authority could not be cleared`);
            }
            calls.push(`receipt-authority:clear:${authorityTrace(currentAuthority)}`);
            currentAuthority = undefined;
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority could not be stored/i);
        expect(calls).not.toContain('receipt-authority:write:released:IC_delivery_42_1');
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls.filter((call) => call === `merge:42:${nextHead}`)).toHaveLength(0);
        expect(currentAuthority).toEqual(hostileAuthority);
    });

    it('reuses retained ambiguous merge authority when a later definitive OPEN retry keeps the same immutable delivery inputs', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ body: closes, mergeable: 'UNKNOWN' }),
                new Error('PR #42 merge recovery became unreadable'),
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
            ],
            dependentSets: [[], [], []],
        });
        const originalMerge = port.merge;
        let rejectOnce = true;
        port.merge = (number, head, hasDependents) => {
            if (rejectOnce) {
                rejectOnce = false;
                calls.push(`merge:${number}:${head}`);
                throw new DeliveryMergeRejectedError('PR #42 was not merged: gh: HTTP 409: merge result ambiguous');
            }
            originalMerge(number, head, hasDependents);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/HTTP 409: merge result ambiguous/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).not.toContain('receipt-authority:write:released:IC_delivery_42_1');
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1']);
        expect(calls.filter((call) => call.startsWith('merge:42:'))).toEqual(['merge:42:head', 'merge:42:head']);
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
    });

    it('releases retained ambiguous merge authority when a later retry keeps the same head but the PR body digest changes, then posts a fresh receipt', () => {
        const staleBody = relationshipBody('Closes #2372\nOld note.');
        const currentBody = relationshipBody('Closes #2372\nCurrent note.');
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ body: staleBody }),
                pullRequest({ body: staleBody }),
                pullRequest({ body: staleBody, mergeable: 'UNKNOWN' }),
                new Error('PR #42 merge recovery became unreadable'),
                pullRequest({ body: currentBody }),
                pullRequest({ body: currentBody }),
            ],
            dependentSets: [[], [], []],
        });
        const originalMerge = port.merge;
        let rejectOnce = true;
        port.merge = (number, head, hasDependents) => {
            if (rejectOnce) {
                rejectOnce = false;
                calls.push(`merge:${number}:${head}`);
                throw new DeliveryMergeRejectedError('PR #42 was not merged: gh: HTTP 409: merge result ambiguous');
            }
            originalMerge(number, head, hasDependents);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/HTTP 409: merge result ambiguous/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', staleBody, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', staleBody, 2372),
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('receipt-authority:write:released:IC_delivery_42_1');
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(calls.filter((call) => call.startsWith('merge:42:'))).toEqual(['merge:42:head', 'merge:42:head']);
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', currentBody, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', currentBody, 2372),
        });
    });

    it('releases retained ambiguous merge authority when a later retry keeps the same head but the closing target changes, then posts a fresh receipt', () => {
        const staleBody = relationshipBody('Closes #2372');
        const currentBody = relationshipBody('Closes #2373');
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ body: staleBody }),
                pullRequest({ body: staleBody }),
                pullRequest({ body: staleBody, mergeable: 'UNKNOWN' }),
                new Error('PR #42 merge recovery became unreadable'),
                pullRequest({ body: currentBody }),
                pullRequest({ body: currentBody }),
            ],
            dependentSets: [[], [], []],
        });
        const originalMerge = port.merge;
        let rejectOnce = true;
        port.merge = (number, head, hasDependents) => {
            if (rejectOnce) {
                rejectOnce = false;
                calls.push(`merge:${number}:${head}`);
                throw new DeliveryMergeRejectedError('PR #42 was not merged: gh: HTTP 409: merge result ambiguous');
            }
            originalMerge(number, head, hasDependents);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/HTTP 409: merge result ambiguous/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', staleBody, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', staleBody, 2372),
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('receipt-authority:write:released:IC_delivery_42_1');
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(calls.filter((call) => call.startsWith('merge:42:'))).toEqual(['merge:42:head', 'merge:42:head']);
        expect(calls).not.toContain('complete:2372');
        expect(calls).toContain('complete:2373');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', currentBody, 2373, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', currentBody, 2373),
        });
    });

    it('fails closed when an absent authority observation goes stale before the first write', () => {
        const closes = relationshipBody('Closes #2372');
        const hostileAuthority: PersistedDeliveryReceiptAuthority = {
            phase: 'terminal',
            receiptId: 'IC_hostile',
            receiptBody: visibleDeliveryReceiptBody(42, 'hostile-head', closes, 2372, 'successful'),
        };
        const { port, calls, tracker, receipts, persistedReceiptAuthority } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: closes })],
            dependentSets: [[], []],
        });
        let currentAuthority = persistedReceiptAuthority();
        let swapBeforeFirstWrite = true;
        port.readDeliveryReceiptAuthority = () => {
            calls.push(`receipt-authority:read:${authorityTrace(currentAuthority)}`);
            return currentAuthority;
        };
        port.writeDeliveryReceiptAuthority = (number, authority, expectedCurrent) => {
            if (swapBeforeFirstWrite) {
                swapBeforeFirstWrite = false;
                currentAuthority = hostileAuthority;
            }
            if (expectedCurrent !== undefined && !sameReceiptAuthorityExpectation(currentAuthority, expectedCurrent)) {
                throw new Error(`PR #${number} delivery receipt authority could not be stored`);
            }
            calls.push(`receipt-authority:write:${authorityTrace(authority)}`);
            currentAuthority = authority;
        };
        port.clearDeliveryReceiptAuthority = (number, expectedCurrent) => {
            if (expectedCurrent !== undefined && !sameReceiptAuthorityExpectation(currentAuthority, expectedCurrent)) {
                throw new Error(`PR #${number} delivery receipt authority could not be cleared`);
            }
            calls.push(`receipt-authority:clear:${authorityTrace(currentAuthority)}`);
            currentAuthority = undefined;
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority could not be stored/i);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1']);
        expect(calls).not.toContain('merge:42:head');
        expect(calls).not.toContain('complete:2372');
        expect(currentAuthority).toEqual(hostileAuthority);
    });

    it('disarms a retained ambiguous merge authority when a later retry sees the PR closed, then lets a reopened head and body deliver', () => {
        const closesX = relationshipBody('Closes #2372');
        const closesY = relationshipBody('Closes #2373');
        const nextHead = 'reopened-head';
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ body: closesX }),
                pullRequest({ body: closesX }),
                pullRequest({ body: closesX, mergeable: 'UNKNOWN' }),
                new Error('PR #42 merge recovery became unreadable'),
                pullRequest({ state: 'CLOSED', body: closesX }),
                pullRequest({ headRefOid: nextHead, body: closesY }),
                pullRequest({ headRefOid: nextHead, body: closesY }),
            ],
            dependentSets: [[], [], []],
        });
        const originalMerge = port.merge;
        let rejectOnce = true;
        port.merge = (number, head, hasDependents) => {
            if (rejectOnce) {
                rejectOnce = false;
                calls.push(`merge:${number}:${head}`);
                throw new DeliveryMergeRejectedError('PR #42 was not merged: gh: HTTP 409: merge result ambiguous');
            }
            originalMerge(number, head, hasDependents);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/HTTP 409: merge result ambiguous/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closesX, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closesX, 2372),
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/PR #42 is closed/i);
        expect(calls).not.toContain(`merge:42:${nextHead}`);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'released',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closesX, 2372, 'successful'),
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(calls).toContain(`merge:42:${nextHead}`);
        expect(calls).toContain('complete:2373');
        expect(calls).not.toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, nextHead, closesY, 2373, 'successful'),
            postMergeValidation: persistedPostMergeValidation(nextHead, closesY, 2373),
        });
    });

    it('disarms retained authority from a raw CLOSED UNKNOWN retry before a reopened new head can appear, then lets that head deliver', () => {
        const closes = relationshipBody('Closes #2372');
        const nextHead = 'reopened-head';
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ body: closes, mergeable: 'UNKNOWN' }),
                new Error('PR #42 merge recovery became unreadable'),
                pullRequest({ state: 'CLOSED', body: closes, mergeable: 'UNKNOWN' }),
                pullRequest({ state: 'OPEN', headRefOid: nextHead, body: closes, mergeable: 'MERGEABLE' }),
                pullRequest({ state: 'OPEN', headRefOid: nextHead, body: closes }),
            ],
            dependentSets: [[], [], []],
        });
        const originalMerge = port.merge;
        let rejectOnce = true;
        port.merge = (number, head, hasDependents) => {
            if (rejectOnce) {
                rejectOnce = false;
                calls.push(`merge:${number}:${head}`);
                throw new DeliveryMergeRejectedError('PR #42 was not merged: gh: HTTP 409: merge result ambiguous');
            }
            originalMerge(number, head, hasDependents);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/HTTP 409: merge result ambiguous/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/PR #42 is closed/i);
        expect(calls).not.toContain(`merge:42:${nextHead}`);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'released',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(calls).toContain(`merge:42:${nextHead}`);
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, nextHead, closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation(nextHead, closes, 2372),
        });
    });

    it('disarms retained authority from a raw CLOSED UNKNOWN retry without trusting an unreadable refresh, so a later new head can deliver', () => {
        const closesX = relationshipBody('Closes #2372');
        const closesY = relationshipBody('Closes #2373');
        const nextHead = 'reopened-head';
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ body: closesX }),
                pullRequest({ body: closesX }),
                pullRequest({ body: closesX, mergeable: 'UNKNOWN' }),
                new Error('PR #42 merge recovery became unreadable'),
                pullRequest({ state: 'CLOSED', body: closesX, mergeable: 'UNKNOWN' }),
                pullRequest({ state: 'OPEN', headRefOid: nextHead, body: closesY }),
                pullRequest({ state: 'OPEN', headRefOid: nextHead, body: closesY }),
            ],
            dependentSets: [[], [], []],
        });
        const originalMerge = port.merge;
        let rejectOnce = true;
        port.merge = (number, head, hasDependents) => {
            if (rejectOnce) {
                rejectOnce = false;
                calls.push(`merge:${number}:${head}`);
                throw new DeliveryMergeRejectedError('PR #42 was not merged: gh: HTTP 409: merge result ambiguous');
            }
            originalMerge(number, head, hasDependents);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/HTTP 409: merge result ambiguous/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closesX, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closesX, 2372),
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/PR #42 is closed/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'released',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closesX, 2372, 'successful'),
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(calls).toContain(`merge:42:${nextHead}`);
        expect(calls).toContain('complete:2373');
        expect(calls).not.toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, nextHead, closesY, 2373, 'successful'),
            postMergeValidation: persistedPostMergeValidation(nextHead, closesY, 2373),
        });
    });

    it('retains the armed receipt authority when merge throws after the PR already became merged, then recovers on retry', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: closes })],
            dependentSets: [[], []],
        });
        const originalMerge = port.merge;
        let failMergeOnce = true;
        port.merge = (number, head, hasDependents) => {
            originalMerge(number, head, hasDependents);
            if (failMergeOnce) {
                failMergeOnce = false;
                throw new Error('merge response lost');
            }
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/merge response lost/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
        expect(calls).toContain('merge:42:head');
        expect(calls).not.toContain('receipt-authority:write:merge-authorized:IC_delivery_42_1');
        expect(calls).not.toContain('complete:2372');

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls).toContain('receipt-authority:read:prepared:IC_delivery_42_1');
        expect(calls).toContain('receipt-authority:write:merge-authorized:IC_delivery_42_1');
        expect(calls).toContain('receipt-authority:write:terminal:IC_delivery_42_1');
        expect(calls).toContain('complete:2372');
        expect(calls).toContain('PR #42 was already merged; repaired 0 remaining dependent(s)');
    });

    it('fails closed when a single current v2 merged receipt lacks retained validation after body drift', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
            persistedReceiptAuthority: {
                phase: 'terminal',
                receiptId: 'IC_delivery_42',
                receiptBody: deliveryReceiptBody(42, 'head', closes, 2372),
            },
            receipts: [
                {
                    id: 'IC_delivery_42',
                    body: deliveryReceiptBody(42, 'head', closes, 2372),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls).not.toContain('retarget:43:main');
        expect(calls).not.toContain('complete:2372');
    });

    it('fails closed when bodyful persisted merged recovery only sees a stale exact receipt listing and proof says a newer receipt exists', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
            persistedReceiptAuthority: {
                phase: 'terminal',
                receiptId: 'IC_delivery_42',
                receiptBody: deliveryReceiptBody(42, 'head', closes, 2372),
            },
            receipts: [
                {
                    id: 'IC_delivery_42',
                    body: deliveryReceiptBody(42, 'head', closes, 2372),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 2, latestCommentId: 'IC_hidden_newer' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls).not.toContain('complete:2372');
        expect(calls).not.toContain('retarget:43:main');
        expect(calls).not.toContain('receipt-authority:write:terminal:IC_delivery_42');
    });

    it('fails closed when bodyful persisted merged recovery sees a stale middle receipt even though count and newest still match', () => {
        const closesX = relationshipBody('Closes #2372');
        const closesStale = relationshipBody('Closes #2373');
        const closesNewest = relationshipBody('Closes #2375');
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: closesStale })],
            persistedReceiptAuthority: {
                phase: 'terminal',
                receiptId: 'IC_z',
                receiptBody: deliveryReceiptBody(42, 'head', closesStale, 2373),
                postMergeValidation: persistedPostMergeValidation('head', closesStale, 2373),
            },
            receipts: [
                {
                    id: 'IC_x',
                    body: deliveryReceiptBody(42, 'head', closesX, 2372),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
                {
                    id: 'IC_z',
                    body: deliveryReceiptBody(42, 'head', closesStale, 2373),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:01Z',
                    updatedAt: '2026-08-21T00:00:01Z',
                },
                {
                    id: 'IC_n',
                    body: deliveryReceiptBody(42, 'head', closesNewest, 2375),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:02Z',
                    updatedAt: '2026-08-21T00:00:02Z',
                },
            ],
            deliveryReceiptProof: deliveryReceiptProofForIds(['IC_x', 'IC_y', 'IC_n']),
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls).toContain('receipt-proof:42:3:IC_n');
        expect(calls).not.toContain('complete:2373');
        expect(calls).not.toContain('retarget:43:main');
        expect(calls).not.toContain('receipt-authority:write:terminal:IC_z');
    });

    it('fails closed when already-merged current visible v2 recovery no longer exposes its observed CI state and retained validation is absent', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({
                    state: 'MERGED',
                    mergeable: 'UNKNOWN',
                    mergeStateStatus: 'UNKNOWN',
                    body: relationshipBody('None.'),
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[]],
            persistedReceiptAuthority: { phase: 'terminal', receiptId: 'IC_visible_success' },
            receipts: [
                {
                    id: 'IC_visible_success',
                    body: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls.filter((call) => call.startsWith('checks:'))).toHaveLength(0);
        expect(calls).not.toContain('complete:2372');
        expect(calls).not.toContain('PR #42 was already merged; repaired 0 remaining dependent(s)');
    });

    it('fails closed when prepared merged recovery sees a title-only edit after receipt arming', () => {
        const closes = relationshipBody('Closes #2372');
        const receiptBody = visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful');
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({
                    state: 'MERGED',
                    body: closes,
                    title: 'feat(delivery): renamed gate',
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[]],
            persistedReceiptAuthority: {
                phase: 'prepared',
                receiptId: 'IC_prepared',
                receiptBody,
                postMergeValidation: {
                    headRefOid: 'head',
                    headRefName: 'feat/gate',
                    baseRefName: 'main',
                    title: 'feat(delivery): add gate',
                    bodySha256: createHash('sha256').update(closes).digest('hex'),
                    trackerTarget: 2372,
                },
            },
            receipts: [
                {
                    id: 'IC_prepared',
                    body: receiptBody,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/title changed during delivery/i);
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('retarget:'))).toHaveLength(0);
        expect(calls).not.toContain('receipt-authority:write:merge-authorized:IC_prepared');
        expect(calls).not.toContain('receipt-authority:write:terminal:IC_prepared');
    });

    it('fails closed when a prepared authority receipt body names X but its stored post-merge validation belongs to Y', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const receiptBodyX = visibleDeliveryReceiptBody(42, 'head', bodyX, 2372, 'successful');
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({
                    state: 'MERGED',
                    body: bodyY,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[]],
            persistedReceiptAuthority: {
                phase: 'prepared',
                receiptId: 'IC_x',
                receiptBody: receiptBodyX,
                postMergeValidation: {
                    headRefOid: 'head',
                    headRefName: 'feat/gate',
                    baseRefName: 'main',
                    bodySha256: createHash('sha256').update(bodyY).digest('hex'),
                    trackerTarget: 2373,
                },
            },
            receipts: [
                {
                    id: 'IC_x',
                    body: receiptBodyX,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 1, latestCommentId: 'IC_x' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(
            /delivery receipt changed during recovery|delivery receipt authority cannot be proven/i
        );
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('retarget:'))).toHaveLength(0);
    });

    it('fails closed when a released bodyful authority sees the same PR merged before any later OPEN delivery re-arms it', () => {
        const closes = relationshipBody('Closes #2372');
        const storedReceiptBody = visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful');
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({ state: 'CLOSED', body: closes }),
                pullRequest({
                    state: 'MERGED',
                    body: closes,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[], []],
            persistedReceiptAuthority: {
                phase: 'prepared',
                receiptId: 'IC_prepared_bodyful',
                receiptBody: storedReceiptBody,
                postMergeValidation: {
                    headRefOid: 'head',
                    headRefName: 'feat/gate',
                    baseRefName: 'main',
                    bodySha256: createHash('sha256').update(closes).digest('hex'),
                    trackerTarget: 2372,
                },
            },
            receipts: [
                {
                    id: 'IC_prepared_bodyful',
                    body: storedReceiptBody,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 1, latestCommentId: 'IC_prepared_bodyful' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/PR #42 is closed/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'released',
            receiptId: 'IC_prepared_bodyful',
            receiptBody: storedReceiptBody,
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('retarget:'))).toHaveLength(0);
        expect(calls).not.toContain('receipt-authority:write:terminal:IC_prepared_bodyful');
    });

    it('fails closed when a bodyless current v2 authority points at an older wrong-issue receipt', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const receipt = (
            id: string,
            body: string,
            closingIssue: number,
            createdAt: string
        ): DeliveryReceiptComment => ({
            id,
            body: deliveryReceiptBody(42, 'head', body, closingIssue),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt,
            updatedAt: createdAt,
        });
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
            dependentSets: [[]],
            persistedReceiptAuthority: { phase: 'terminal', receiptId: 'IC_x' },
            receipts: [
                receipt('IC_x', bodyX, 2372, '2026-08-21T00:00:00Z'),
                receipt('IC_y', bodyY, 2373, '2026-08-21T00:00:01Z'),
            ],
            deliveryReceiptProof: { totalCount: 2, latestCommentId: 'IC_y' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(
            /delivery receipt authority cannot be proven|delivery receipt changed during recovery/i
        );
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('retarget:'))).toHaveLength(0);
    });

    it('releases a bodyless prepared authority after CLOSED, then lets a reopened new head and body deliver', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const nextHead = 'reopened-head';
        const storedReceiptBody = visibleDeliveryReceiptBody(42, 'head', bodyX, 2372, 'successful');
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ state: 'CLOSED', body: bodyX }),
                pullRequest({ headRefOid: nextHead, body: bodyY }),
                pullRequest({ headRefOid: nextHead, body: bodyY }),
            ],
            dependentSets: [[], []],
            persistedReceiptAuthority: {
                phase: 'prepared',
                receiptId: 'IC_prepared_bodyless',
                postMergeValidation: persistedPostMergeValidation('head', bodyX, 2372),
            },
            receipts: [
                {
                    id: 'IC_prepared_bodyless',
                    body: storedReceiptBody,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/PR #42 is closed/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'released',
            receiptId: 'IC_prepared_bodyless',
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_prepared_bodyless', 'IC_delivery_42_2']);
        expect(calls).toContain(`merge:42:${nextHead}`);
        expect(calls).toContain('complete:2373');
        expect(calls).not.toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, nextHead, bodyY, 2373, 'successful'),
            postMergeValidation: persistedPostMergeValidation(nextHead, bodyY, 2373),
        });
    });

    it('fails closed when a released bodyless authority sees the same PR merged before any later OPEN delivery re-arms it', () => {
        const closes = relationshipBody('Closes #2372');
        const storedReceiptBody = visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful');
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({ state: 'CLOSED', body: closes }),
                pullRequest({
                    state: 'MERGED',
                    body: closes,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[], []],
            persistedReceiptAuthority: {
                phase: 'prepared',
                receiptId: 'IC_prepared_bodyless',
                postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
            },
            receipts: [
                {
                    id: 'IC_prepared_bodyless',
                    body: storedReceiptBody,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 1, latestCommentId: 'IC_prepared_bodyless' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/PR #42 is closed/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'released',
            receiptId: 'IC_prepared_bodyless',
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('retarget:'))).toHaveLength(0);
        expect(calls).not.toContain('receipt-authority:write:terminal:IC_prepared_bodyless');
    });

    it('fails closed when a bodyless prepared authority names X but its stored post-merge validation belongs to Y', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const receiptBodyX = visibleDeliveryReceiptBody(42, 'head', bodyX, 2372, 'successful');
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({
                    state: 'MERGED',
                    body: bodyY,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[]],
            persistedReceiptAuthority: {
                phase: 'prepared',
                receiptId: 'IC_x',
                postMergeValidation: {
                    headRefOid: 'head',
                    headRefName: 'feat/gate',
                    baseRefName: 'main',
                    title: 'feat(delivery): add gate',
                    bodySha256: createHash('sha256').update(bodyY).digest('hex'),
                    trackerTarget: 2373,
                },
            },
            receipts: [
                {
                    id: 'IC_x',
                    body: receiptBodyX,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 1, latestCommentId: 'IC_x' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(
            /delivery receipt changed during recovery|delivery receipt authority cannot be proven/i
        );
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('retarget:'))).toHaveLength(0);
    });

    it.each([
        ['merge-authorized', 'IC_bodyless_merge_authorized'],
        ['terminal', 'IC_bodyless_terminal'],
    ] as const)(
        'fails closed when a bodyless %s authority names X but its retained post-merge validation belongs to Y',
        (phase, receiptId) => {
            const bodyX = relationshipBody('Closes #2372');
            const bodyY = relationshipBody('Closes #2373');
            const receiptBodyX = visibleDeliveryReceiptBody(42, 'head', bodyX, 2372, 'successful');
            const { port, calls, tracker } = fakePort({
                primary: [
                    pullRequest({
                        state: 'MERGED',
                        body: bodyY,
                        mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                    }),
                ],
                dependentSets: [[]],
                persistedReceiptAuthority: {
                    phase,
                    receiptId,
                    postMergeValidation: {
                        headRefOid: 'head',
                        headRefName: 'feat/gate',
                        baseRefName: 'main',
                        title: 'feat(delivery): add gate',
                        bodySha256: createHash('sha256').update(bodyY).digest('hex'),
                        trackerTarget: 2373,
                    },
                },
                receipts: [
                    {
                        id: receiptId,
                        body: receiptBodyX,
                        authorNodeId: AUTHOR_BOT_NODE_ID,
                        authorLogin: 'renamed-author[bot]',
                        authorType: 'Bot',
                        createdAt: '2026-08-21T00:00:00Z',
                        updatedAt: '2026-08-21T00:00:00Z',
                    },
                ],
                deliveryReceiptProof: { totalCount: 1, latestCommentId: receiptId },
            });

            expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt changed during recovery/i);
            expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
            expect(calls.filter((call) => call.startsWith('retarget:'))).toHaveLength(0);
            expect(calls).not.toContain(`receipt-authority:write:terminal:${receiptId}`);
        }
    );

    it('re-arms a released bodyful authority during a later OPEN delivery, then recovers from merged state with fresh post-merge validation', () => {
        const closes = relationshipBody('Closes #2372');
        const storedReceiptBody = visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful');
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({ state: 'CLOSED', body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ state: 'MERGED', body: closes }),
                pullRequest({
                    state: 'MERGED',
                    body: closes,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[], [], []],
            persistedReceiptAuthority: {
                phase: 'prepared',
                receiptId: 'IC_rearm_bodyful',
                receiptBody: storedReceiptBody,
                postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
            },
            receipts: [
                {
                    id: 'IC_rearm_bodyful',
                    body: storedReceiptBody,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 1, latestCommentId: 'IC_rearm_bodyful' },
        });
        const originalWriteDeliveryReceiptAuthority = port.writeDeliveryReceiptAuthority;
        let failMergeAuthorizedWrite = true;
        port.writeDeliveryReceiptAuthority = (number, authority) => {
            if (authority.phase === 'merge-authorized' && failMergeAuthorizedWrite) {
                failMergeAuthorizedWrite = false;
                throw new Error('authority persistence unavailable');
            }
            originalWriteDeliveryReceiptAuthority(number, authority);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/PR #42 is closed/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'released',
            receiptId: 'IC_rearm_bodyful',
            receiptBody: storedReceiptBody,
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/authority persistence unavailable/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_rearm_bodyful',
            receiptBody: storedReceiptBody,
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(0);
        expect(calls).toContain('receipt-authority:write:prepared:IC_rearm_bodyful');
        expect(calls).toContain('receipt-authority:write:merge-authorized:IC_rearm_bodyful');
        expect(calls).toContain('receipt-authority:write:terminal:IC_rearm_bodyful');
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_rearm_bodyful',
            receiptBody: storedReceiptBody,
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
    });

    it('appends a fresh visible v2 before re-arming when a released stored v2 is trailed by a legacy v1 on the reopened same head', () => {
        const closes = relationshipBody('Closes #2372');
        const storedReceiptBody = visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful');
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ state: 'CLOSED', body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
            ],
            dependentSets: [[], []],
            persistedReceiptAuthority: {
                phase: 'prepared',
                receiptId: 'IC_released_v2',
                receiptBody: storedReceiptBody,
                postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
            },
            receipts: [
                {
                    id: 'IC_released_v2',
                    body: storedReceiptBody,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
                {
                    id: 'IC_trailing_v1',
                    body: deliveryReceiptBody(42, 'head', closes, 2372),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:01Z',
                    updatedAt: '2026-08-21T00:00:01Z',
                },
            ],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/PR #42 is closed/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'released',
            receiptId: 'IC_released_v2',
            receiptBody: storedReceiptBody,
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_released_v2', 'IC_trailing_v1', 'IC_delivery_42_3']);
        expect(receipts.at(-1)?.body).toBe(storedReceiptBody);
        expect(calls).toContain('receipt-authority:write:prepared:IC_delivery_42_3');
        expect(calls).toContain('merge:42:head');
        expect(calls).toContain('receipt-authority:write:merge-authorized:IC_delivery_42_3');
        expect(calls).toContain('receipt-authority:write:terminal:IC_delivery_42_3');
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_3',
            receiptBody: storedReceiptBody,
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
    });

    it('preserves bodyless prepared merged recovery when the PR is already merged', () => {
        const closes = relationshipBody('Closes #2372');
        const storedReceiptBody = visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful');
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({
                    state: 'MERGED',
                    body: closes,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[]],
            persistedReceiptAuthority: {
                phase: 'prepared',
                receiptId: 'IC_prepared_bodyless',
                postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
            },
            receipts: [
                {
                    id: 'IC_prepared_bodyless',
                    body: storedReceiptBody,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 1, latestCommentId: 'IC_prepared_bodyless' },
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('receipt-proof:42:1:IC_prepared_bodyless');
        expect(calls).toContain('receipt-authority:write:merge-authorized:IC_prepared_bodyless');
        expect(calls).toContain('receipt-authority:write:terminal:IC_prepared_bodyless');
        expect(calls).toContain('complete:2372');
        expect(calls).not.toContain('add-receipt:42');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_prepared_bodyless',
            receiptBody: storedReceiptBody,
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
    });

    it('preserves bodyless prepared merged recovery when the stored advisory receipt only recorded skipped evidence', () => {
        const closes = relationshipBody('Closes #2372');
        const storedReceiptBody = visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'skipped');
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({
                    state: 'MERGED',
                    body: closes,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[]],
            persistedReceiptAuthority: {
                phase: 'prepared',
                receiptId: 'IC_prepared_skipped',
                postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
            },
            receipts: [
                {
                    id: 'IC_prepared_skipped',
                    body: storedReceiptBody,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 1, latestCommentId: 'IC_prepared_skipped' },
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('receipt-proof:42:1:IC_prepared_skipped');
        expect(calls).toContain('receipt-authority:write:merge-authorized:IC_prepared_skipped');
        expect(calls).toContain('receipt-authority:write:terminal:IC_prepared_skipped');
        expect(calls).toContain('complete:2372');
        expect(calls).not.toContain('add-receipt:42');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_prepared_skipped',
            receiptBody: storedReceiptBody,
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
    });

    it('fails closed when prepared merged recovery only differs on receipt closingIssue versus stored trackerTarget', () => {
        const related = relationshipBody('Related #2372');
        const receiptBody = visibleDeliveryReceiptBody(42, 'head', related, 2372, 'successful');
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({
                    state: 'MERGED',
                    body: related,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[]],
            persistedReceiptAuthority: {
                phase: 'prepared',
                receiptId: 'IC_prepared',
                receiptBody,
                postMergeValidation: {
                    ...persistedPostMergeValidation('head', related, 2372),
                    trackerTarget: null,
                },
            },
            receipts: [
                {
                    id: 'IC_prepared',
                    body: receiptBody,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 1, latestCommentId: 'IC_prepared' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(
            /delivery receipt changed during recovery|delivery receipt authority cannot be proven/i
        );
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('retarget:'))).toHaveLength(0);
    });

    it('fails closed when a bodyless current v2 authority lacks retained validation even if a newer same-key advisory receipt only changes observed CI state', () => {
        const closes = relationshipBody('Closes #2372');
        const receiptA = visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful');
        const receiptB = visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'failed');
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
            dependentSets: [[]],
            persistedReceiptAuthority: { phase: 'terminal', receiptId: 'IC_a' },
            receipts: [
                {
                    id: 'IC_a',
                    body: receiptA,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
                {
                    id: 'IC_b',
                    body: receiptB,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:01Z',
                    updatedAt: '2026-08-21T00:00:01Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 2, latestCommentId: 'IC_b' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('retarget:'))).toHaveLength(0);
        expect(persistedReceiptAuthority()).toEqual({ phase: 'terminal', receiptId: 'IC_a' });
    });

    it('fails closed when a bodyless current v2 authority points at an older same-key receipt with a conflicting admission mode', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
            dependentSets: [[]],
            persistedReceiptAuthority: { phase: 'terminal', receiptId: 'IC_advisory' },
            receipts: [
                {
                    id: 'IC_advisory',
                    body: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
                {
                    id: 'IC_required',
                    body: composeDeliveryReceipt({
                        pullRequest: 42,
                        head: 'head',
                        bodySha256: createHash('sha256').update(closes).digest('hex'),
                        closingIssue: 2372,
                        ciAdmissionMode: 'required',
                    }),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:01Z',
                    updatedAt: '2026-08-21T00:00:01Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 2, latestCommentId: 'IC_required' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls.filter((call) => call.startsWith('retarget:'))).toHaveLength(0);
    });

    it('fails closed when bodyless current v2 merged recovery lacks retained validation for the newest X to Y receipt', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const receipt = (
            id: string,
            body: string,
            closingIssue: number,
            createdAt: string
        ): DeliveryReceiptComment => ({
            id,
            body: deliveryReceiptBody(42, 'head', body, closingIssue),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt,
            updatedAt: createdAt,
        });
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
            persistedReceiptAuthority: {
                phase: 'terminal',
                receiptId: 'IC_y',
                receiptBody: deliveryReceiptBody(42, 'head', bodyY, 2373),
            },
            receipts: [
                receipt('IC_x', bodyX, 2372, '2026-08-21T00:00:00Z'),
                receipt('IC_y', bodyY, 2373, '2026-08-21T00:00:01Z'),
            ],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls).not.toContain('complete:2373');
        expect(calls).not.toContain('complete:2372');
    });

    it('fails closed when bodyless current v2 merged recovery lacks retained validation for a unique newer X after tied historical X and Y receipts', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const receipt = (
            id: string,
            body: string,
            closingIssue: number,
            createdAt: string
        ): DeliveryReceiptComment => ({
            id,
            body: deliveryReceiptBody(42, 'head', body, closingIssue),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt,
            updatedAt: createdAt,
        });
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
            persistedReceiptAuthority: {
                phase: 'terminal',
                receiptId: 'IC_newest_x',
                receiptBody: deliveryReceiptBody(42, 'head', bodyX, 2372),
            },
            receipts: [
                receipt('IC_historical_x', bodyX, 2372, '2026-08-21T00:00:00Z'),
                receipt('IC_historical_y', bodyY, 2373, '2026-08-21T00:00:00Z'),
                receipt('IC_newest_x', bodyX, 2372, '2026-08-21T00:00:01Z'),
            ],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls).not.toContain('complete:2372');
        expect(calls).not.toContain('complete:2373');
    });

    it('fails closed instead of using REST comment order to recover Y after equal-timestamp X then Y receipts when retained validation is unavailable', () => {
        const staleBody = relationshipBody('Closes #2372');
        const currentBody = relationshipBody('Closes #2373');
        const receipt = (id: string, body: string, closingIssue: number): DeliveryReceiptComment => ({
            id,
            body: deliveryReceiptBody(42, 'head', body, closingIssue),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:00Z',
            updatedAt: '2026-08-21T00:00:00Z',
        });
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
            persistedReceiptAuthority: {
                phase: 'terminal',
                receiptId: 'IC_second',
                receiptBody: deliveryReceiptBody(42, 'head', currentBody, 2373),
            },
            receipts: [receipt('IC_first', staleBody, 2372), receipt('IC_second', currentBody, 2373)],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls).not.toContain('complete:2373');
        expect(calls).not.toContain('complete:2372');
    });

    it('fails closed instead of trusting REST comment order alone when timestamps disagree and no persisted authority anchor remains', () => {
        const staleBody = relationshipBody('Closes #2372');
        const currentBody = relationshipBody('Closes #2373');
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
            receipts: [
                {
                    id: 'IC_first',
                    body: deliveryReceiptBody(42, 'head', staleBody, 2372),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:02Z',
                    updatedAt: '2026-08-21T00:00:02Z',
                },
                {
                    id: 'IC_second',
                    body: deliveryReceiptBody(42, 'head', currentBody, 2373),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:01Z',
                    updatedAt: '2026-08-21T00:00:01Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 2, latestCommentId: 'IC_second' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(calls).not.toContain('receipt-proof:42:2:IC_second');
        expect(calls).not.toContain('receipt-authority:write:merge-authorized:IC_second');
        expect(calls).not.toContain('receipt-authority:write:terminal:IC_second');
        expect(calls).not.toContain('complete:2373');
        expect(calls).not.toContain('complete:2372');
    });

    it('refuses to replace merge-authorized authority with a different stale open receipt id', () => {
        const closes = relationshipBody('Closes #2372');
        const currentReceiptBody = visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful');
        const { port, calls, tracker, persistedReceiptAuthority } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: closes })],
            dependentSets: [[]],
            persistedReceiptAuthority: {
                phase: 'merge-authorized',
                receiptId: 'IC_authorized_r1',
                receiptBody: currentReceiptBody,
            },
            receipts: [
                {
                    id: 'IC_stale_open_r2',
                    body: currentReceiptBody,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
            deliveryReceiptProof: { totalCount: 1, latestCommentId: 'IC_stale_open_r2' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt changed during delivery/i);
        expect(calls).not.toContain('merge:42:head');
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'merge-authorized',
            receiptId: 'IC_authorized_r1',
            receiptBody: currentReceiptBody,
        });
    });

    it('writes the immutable delivery receipt before merge and then fails closed after mutable-body drift on merged recovery', () => {
        const closes = relationshipBody('Closes #2372');
        const child = stacked();
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ state: 'MERGED', body: closes }),
                pullRequest({ state: 'MERGED', body: relationshipBody('None.') }),
            ],
            dependentSets: [[child], [child], []],
        });
        let failOnce = true;
        tracker.complete = (issueNumber) => {
            calls.push(`complete:${issueNumber}`);
            if (failOnce) {
                failOnce = false;
                throw new Error('tracker unavailable');
            }
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(
            /PR #42.*merged.*issue #2372.*tracker unavailable/i
        );
        expect(calls).toContain('merge:42:head');
        expect(calls.indexOf('add-receipt:42')).toBeLessThan(calls.indexOf('merge:42:head'));
        expect(calls.indexOf('receipt-authority:write:prepared:IC_delivery_42_1')).toBeLessThan(
            calls.indexOf('merge:42:head')
        );
        expect(calls.indexOf('merge:42:head')).toBeLessThan(
            calls.indexOf('receipt-authority:write:merge-authorized:IC_delivery_42_1')
        );
        expect(calls.indexOf('receipt-authority:write:merge-authorized:IC_delivery_42_1')).toBeLessThan(
            calls.indexOf('complete:2372')
        );
        expect(calls).not.toContainEqual(expect.stringMatching(/delivered|success/i));

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/body changed during delivery/i);
        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(1);
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls).toContain('receipt-authority:read:merge-authorized:IC_delivery_42_1');
        expect(calls.filter((call) => call === 'receipt-authority:write:terminal:IC_delivery_42_1')).toHaveLength(0);
    });

    it('does not downgrade merge-authorized authority during a same-receipt open retry before late merged recovery', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ state: 'MERGED', body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ state: 'MERGED', body: closes }),
            ],
            reviewStates: [
                { latestReviewerStateOnHead: 'APPROVED', unresolvedThreads: 0 },
                { latestReviewerStateOnHead: 'APPROVED', unresolvedThreads: 0 },
                { latestReviewerStateOnHead: 'APPROVED', unresolvedThreads: 0 },
                { latestReviewerStateOnHead: 'CHANGES_REQUESTED', unresolvedThreads: 0 },
            ],
            dependentSets: [[], [], [], []],
        });
        let failTrackerOnce = true;
        tracker.complete = (issueNumber) => {
            calls.push(`complete:${issueNumber}`);
            if (failTrackerOnce) {
                failTrackerOnce = false;
                throw new Error('tracker unavailable');
            }
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/tracker unavailable/i);
        expect(calls).toContain('receipt-authority:write:merge-authorized:IC_delivery_42_1');
        expect(calls).not.toContain('receipt-authority:write:terminal:IC_delivery_42_1');

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/not approved/i);

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls).toContain('receipt-authority:read:merge-authorized:IC_delivery_42_1');
        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(2);
        expect(calls).toContain('PR #42 was already merged; repaired 0 remaining dependent(s)');
    });

    it('publishes one current v2 receipt, then fails closed on retry instead of reusing it after merged body drift', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ state: 'MERGED', body: closes }),
                pullRequest({ state: 'MERGED', body: relationshipBody('None.') }),
            ],
            dependentSets: [[], []],
            receipts: [
                {
                    id: 'IC_legacy_v1',
                    body: deliveryReceiptBody(42, 'head', closes, 2372),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
        });
        let failOnce = true;
        tracker.complete = (issueNumber) => {
            calls.push(`complete:${issueNumber}`);
            if (failOnce) {
                failOnce = false;
                throw new Error('tracker unavailable');
            }
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(
            /PR #42.*merged.*issue #2372.*tracker unavailable/i
        );

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/body changed during delivery/i);
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(1);
    });

    it('reuses a stable current visible v2 receipt when proof shows the historical authority is complete and current', () => {
        const closes = relationshipBody('Closes #2372');
        const currentReceipt = {
            id: 'IC_current_visible_v2',
            body: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:00Z',
            updatedAt: '2026-08-21T00:00:00Z',
        };
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: closes })],
            dependentSets: [[]],
            receipts: [currentReceipt],
            deliveryReceiptProof: { totalCount: 1, latestCommentId: 'IC_current_visible_v2' },
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(0);
        expect(calls).toContain('merge:42:head');
        expect(calls).toContain('complete:2372');
    });

    it('appends a new current receipt instead of reusing a stale X when proof shows a hidden newer Y', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const receipt = (
            id: string,
            body: string,
            closingIssue: number,
            createdAt: string
        ): DeliveryReceiptComment => ({
            id,
            body: deliveryReceiptBody(42, 'head', body, closingIssue),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt,
            updatedAt: createdAt,
        });
        const { port, calls, receipts, tracker } = fakePort({
            primary: [pullRequest({ body: bodyX }), pullRequest({ body: bodyX })],
            dependentSets: [[]],
            receipts: [
                receipt('IC_historical_x', bodyX, 2372, '2026-08-21T00:00:00.000Z'),
                receipt('IC_hidden_y', bodyY, 2373, '2026-08-21T00:00:01.000Z'),
            ],
        });
        let receiptReads = 0;
        const originalDeliveryReceipts = port.deliveryReceipts;
        port.deliveryReceipts = (number) => {
            receiptReads += 1;
            calls.push(`receipts:${number}`);
            if (receiptReads <= 2) {
                return structuredClone(receipts.slice(0, 1));
            }
            return originalDeliveryReceipts(number);
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt was not durably verified/i);
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(receipts.at(-1)?.id).toBe('IC_delivery_42_3');
        expect(receipts.at(-1)?.body).toBe(visibleDeliveryReceiptBody(42, 'head', bodyX, 2372, 'successful'));
        expect(calls).not.toContain('merge:42:head');
        expect(calls).not.toContain('complete:2372');
        expect(calls.filter((call) => call === 'complete:2373')).toHaveLength(0);
    });

    it('fails safely when proof never establishes a complete current authority for an open historical receipt', () => {
        const closes = relationshipBody('Closes #2372');
        const currentReceipt = {
            id: 'IC_current_visible_v2',
            body: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:00Z',
            updatedAt: '2026-08-21T00:00:00Z',
        };
        const { port, calls, receipts, tracker } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: closes })],
            dependentSets: [[]],
            receipts: [currentReceipt],
            deliveryReceiptProof: { totalCount: 2, latestCommentId: 'IC_hidden_newer' },
        });
        port.deliveryReceipts = (number) => {
            calls.push(`receipts:${number}`);
            return structuredClone(receipts.slice(0, 1));
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt was not durably verified/i);
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls).not.toContain('merge:42:head');
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
    });

    it('keeps a returned receipt id across repeated proof failures so retries never post a second copy', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, receipts, tracker } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
            ],
            dependentSets: [[], []],
            deliveryReceiptProof: { totalCount: 2, latestCommentId: 'IC_hidden_newer' },
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt was not durably verified/i);
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(receipts.map((entry) => entry.id)).toEqual(['IC_delivery_42_1']);

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt was not durably verified/i);
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(receipts.map((entry) => entry.id)).toEqual(['IC_delivery_42_1']);
        expect(calls).not.toContain('merge:42:head');
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
    });

    it('fails closed when a proof-failed bodyful prepared authority later sees the PR already merged', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, receipts, tracker, persistedReceiptAuthority } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({
                    state: 'MERGED',
                    body: closes,
                    mergedByActorNodeId: AUTHOR_BOT_NODE_ID,
                }),
            ],
            dependentSets: [[], []],
            deliveryReceiptProof: { totalCount: 2, latestCommentId: 'IC_hidden_newer' },
        });
        port.deliveryReceipts = (number) => {
            calls.push(`receipts:${number}`);
            return structuredClone(receipts.slice(0, 1));
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt was not durably verified/i);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt authority cannot be proven/i);
        expect(receipts.map((entry) => entry.id)).toEqual(['IC_delivery_42_1']);
        expect(calls).not.toContain('merge:42:head');
        expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(0);
        expect(calls).not.toContain('receipt-authority:write:terminal:IC_delivery_42_1');
    });

    it('ignores foreign comments before parsing delivery receipts', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: closes })],
            receipts: [
                {
                    id: 'IC_foreign_malformed',
                    body: '<!-- sourdaw-delivery-receipt:v1\nmalformed -->',
                    authorNodeId: null,
                    authorLogin: 'contributor',
                    authorType: 'User',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
                {
                    id: 'IC_foreign_copy',
                    body: deliveryReceiptBody(42, 'head', closes, 2372),
                    authorNodeId: null,
                    authorLogin: 'jcosta33',
                    authorType: 'User',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('add-receipt:42');
        expect(calls).toContain('merge:42:head');
        expect(calls).toContain('complete:2372');
    });

    it('fails closed on malformed or edited author-bot receipts', () => {
        const closes = relationshipBody('Closes #2372');
        for (const existing of [
            {
                id: 'IC_malformed',
                body: '<!-- sourdaw-delivery-receipt:v1\nmalformed -->',
                authorNodeId: AUTHOR_BOT_NODE_ID,
                authorLogin: 'renamed-author[bot]',
                authorType: 'Bot',
                createdAt: '2026-08-21T00:00:00Z',
                updatedAt: '2026-08-21T00:00:00Z',
            },
            {
                id: 'IC_edited',
                body: deliveryReceiptBody(42, 'head', closes, 2372),
                authorNodeId: AUTHOR_BOT_NODE_ID,
                authorLogin: 'renamed-author[bot]',
                authorType: 'Bot',
                createdAt: '2026-08-21T00:00:00Z',
                updatedAt: '2026-08-21T00:01:00Z',
            },
        ]) {
            const { port, calls, tracker } = fakePort({
                primary: [pullRequest({ body: closes }), pullRequest({ body: closes })],
                receipts: [existing],
            });

            expect(() => deliverPullRequest(42, port, tracker)).toThrow(/invalid delivery receipt/);
            expect(calls).not.toContain('merge:42:head');
        }
    });

    it('rejects an immutable-looking receipt with equal invalid timestamps', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: closes })],
            receipts: [
                {
                    id: 'IC_invalid_timestamp',
                    body: deliveryReceiptBody(42, 'head', closes, 2372),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: 'not-a-timestamp',
                    updatedAt: 'not-a-timestamp',
                },
            ],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/invalid delivery receipt/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('accepts adjacent byte-identical receipt payloads and chooses the newest authority', () => {
        const closes = relationshipBody('Closes #2372');
        const receipt = {
            id: 'IC_delivery_42',
            body: deliveryReceiptBody(42, 'head', closes, 2372),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:00Z',
            updatedAt: '2026-08-21T00:00:00Z',
        };
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: closes })],
            receipts: [
                receipt,
                {
                    ...receipt,
                    id: 'IC_delivery_42_duplicate',
                    createdAt: '2026-08-21T00:00:01Z',
                    updatedAt: '2026-08-21T00:00:01Z',
                },
            ],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('merge:42:head');
        expect(calls).toContain('complete:2372');
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
    });

    it('accepts adjacent legacy and visible receipts carrying the same immutable delivery identity', () => {
        const closes = relationshipBody('Closes #2372');
        const legacyReceipt = {
            id: 'IC_delivery_42_v1',
            body: deliveryReceiptBody(42, 'head', closes, 2372),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:00Z',
            updatedAt: '2026-08-21T00:00:00Z',
        };
        const visibleReceipt = {
            ...legacyReceipt,
            id: 'IC_delivery_42_v2',
            body: composeDeliveryReceipt({
                pullRequest: 42,
                head: 'head',
                bodySha256: createHash('sha256').update(closes).digest('hex'),
                closingIssue: 2372,
                ciAdmissionMode: 'advisory',
                observedCiState: 'successful',
            }),
            createdAt: '2026-08-21T00:00:01Z',
            updatedAt: '2026-08-21T00:00:01Z',
        };
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: closes })],
            receipts: [legacyReceipt, visibleReceipt],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('merge:42:head');
        expect(calls).toContain('complete:2372');
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(0);
    });

    it('posts a fresh current v2 receipt when the newest same-key v2 state no longer exactly matches the expected state', () => {
        const closes = relationshipBody('Closes #2372');
        const receipt = (
            id: string,
            observedCiState: 'successful' | 'failed',
            createdAt: string
        ): DeliveryReceiptComment => ({
            id,
            body: visibleDeliveryReceiptBody(42, 'head', closes, 2372, observedCiState),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt,
            updatedAt: createdAt,
        });
        const { port, calls, receipts, tracker } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: closes })],
            dependentSets: [[]],
            receipts: [
                receipt('IC_delivery_42_v2_success', 'successful', '2026-08-21T00:00:00Z'),
                receipt('IC_delivery_42_v2_failed', 'failed', '2026-08-21T00:00:01Z'),
            ],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(receipts.map(({ id }) => id)).toEqual([
            'IC_delivery_42_v2_success',
            'IC_delivery_42_v2_failed',
            'IC_delivery_42_3',
        ]);
        expect(receipts[2]?.body).toBe(visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'));
        expect(calls).toContain('merge:42:head');
        expect(calls).toContain('complete:2372');
    });

    it('appends current v2 authority after mixed failed v2 and trailing v1 lineage', () => {
        const closes = relationshipBody('Closes #2372');
        const failedVisibleReceipt = {
            id: 'IC_delivery_42_v2_failed',
            body: composeDeliveryReceipt({
                pullRequest: 42,
                head: 'head',
                bodySha256: createHash('sha256').update(closes).digest('hex'),
                closingIssue: 2372,
                ciAdmissionMode: 'advisory',
                observedCiState: 'failed',
            }),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:00Z',
            updatedAt: '2026-08-21T00:00:00Z',
        };
        const trailingLegacyReceipt = {
            id: 'IC_delivery_42_v1_trailing',
            body: deliveryReceiptBody(42, 'head', closes, 2372),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:01Z',
            updatedAt: '2026-08-21T00:00:01Z',
        };
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: closes })],
            receipts: [failedVisibleReceipt, trailingLegacyReceipt],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('merge:42:head');
        expect(calls).toContain('complete:2372');
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
    });

    it('appends a successful advisory retry after a failed observation for the same immutable delivery key', () => {
        const closes = relationshipBody('Closes #2372');
        const receipt = (id: string, observedCiState: 'successful' | 'failed'): DeliveryReceiptComment => ({
            id,
            body: visibleDeliveryReceiptBody(42, 'head', closes, 2372, observedCiState),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:00Z',
            updatedAt: '2026-08-21T00:00:00Z',
        });
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: closes })],
            receipts: [receipt('IC_failed', 'failed')],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('merge:42:head');
        expect(calls).toContain('complete:2372');
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
    });

    it('reuses a frozen successful advisory receipt across a later failed observation without posting a replacement', () => {
        const closes = relationshipBody('Closes #2372');
        const receiptBody = visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful');
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({ body: closes, mergeStateStatus: 'BLOCKED' }),
                pullRequest({ body: closes, mergeStateStatus: 'BLOCKED' }),
            ],
            dependentSets: [[]],
            persistedReceiptAuthority: {
                phase: 'prepared',
                receiptId: 'IC_frozen_success',
                receiptBody,
                postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
            },
            receipts: [
                {
                    id: 'IC_frozen_success',
                    body: receiptBody,
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                    authorLogin: 'renamed-author[bot]',
                    authorType: 'Bot',
                    createdAt: '2026-08-21T00:00:00Z',
                    updatedAt: '2026-08-21T00:00:00Z',
                },
            ],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(0);
        expect(calls).toContain('receipt-authority:read:prepared:IC_frozen_success');
        expect(calls).toContain('merge:42:head');
        expect(calls).toContain('complete:2372');
    });

    it('rejects same-key v2 receipts that disagree on admission mode', () => {
        const closes = relationshipBody('Closes #2372');
        const receipt = (id: string, body: string): DeliveryReceiptComment => ({
            id,
            body,
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:00Z',
            updatedAt: '2026-08-21T00:00:00Z',
        });
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: closes })],
            receipts: [
                receipt(
                    'IC_required',
                    composeDeliveryReceipt({
                        pullRequest: 42,
                        head: 'head',
                        bodySha256: createHash('sha256').update(closes).digest('hex'),
                        closingIssue: 2372,
                        ciAdmissionMode: 'required',
                    })
                ),
                receipt('IC_advisory', visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful')),
            ],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/invalid delivery receipt lineage|duplicate/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rethrows a failed receipt POST when no new receipt ID appeared after stale pre-reads hid newer authority', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const receipt = (id: string, body: string, createdAt: string): DeliveryReceiptComment => ({
            id,
            body,
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt,
            updatedAt: createdAt,
        });
        const { port, calls, receipts, tracker } = fakePort({
            primary: [pullRequest({ body: bodyX }), pullRequest({ body: bodyX })],
            receipts: [
                receipt(
                    'IC_preexisting_v2_x',
                    visibleDeliveryReceiptBody(42, 'head', bodyX, 2372, 'successful'),
                    '2026-08-21T00:00:00Z'
                ),
                receipt(
                    'IC_hidden_y',
                    visibleDeliveryReceiptBody(42, 'head', bodyY, 2373, 'successful'),
                    '2026-08-21T00:00:01Z'
                ),
            ],
        });
        let receiptReadCount = 0;
        port.deliveryReceipts = (number) => {
            calls.push(`receipts:${number}`);
            receiptReadCount += 1;
            if (receiptReadCount <= 2) {
                return structuredClone(receipts.slice(0, 1));
            }
            return structuredClone(receipts);
        };
        port.addDeliveryReceipt = (number, _body) => {
            calls.push(`add-receipt:${number}`);
            throw new Error('delivery receipt post failed before write');
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt post failed before write/);
        expect(calls).not.toContain('merge:42:head');
        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(0);
        expect(calls.filter((call) => call === 'complete:2373')).toHaveLength(0);
        expect(receipts.map((entry) => entry.id)).toEqual(['IC_preexisting_v2_x', 'IC_hidden_y']);
    });

    it('converges stale retry receipts and finishes already-merged recovery without deleting either comment', () => {
        const closes = relationshipBody('Closes #2372');
        const child = stacked();
        const { port, calls, tracker, receipts } = fakePort({
            primary: [pullRequest({ body: closes }), pullRequest({ body: closes }), pullRequest({ body: closes })],
            dependentSets: [[child], [child], [child], []],
        });
        const addReceipt = port.addDeliveryReceipt;
        let loseFirstResponse = true;
        port.addDeliveryReceipt = (number, body) => {
            const receipt = addReceipt(number, body);
            if (loseFirstResponse) {
                loseFirstResponse = false;
                throw new Error('delivery receipt response was lost');
            }
            return receipt;
        };
        let receiptReadCount = 0;
        port.deliveryReceipts = (number) => {
            calls.push(`receipts:${number}`);
            receiptReadCount += 1;
            if (receiptReadCount <= 3) {
                return [];
            }
            return structuredClone(receipts);
        };
        let failTrackerOnce = true;
        tracker.complete = (issueNumber) => {
            calls.push(`complete:${issueNumber}`);
            if (failTrackerOnce) {
                failTrackerOnce = false;
                throw new Error('tracker unavailable');
            }
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/delivery receipt response was lost/);
        expect(receipts).toHaveLength(1);

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(
            /PR #42.*merged.*issue #2372.*tracker unavailable/i
        );
        expect(receipts).toHaveLength(2);
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(calls).toContain('merge:42:head');
        expect(calls).toContain('retarget:43:main');

        deliverPullRequest(42, port, tracker);

        expect(receipts.map((receipt) => receipt.id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(receipts[0]?.body).toBe(receipts[1]?.body);
        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(2);
        expect(calls).toContain('PR #42 was already merged; repaired 0 remaining dependent(s)');
    });

    it('posts and persists a current-body v2 receipt instead of reusing a stale body-digest receipt on the same head and issue', () => {
        const staleBody = relationshipBody('Closes #2372\nOld note.');
        const currentBody = relationshipBody('Closes #2372\nCurrent note.');
        const staleDigestReceipt = {
            id: 'IC_stale_digest',
            body: composeDeliveryReceipt({
                pullRequest: 42,
                head: 'head',
                bodySha256: createHash('sha256').update(staleBody).digest('hex'),
                closingIssue: 2372,
                ciAdmissionMode: 'advisory',
                observedCiState: 'successful',
            }),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:00Z',
            updatedAt: '2026-08-21T00:00:00Z',
        };
        const { port, calls, receipts, tracker } = fakePort({
            primary: [pullRequest({ body: currentBody }), pullRequest({ body: currentBody })],
            dependentSets: [[]],
            receipts: [staleDigestReceipt],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls).toContain('receipt-authority:write:prepared:IC_delivery_42_2');
        expect(calls).toContain('receipt-authority:write:terminal:IC_delivery_42_2');
        expect(receipts[1]?.body).toBe(visibleDeliveryReceiptBody(42, 'head', currentBody, 2372, 'successful'));
    });

    it('recovers a lost add-comment response from the unique newest canonical receipt', () => {
        const { port, calls, receipts } = fakePort({ failAddReceiptOnce: true, dependentSets: [[], []] });

        deliverPullRequest(42, port);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(receipts).toHaveLength(1);
        expect(calls).toContain('merge:42:head');
    });

    it('merges the expected head and retargets stable dependents', () => {
        const { port, calls } = fakePort();

        deliverPullRequest(42, port);

        expect(calls).toEqual(expect.arrayContaining(['merge:42:head', 'retarget:43:main']));
    });

    it('refuses tracker completion when the post-merge snapshot names a foreign merger', () => {
        const { port, calls, tracker } = fakePort({ mergedByActorNodeIdAfterMerge: REVIEWER_BOT_NODE_ID });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/not merged by the author App/);

        expect(calls).toContain('merge:42:head');
        expect(calls.some((call) => call.startsWith('complete:'))).toBe(false);
    });

    it('rejects head drift during delivery', () => {
        const { port, calls } = fakePort({ primary: [pullRequest(), pullRequest({ headRefOid: 'moved' })] });

        expect(() => deliverPullRequest(42, port)).toThrow(/headRefOid changed/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('allows base movement during delivery when the feature head and mergeability stay stable', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest({ baseRefOid: 'base-before' }), pullRequest({ baseRefOid: 'base-after' })],
        });

        deliverPullRequest(42, port);

        expect(calls).toContain('merge:42:head');
    });

    it('rejects mergeability drift after harmless base movement', () => {
        const { port, calls } = fakePort({
            primary: [
                pullRequest({ mergeable: 'MERGEABLE', baseRefOid: 'base-before' }),
                pullRequest({ mergeable: 'CONFLICTING', baseRefOid: 'base-after' }),
            ],
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/conflicting changes/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects structural conflicts regardless of advisory CI state', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest({ mergeable: 'CONFLICTING', mergeStateStatus: 'CLEAN' })],
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/conflicting changes/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('refreshes a transient UNKNOWN structural mergeability once and then delivers', () => {
        const { port, calls } = fakePort({
            primary: [
                pullRequest({ mergeable: 'UNKNOWN' }),
                pullRequest({ mergeable: 'MERGEABLE' }),
                pullRequest({ mergeable: 'MERGEABLE' }),
            ],
        });

        deliverPullRequest(42, port);

        expect(calls).toContain('merge:42:head');
    });

    it('rejects release/x to main retargeting while refreshing UNKNOWN structural mergeability', () => {
        const { port, calls } = fakePort({
            primary: [
                pullRequest({ mergeable: 'UNKNOWN', baseRefName: 'release/x' }),
                pullRequest({ mergeable: 'MERGEABLE', baseRefName: 'main' }),
            ],
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/baseRefName changed during delivery/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects structural mergeability that remains UNKNOWN after one refresh', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest({ mergeable: 'UNKNOWN' }), pullRequest({ mergeable: 'UNKNOWN' })],
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/remained UNKNOWN after 1 refresh/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects a persistent UNKNOWN structural mergeability at the second validation point', () => {
        const { port, calls } = fakePort({
            primary: [
                pullRequest({ mergeable: 'MERGEABLE' }),
                pullRequest({ mergeable: 'UNKNOWN' }),
                pullRequest({ mergeable: 'UNKNOWN' }),
            ],
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/remained UNKNOWN after 1 refresh/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects base-branch changes during delivery', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest(), pullRequest({ baseRefName: 'release/1.0' })],
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/baseRefName changed/);
        expect(calls).not.toContain('merge:42:head');
    });

    /**
     * A retarget moves the base and leaves the head, the approval and the merge state untouched, so
     * every other gate here still reads green while the squash lands on a branch nobody reviewed
     * the change against.
     */
    it('refuses a pull request retargeted away from the trunk before delivery', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest({ baseRefName: 'release/1.0' }), pullRequest({ baseRefName: 'release/1.0' })],
        });

        let thrown: unknown;
        try {
            deliverPullRequest(42, port);
        } catch (error) {
            thrown = error;
        }

        expect(calls, 'a pull request retargeted to release/1.0 was squash-merged onto it').not.toContain(
            'merge:42:head'
        );
        expect(String(thrown)).toMatch(/PR #42 targets release\/1\.0, not main; deliver merges into main only/);
        expect(calls.some((call) => call.startsWith('retarget:'))).toBe(false);
    });

    /**
     * The already-merged path does not merge anything, but it does retarget every dependent onto
     * the merged pull request's base. A substituted base there moves the whole stack onto it.
     */
    it('refuses to repair dependents onto a substituted base', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest({ state: 'MERGED', baseRefName: 'release/1.0' })],
        });

        let thrown: unknown;
        try {
            deliverPullRequest(42, port);
        } catch (error) {
            thrown = error;
        }

        expect(calls, 'dependents were retargeted onto the substituted base release/1.0').not.toContainEqual(
            expect.stringMatching(/^retarget:/)
        );
        expect(String(thrown)).toMatch(/PR #42 targets release\/1\.0, not main/);
    });

    it('names the base it found, the base it requires, and the way out', () => {
        const { port } = fakePort({
            primary: [pullRequest({ baseRefName: 'agent/parent' }), pullRequest({ baseRefName: 'agent/parent' })],
        });

        expect(() => deliverPullRequest(42, port)).toThrow(
            /targets agent\/parent, not main.*Deliver the pull request this one is stacked on, which retargets this one/s
        );
    });

    it('delivers the trunk base the lane tooling opens every pull request against', () => {
        expect(REQUIRED_BASE_BRANCH).toBe('main');
        const { port, calls } = fakePort({ primary: [pullRequest(), pullRequest()] });

        deliverPullRequest(42, port);

        expect(calls).toContain('merge:42:head');
    });

    it('rejects unresolved review before merge', () => {
        const { port, calls } = fakePort({ review: { latestReviewerStateOnHead: 'APPROVED', unresolvedThreads: 1 } });

        expect(() => deliverPullRequest(42, port)).toThrow(/unresolved review/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects missing reviewer approval on the current head', () => {
        const { port, calls } = fakePort({ review: { latestReviewerStateOnHead: null, unresolvedThreads: 0 } });

        expect(() => deliverPullRequest(42, port)).toThrow(/not approved by the required reviewer actor/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects reviewer approval drift between the first and second pre-merge checks', () => {
        const { port, calls } = fakePort({
            reviewStates: [
                { latestReviewerStateOnHead: 'APPROVED', unresolvedThreads: 0 },
                { latestReviewerStateOnHead: null, unresolvedThreads: 0 },
            ],
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/not approved by the required reviewer actor/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects a review thread opened during receipt I/O at the post-receipt review check', () => {
        const { port, calls } = fakePort({
            reviewStateOnReceiptRead: { latestReviewerStateOnHead: 'APPROVED', unresolvedThreads: 1 },
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/unresolved review thread/);
        expect(calls.filter((call) => call.startsWith('review:'))).toHaveLength(2);
        expect(calls.indexOf('receipts:42')).toBeLessThan(calls.lastIndexOf('review:42:head'));
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects a base retargeted during receipt I/O before the final authority snapshot', () => {
        const { port, calls } = fakePort({ primaryBaseRefNameOnReceiptRead: 'release/1.0' });

        expect(() => deliverPullRequest(42, port)).toThrow(/baseRefName changed during delivery/);
        expect(calls).toContain('receipts:42');
        expect(calls).not.toContain('merge:42:head');
    });

    it.each(['COMMENTED', 'CHANGES_REQUESTED'])('rejects reviewer state %s', (state) => {
        const { port, calls } = fakePort({ review: { latestReviewerStateOnHead: state, unresolvedThreads: 0 } });

        expect(() => deliverPullRequest(42, port)).toThrow(/not approved/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('merges when the local working tree is unrelated to the pull-request head', () => {
        const { port, calls } = fakePort();

        deliverPullRequest(42, port);

        expect(calls).toContain('merge:42:head');
    });

    it('rejects a draft pull request', () => {
        const { port, calls } = fakePort({ primary: [pullRequest({ isDraft: true })] });

        expect(() => deliverPullRequest(42, port)).toThrow(/draft/);
        expect(calls).not.toContain('merge:42:head');
    });

    it.each([
        { ciState: 'successful', mergeStateStatus: 'BLOCKED', headCheckRuns: [checkRun()] },
        { ciState: 'failed', mergeStateStatus: 'CLEAN', headCheckRuns: [checkRun({ conclusion: 'FAILURE' })] },
        {
            ciState: 'pending',
            mergeStateStatus: 'CLEAN',
            headCheckRuns: [checkRun({ status: 'IN_PROGRESS', conclusion: null })],
        },
        { ciState: 'absent', mergeStateStatus: 'BLOCKED', headCheckRuns: [] as HeadCheckRun[] },
        {
            ciState: 'skipped',
            mergeStateStatus: 'CLEAN',
            headCheckRuns: [checkRun({ name: 'Native audio backend (macOS)', conclusion: 'SKIPPED' })],
        },
        {
            ciState: 'cancelled',
            mergeStateStatus: 'CLEAN',
            headCheckRuns: [checkRun({ name: 'Lint', conclusion: 'CANCELLED' }), checkRun()],
        },
        { ciState: 'unstable', mergeStateStatus: 'CLEAN', headCheckRuns: supersededRunCheckRuns() },
        {
            ciState: 'malformed',
            mergeStateStatus: 'CLEAN',
            headCheckRuns: [checkRun({ status: 'COMPLETED', conclusion: null })],
        },
        { ciState: 'unavailable', mergeStateStatus: 'CLEAN', headCheckRuns: new Error('check rollup offline') },
    ])('merges with $ciState CI evidence while CI admission is advisory', ({ mergeStateStatus, headCheckRuns }) => {
        const forbiddenGateRead = new Error('advisory delivery must not read gated workflow evidence');
        const { port, calls } = fakePort({
            primary: [pullRequest({ mergeStateStatus }), pullRequest({ mergeStateStatus })],
            gateRequiredCheckNames: forbiddenGateRead,
            headCheckRuns,
        });

        deliverPullRequest(42, port);

        expect(calls).toContain('merge:42:head');
        expect(calls).not.toContain('gate-required-check-names');
        expect(calls.filter((call) => call.startsWith('checks:'))).not.toEqual([]);
    });

    it.each([
        { ciState: 'successful', mergeStateStatus: 'BLOCKED', headCheckRuns: [checkRun()] },
        { ciState: 'failed', mergeStateStatus: 'CLEAN', headCheckRuns: [checkRun({ conclusion: 'FAILURE' })] },
        {
            ciState: 'pending',
            mergeStateStatus: 'CLEAN',
            headCheckRuns: [checkRun({ status: 'IN_PROGRESS', conclusion: null })],
        },
        { ciState: 'absent', mergeStateStatus: 'BLOCKED', headCheckRuns: [] as HeadCheckRun[] },
        {
            ciState: 'skipped',
            mergeStateStatus: 'CLEAN',
            headCheckRuns: [checkRun({ name: 'Native audio backend (macOS)', conclusion: 'SKIPPED' })],
        },
        {
            ciState: 'cancelled',
            mergeStateStatus: 'CLEAN',
            headCheckRuns: [checkRun({ name: 'Lint', conclusion: 'CANCELLED' }), checkRun()],
        },
        { ciState: 'unstable', mergeStateStatus: 'CLEAN', headCheckRuns: supersededRunCheckRuns() },
        {
            ciState: 'malformed',
            mergeStateStatus: 'CLEAN',
            headCheckRuns: [checkRun({ status: 'COMPLETED', conclusion: null })],
        },
        { ciState: 'unavailable', mergeStateStatus: 'CLEAN', headCheckRuns: new Error('check rollup offline') },
    ])(
        'writes advisory delivery receipts with the normalized $ciState CI state from head-check evidence',
        ({ ciState, mergeStateStatus, headCheckRuns }) => {
            const { port, receipts } = fakePort({
                primary: [pullRequest({ mergeStateStatus }), pullRequest({ mergeStateStatus })],
                headCheckRuns,
            });

            deliverPullRequest(42, port);

            expect(receipts).toHaveLength(1);
            expect(receipts[0]?.body).toContain('Delivery receipt for PR #42.');
            expect(receipts[0]?.body).toContain('- CI admission: advisory');
            expect(receipts[0]?.body).toContain(`- Observed CI state: ${ciState}`);
        }
    );

    it.each([
        {
            headCheckRuns: [
                checkRun({ name: '', status: 'COMPLETED', conclusion: 'SUCCESS' }),
                checkRun({ name: 'Lint', status: 'IN_PROGRESS', conclusion: null }),
                checkRun({ name: 'Unit suite 1/4', conclusion: 'FAILURE' }),
            ],
        },
        {
            headCheckRuns: [
                checkRun({ name: '', status: 'COMPLETED', conclusion: 'SUCCESS' }),
                checkRun({ name: 'Unit suite 1/4', conclusion: 'FAILURE' }),
                checkRun({ name: 'Lint', status: 'IN_PROGRESS', conclusion: null }),
            ],
        },
        {
            headCheckRuns: [
                checkRun({ name: 'Lint', status: 'IN_PROGRESS', conclusion: null }),
                checkRun({ name: '', status: 'COMPLETED', conclusion: 'SUCCESS' }),
                checkRun({ name: 'Unit suite 1/4', conclusion: 'FAILURE' }),
            ],
        },
        {
            headCheckRuns: [
                checkRun({ name: 'Lint', status: 'IN_PROGRESS', conclusion: null }),
                checkRun({ name: 'Unit suite 1/4', conclusion: 'FAILURE' }),
                checkRun({ name: '', status: 'COMPLETED', conclusion: 'SUCCESS' }),
            ],
        },
        {
            headCheckRuns: [
                checkRun({ name: 'Unit suite 1/4', conclusion: 'FAILURE' }),
                checkRun({ name: '', status: 'COMPLETED', conclusion: 'SUCCESS' }),
                checkRun({ name: 'Lint', status: 'IN_PROGRESS', conclusion: null }),
            ],
        },
        {
            headCheckRuns: [
                checkRun({ name: 'Unit suite 1/4', conclusion: 'FAILURE' }),
                checkRun({ name: 'Lint', status: 'IN_PROGRESS', conclusion: null }),
                checkRun({ name: '', status: 'COMPLETED', conclusion: 'SUCCESS' }),
            ],
        },
    ] satisfies Array<{ headCheckRuns: HeadCheckRun[] }>)(
        'writes malformed advisory evidence for the same mixed pending, failed, and malformed head in any order %#',
        ({ headCheckRuns }) => {
            const { port, receipts } = fakePort({
                primary: [pullRequest(), pullRequest()],
                headCheckRuns,
            });

            deliverPullRequest(42, port);

            expect(receipts).toHaveLength(1);
            expect(receipts[0]?.body).toContain('- Observed CI state: malformed');
        }
    );

    it.each([
        {
            headCheckRuns: [
                checkRun({ name: 'Lint', status: 'IN_PROGRESS', conclusion: null }),
                checkRun({ name: 'Unit suite 1/4', conclusion: 'FAILURE' }),
            ],
        },
        {
            headCheckRuns: [
                checkRun({ name: 'Unit suite 1/4', conclusion: 'FAILURE' }),
                checkRun({ name: 'Lint', status: 'IN_PROGRESS', conclusion: null }),
            ],
        },
    ] satisfies Array<{ headCheckRuns: HeadCheckRun[] }>)(
        'writes failed advisory evidence for the same mixed pending and failed head in any order %#',
        ({ headCheckRuns }) => {
            const { port, receipts } = fakePort({
                primary: [pullRequest(), pullRequest()],
                headCheckRuns,
            });

            deliverPullRequest(42, port);

            expect(receipts).toHaveLength(1);
            expect(receipts[0]?.body).toContain('- Observed CI state: failed');
        }
    );

    it('restores required-CI authority after a final unreadable rollup so a changed receipt body can deliver on retry', () => {
        const closesX = relationshipBody('Closes #2372');
        const closesY = relationshipBody('Closes #2373');
        const { port, calls, tracker, persistedReceiptAuthority, receipts } = fakePort({
            primary: [
                pullRequest({ body: closesX, mergeStateStatus: 'CLEAN' }),
                pullRequest({ body: closesX, mergeStateStatus: 'UNSTABLE' }),
                pullRequest({ body: closesY, mergeStateStatus: 'CLEAN' }),
                pullRequest({ body: closesY, mergeStateStatus: 'CLEAN' }),
            ],
            dependentSets: [[], []],
            headCheckRunReads: [new Error('PR #42 check rollup is unreadable')],
        });

        expect(() => deliverPullRequestWithRequiredCi(42, port, tracker)).toThrow(/check rollup is unreadable/);
        expect(calls).not.toContain('merge:42:head');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: requiredDeliveryReceiptBody(42, 'head', closesX, 2372),
        });
        expect(calls).not.toContain('complete:2372');
        expect(calls).not.toContain('complete:2373');

        deliverPullRequestWithRequiredCi(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(receipts.map(({ id }) => id)).toEqual(['IC_delivery_42_1', 'IC_delivery_42_2']);
        expect(receipts[1]?.body).toBe(requiredDeliveryReceiptBody(42, 'head', closesY, 2373));
        expect(calls).toContain('merge:42:head');
        expect(calls).not.toContain('complete:2372');
        expect(calls).toContain('complete:2373');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: requiredDeliveryReceiptBody(42, 'head', closesY, 2373),
            postMergeValidation: persistedPostMergeValidation('head', closesY, 2373),
        });
    });

    it.each([
        { finalMergeStateStatus: 'UNSTABLE', observedCiState: 'unstable' },
        { finalMergeStateStatus: 'BLOCKED', observedCiState: 'failed' },
    ] satisfies Array<{
        finalMergeStateStatus: 'UNSTABLE' | 'BLOCKED';
        observedCiState: 'unstable' | 'failed';
    }>)(
        'replaces the staged advisory receipt when the final same-head snapshot drifts to $finalMergeStateStatus',
        ({ finalMergeStateStatus, observedCiState }) => {
            const closes = relationshipBody('Closes #2372');
            const finalHeadCheckRuns =
                finalMergeStateStatus === 'UNSTABLE'
                    ? supersededRunCheckRuns()
                    : ([checkRun({ conclusion: 'FAILURE' })] satisfies HeadCheckRun[]);
            const { port, calls, receipts, persistedReceiptAuthority, tracker } = fakePort({
                primary: [
                    pullRequest({ body: closes, mergeStateStatus: 'CLEAN' }),
                    pullRequest({ body: closes, mergeStateStatus: finalMergeStateStatus }),
                ],
                dependentSets: [[], []],
                headCheckRunReads: [[checkRun()], finalHeadCheckRuns],
            });

            deliverPullRequest(42, port, tracker);

            expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
            expect(calls.lastIndexOf('add-receipt:42')).toBeLessThan(calls.indexOf('merge:42:head'));
            expect(receipts.map((receipt) => receipt.body)).toEqual([
                visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
                visibleDeliveryReceiptBody(42, 'head', closes, 2372, observedCiState),
            ]);
            expect(persistedReceiptAuthority()).toEqual({
                phase: 'terminal',
                receiptId: 'IC_delivery_42_2',
                receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, observedCiState),
                postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
            });
        }
    );

    it('recovers the replacement advisory receipt after a final CI-drift restaging merge response is lost, without posting a third receipt', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, receipts, persistedReceiptAuthority, tracker } = fakePort({
            primary: [
                pullRequest({ body: closes, mergeStateStatus: 'CLEAN' }),
                pullRequest({ body: closes, mergeStateStatus: 'UNSTABLE' }),
            ],
            dependentSets: [[], []],
            headCheckRunReads: [[checkRun()], supersededRunCheckRuns()],
        });
        const originalMerge = port.merge;
        let failMergeOnce = true;
        port.merge = (number, head, hasDependents) => {
            originalMerge(number, head, hasDependents);
            if (failMergeOnce) {
                failMergeOnce = false;
                throw new Error('merge response lost');
            }
        };

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/merge response lost/i);
        expect(receipts.map((receipt) => receipt.body)).toEqual([
            visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'unstable'),
        ]);
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'prepared',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'unstable'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
        expect(calls).not.toContain('complete:2372');

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(calls).toContain('receipt-authority:read:prepared:IC_delivery_42_2');
        expect(calls).toContain('receipt-authority:write:merge-authorized:IC_delivery_42_2');
        expect(calls).toContain('receipt-authority:write:terminal:IC_delivery_42_2');
        expect(calls).toContain('complete:2372');
        expect(persistedReceiptAuthority()).toEqual({
            phase: 'terminal',
            receiptId: 'IC_delivery_42_2',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'unstable'),
            postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
        });
    });

    it.each(['BLOCKED', 'BEHIND', 'DIRTY', 'DRAFT', 'UNKNOWN'])(
        'rejects merge state %s and names it, because it reports something other than checks',
        (mergeStateStatus) => {
            const { port, calls } = fakePort({
                primary: [pullRequest({ mergeStateStatus })],
                headCheckRuns: [checkRun()],
            });

            let thrown: unknown;
            try {
                deliverPullRequestWithRequiredCi(42, port);
            } catch (error) {
                thrown = error;
            }

            expect(String(thrown)).toBe(`Error: PR #42 merge state is ${mergeStateStatus}`);
            expect(calls).not.toContain('merge:42:head');
        }
    );

    /**
     * A CLEAN head is decided by GitHub's own aggregate, so the rollup is never read for it — the
     * fake refuses to hand one back, and this delivery never asks.
     */
    it('merges a CLEAN head without reading its check rollup', () => {
        const { port, calls } = fakePort({ primary: [pullRequest(), pullRequest()] });

        deliverPullRequestWithRequiredCi(42, port);

        expect(calls).toContain('merge:42:head');
        expect(calls.filter((call) => call.startsWith('checks:'))).toEqual([]);
    });

    /**
     * A cancelled run can leave its `Gate` behind on the head even when a later run on the same commit
     * passed, which is what makes GitHub call the head UNSTABLE here.
     */
    it('merges an UNSTABLE head whose only non-success runs were cancelled and whose Gate succeeded', () => {
        const unstable = { mergeStateStatus: 'UNSTABLE' };
        const { port, calls } = fakePort({
            primary: [pullRequest(unstable), pullRequest(unstable)],
            headCheckRuns: supersededRunCheckRuns(),
        });

        deliverPullRequestWithRequiredCi(42, port);

        expect(calls).toContain('merge:42:head');
    });

    /**
     * `NEUTRAL` is a check that ran and reached no verdict. It is deliberately absent from the
     * tolerated conclusions: an undecided result is not a passing one, which is the same reason a
     * cancellation with no success beside it refuses.
     */
    it.each(['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'NEUTRAL'])(
        'refuses an UNSTABLE head carrying a check that concluded %s',
        (conclusion) => {
            const { port, calls } = fakePort({
                primary: [pullRequest({ mergeStateStatus: 'UNSTABLE' })],
                headCheckRuns: [...supersededRunCheckRuns(), checkRun({ name: 'Unit suite 1/4', conclusion })],
            });

            let thrown: unknown;
            try {
                deliverPullRequestWithRequiredCi(42, port);
            } catch (error) {
                thrown = error;
            }

            expect(String(thrown)).toBe(
                `Error: PR #42 merge state is UNSTABLE and check Unit suite 1/4 concluded ${conclusion}`
            );
            expect(calls).not.toContain('merge:42:head');
        }
    );

    it('refuses an UNSTABLE head whose checks have not all settled', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest({ mergeStateStatus: 'UNSTABLE' })],
            headCheckRuns: [
                ...supersededRunCheckRuns(),
                checkRun({ name: 'End-to-end 3/12', status: 'IN_PROGRESS', conclusion: null }),
            ],
        });

        let thrown: unknown;
        try {
            deliverPullRequestWithRequiredCi(42, port);
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe(
            'Error: PR #42 merge state is UNSTABLE and check End-to-end 3/12 is still IN_PROGRESS'
        );
        expect(calls).not.toContain('merge:42:head');
    });

    /**
     * `Gate` is the one check the branch ruleset requires. A head where every run of it was
     * cancelled has never been decided, however tidy the rest of the rollup looks.
     */
    it('refuses an UNSTABLE head whose cancelled runs never left a successful Gate', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest({ mergeStateStatus: 'UNSTABLE' })],
            headCheckRuns: [
                checkRun({ name: 'Lint', conclusion: 'CANCELLED' }),
                checkRun({ name: 'Gate', conclusion: 'CANCELLED' }),
                checkRun({ name: 'Lint' }),
            ],
        });

        let thrown: unknown;
        try {
            deliverPullRequestWithRequiredCi(42, port);
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe('Error: PR #42 merge state is UNSTABLE and no Gate check succeeded on head');
        expect(calls).not.toContain('merge:42:head');
    });

    /**
     * The live shape of `Dependency review` when a cancelled attempt is followed only by later skips.
     * `Gate` passes on `skipped`, so a green `Gate` is not a dependency verdict, and the skips are not
     * one either. `Gate` needs that job, so this is why `deliver` refuses PR #2795's head today.
     */
    it('refuses an UNSTABLE head whose cancelled gate dependency only ever skipped beside it', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest({ mergeStateStatus: 'UNSTABLE' })],
            headCheckRuns: [
                ...supersededRunCheckRuns(),
                checkRun({ name: 'Dependency review', conclusion: 'CANCELLED' }),
                checkRun({ name: 'Dependency review', conclusion: 'SKIPPED' }),
                checkRun({ name: 'Dependency review', conclusion: 'SKIPPED' }),
            ],
        });

        let thrown: unknown;
        try {
            deliverPullRequestWithRequiredCi(42, port);
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe(
            'Error: PR #42 merge state is UNSTABLE and check Dependency review was cancelled and never succeeded on head'
        );
        expect(calls).not.toContain('merge:42:head');
    });

    /**
     * `Nightly failure report` is cancelled with the rest of the superseded run and never succeeds
     * on a pull request, because it reports a failed scheduled run and nothing else. `Gate` does not
     * need it, so its silence decides nothing — and refusing on it would refuse every delivery.
     */
    it('merges an UNSTABLE head whose only undecided cancellation is a check the gate does not need', () => {
        const unstable = { mergeStateStatus: 'UNSTABLE' };
        const { port, calls } = fakePort({
            primary: [pullRequest(unstable), pullRequest(unstable)],
            headCheckRuns: [
                ...supersededRunCheckRuns(),
                checkRun({ name: 'Nightly failure report', conclusion: 'CANCELLED' }),
                checkRun({ name: 'Nightly failure report', conclusion: 'SKIPPED' }),
            ],
        });

        deliverPullRequestWithRequiredCi(42, port);

        expect(calls).toContain('merge:42:head');
    });

    /**
     * A cancelled name is judged against the jobs `Gate` needs, not against the whole rollup, so a
     * check that has left the gating set stops blocking and one that joins it starts.
     */
    it('refuses only the cancelled names the supplied gating set contains', () => {
        const checkRuns = [
            ...supersededRunCheckRuns(),
            checkRun({ name: 'Secret scan', conclusion: 'CANCELLED' }),
            checkRun({ name: 'Secret scan', conclusion: 'SKIPPED' }),
        ];
        const tolerated = fakePort({
            primary: [pullRequest({ mergeStateStatus: 'UNSTABLE' }), pullRequest({ mergeStateStatus: 'UNSTABLE' })],
            headCheckRuns: checkRuns,
            gateRequiredCheckNames: new Set(['Gate', 'Lint']),
        });

        deliverPullRequestWithRequiredCi(42, tolerated.port);

        expect(tolerated.calls).toContain('merge:42:head');

        const refused = fakePort({
            primary: [pullRequest({ mergeStateStatus: 'UNSTABLE' })],
            headCheckRuns: checkRuns,
            gateRequiredCheckNames: new Set(['Gate', 'Lint', 'Secret scan']),
        });

        let thrown: unknown;
        try {
            deliverPullRequestWithRequiredCi(42, refused.port);
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe(
            'Error: PR #42 merge state is UNSTABLE and check Secret scan was cancelled and never succeeded on head'
        );
        expect(refused.calls).not.toContain('merge:42:head');
    });

    /**
     * The merge a hard-locked field indent used to wave through. `lint` declares `name: Lint` at
     * indent 6 — legal YAML, accepted by GitHub, reported as the check `Lint` — and a reader that
     * only looked for job fields at indent 4 saw no name at all, derived `lint`, and matched nothing
     * on a head where `Lint` was cancelled with no success beside it. Deriving the gating set
     * through the real parser is what turns that silent merge into this refusal.
     */
    it('refuses a head whose cancelled check belongs to a gated job declaring its name at a deeper indent', async () => {
        const workflowSource = [
            'name: Health gates',
            'jobs:',
            '  lint:',
            '      name: Lint',
            '      runs-on: ubuntu-latest',
            '  gate:',
            '    name: Gate',
            '    needs: lint',
        ].join('\n');
        const derived = await gatingNamesFor(workflowSource);

        expect([...derived]).toEqual(['Lint']);
        expect(parserCheckName(workflowSource, 'lint')).toBe('Lint');

        const { port, calls } = fakePort({
            primary: [pullRequest({ mergeStateStatus: 'UNSTABLE' })],
            headCheckRuns: [
                checkRun({ name: 'Lint', conclusion: 'CANCELLED' }),
                checkRun({ name: 'Native audio backend (macOS)', conclusion: 'SKIPPED' }),
                checkRun(),
            ],
            gateRequiredCheckNames: derived,
        });

        let thrown: unknown;
        try {
            deliverPullRequestWithRequiredCi(42, port);
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe(
            'Error: PR #42 merge state is UNSTABLE and check Lint was cancelled and never succeeded on head'
        );
        expect(calls).not.toContain('merge:42:head');
    });

    /**
     * The rule keys on a cancellation, not on the absence of a success: a job the workflow simply
     * never ran on this head has nothing to supersede and nothing to prove.
     */
    it('merges an UNSTABLE head carrying a check that only ever skipped and never cancelled', () => {
        const unstable = { mergeStateStatus: 'UNSTABLE' };
        const { port, calls } = fakePort({
            primary: [pullRequest(unstable), pullRequest(unstable)],
            headCheckRuns: [
                ...supersededRunCheckRuns(),
                checkRun({ name: 'Windows device layer', conclusion: 'SKIPPED' }),
                checkRun({ name: 'Windows device layer', conclusion: 'SKIPPED' }),
            ],
        });

        deliverPullRequestWithRequiredCi(42, port);

        expect(calls).toContain('merge:42:head');
    });

    it('refuses an UNSTABLE head with no checks at all', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest({ mergeStateStatus: 'UNSTABLE' })],
            headCheckRuns: [],
        });

        expect(() => deliverPullRequestWithRequiredCi(42, port)).toThrow(/no Gate check succeeded on head/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('refuses an UNSTABLE head carrying a conclusion it does not recognize', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest({ mergeStateStatus: 'UNSTABLE' })],
            headCheckRuns: [...supersededRunCheckRuns(), checkRun({ name: 'CodeQL', conclusion: 'STALE' })],
        });

        expect(() => deliverPullRequestWithRequiredCi(42, port)).toThrow(/check CodeQL concluded STALE/);
        expect(calls).not.toContain('merge:42:head');
    });

    /**
     * The rollup read can refuse, and a dependent's snapshot is read again immediately after the
     * squash has landed. A transient failure there would leave the dependents pointing at a merged
     * branch with the issue still open, so check evidence is fetched only where it is judged: for
     * the head being delivered, before the merge, and nowhere else. This fake refuses to hand back a
     * dependent's rollup at all, so a delivery that asks for one throws.
     */
    it('merges an UNSTABLE head and retargets dependents without reading a dependent rollup', () => {
        const unstable = { mergeStateStatus: 'UNSTABLE' };
        const { port, calls } = fakePort({
            primary: [pullRequest(unstable), pullRequest(unstable)],
            headCheckRuns: supersededRunCheckRuns(),
        });

        deliverPullRequestWithRequiredCi(42, port);

        expect(calls).toContain('merge:42:head');
        expect(calls).toContain('retarget:43:main');
        expect(calls.filter((call) => call.startsWith('checks:'))).toEqual(['checks:42:head', 'checks:42:head']);
    });
    it('rejects an aggregate CHANGES_REQUESTED decision', () => {
        const { port, calls } = fakePort({ primary: [pullRequest({ reviewDecision: 'CHANGES_REQUESTED' })] });

        expect(() => deliverPullRequest(42, port)).toThrow(/requested changes/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects dependent drift during delivery', () => {
        const before = stacked();
        const after = stacked({ headRefOid: 'moved' });
        const { port, calls } = fakePort({ dependentSets: [[before], [after]] });

        expect(() => deliverPullRequest(42, port)).toThrow(/stacked PR #43 changed/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects dependent-set additions during delivery', () => {
        const first = stacked();
        const added = stacked({ number: 44, headRefName: 'feat/other', headRefOid: 'other-head' });
        const { port, calls } = fakePort({ dependentSets: [[first], [first, added]] });

        expect(() => deliverPullRequest(42, port)).toThrow(/set changed/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('rejects stacked delivery when GitHub deletes merged branches', () => {
        const { port, calls } = fakePort({ deletesMergedBranches: true });

        expect(() => deliverPullRequest(42, port)).toThrow(/automatic merged-branch deletion/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('repairs dependents after an interrupted post-merge retarget', () => {
        const child = stacked();
        const sibling = stacked({ number: 44, headRefName: 'feat/sibling', headRefOid: 'sibling-head' });
        const { port, calls } = fakePort({
            primary: [pullRequest(), pullRequest(), pullRequest({ state: 'MERGED' })],
            dependentSets: [[child, sibling], [child, sibling], [sibling]],
            failRetargetOnce: 44,
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/retarget 44 failed/);
        expect(calls).toContain('merge:42:head');

        deliverPullRequest(42, port);

        expect(calls.filter((call) => call === 'retarget:44:main')).toHaveLength(2);
        expect(calls).toContain('PR #42 was already merged; repaired 1 remaining dependent(s)');
        expect(calls.filter((call) => call.startsWith('checks:'))).toEqual(['checks:42:head', 'checks:42:head']);
    });

    it.each([
        ['empty', body.replace('Change.', '')],
        ['title echo', body.replace('Change.', 'feat(delivery): add gate')],
        ['title remainder', body.replace('Change.', 'add gate')],
        ['duplicate', `${body}\n### 🎯 What does this PR do?\nAgain.`],
        [
            'out-of-order',
            body.replace(
                '### 🎯 What does this PR do?\nChange.\n### 🧪 How to test\nRun.',
                '### 🧪 How to test\nRun.\n### 🎯 What does this PR do?\nChange.'
            ),
        ],
    ])('rejects %s pull-request body sections', (_case, invalidBody) => {
        const { port, calls } = fakePort({ primary: [pullRequest({ body: invalidBody })] });

        expect(() => deliverPullRequest(42, port)).toThrow(/body/);
        expect(calls).not.toContain('merge:42:head');
    });
});

describe('gating check names', () => {
    function workflow(...jobs: string[]): string {
        return ['name: Health gates', 'on:', '  pull_request:', 'jobs:', ...jobs].join('\n');
    }

    const decide = ['  decide:', '    name: Decide scope', '    runs-on: ubuntu-latest'].join('\n');
    /**
     * Declares no job name, so GitHub labels its check with the job id — and carries a step whose
     * own `name:` sits deeper, which is not the job's name however early it appears in the job.
     */
    const boundaries = [
        '  boundaries:',
        '    needs: decide',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '        name: Checkout',
    ].join('\n');
    const dependencyReview = ['  dependency-review:', '    name: Dependency review', '    needs: decide'].join('\n');
    const nightly = ['  nightly-report:', '    name: Nightly failure report', '    needs: [decide, boundaries]'].join(
        '\n'
    );
    const gate = [
        '  gate:',
        '    name: Gate',
        '    # Comment lines and block scalars must not be read as needs.',
        '    needs:',
        '      - decide',
        '      - boundaries',
        '      - dependency-review',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Require every job to have succeeded or been skipped',
        '        run: |',
        '          set -euo pipefail',
        '          printf ok',
    ].join('\n');

    /**
     * The name GitHub labels a check with is the job's `name:`, and its job id only when the job
     * declares none — which is how `boundaries` appears in the checks list.
     */
    it('maps every job the gate needs to the name GitHub labels its check with', async () => {
        const names = await gatingNamesFor(workflow(decide, boundaries, dependencyReview, nightly, gate));

        expect([...names].sort()).toEqual(['Decide scope', 'Dependency review', 'boundaries']);
    });

    /**
     * A job that reports on a schedule is not merge evidence, however loudly it is cancelled on a
     * superseded pull-request run.
     */
    it('leaves a job outside the gate needs out of the gating set', async () => {
        const names = await gatingNamesFor(workflow(decide, boundaries, dependencyReview, nightly, gate));

        expect(names.has('Nightly failure report')).toBe(false);
    });

    it('reads a gate that needs one job written inline', async () => {
        const inlineGate = ['  gate:', '    name: Gate', '    needs: dependency-review'].join('\n');

        expect([...(await gatingNamesFor(workflow(decide, dependencyReview, inlineGate)))]).toEqual([
            'Dependency review',
        ]);
    });

    function gateNeeding(jobId: string): string {
        return ['  gate:', '    name: Gate', `    needs: ${jobId}`].join('\n');
    }

    /**
     * A job id is workflow-controlled text, and GitHub accepts `__proto__` as one. The summary is
     * built into a map on the launcher side and rebuilt into another on this side, and on an object
     * literal that key moves the prototype instead of creating an own property — so the job is
     * dropped by `JSON.stringify`, while the gate's own lookup still answers from the prototype and
     * derives the id. The check GitHub reports is `Weird`, so a `Weird` cancelled with nothing
     * beside it would merge with no verdict on a job the gate needs.
     */
    it('derives the declared name of a job whose id is __proto__', async () => {
        const inherited = ['  __proto__:', '    name: Weird'].join('\n');

        expect([...(await gatingNamesFor(workflow(inherited, gateNeeding('__proto__'))))]).toEqual(['Weird']);
    });

    /**
     * These name members of `Object.prototype`, not jobs. A lookup that reaches the prototype answers
     * with a function rather than `undefined`, so the gate skips the refusal it owes a `needs` entry
     * the workflow never defines and labels a check after the function it found.
     */
    it.each(['toString', 'valueOf', 'constructor'])(
        'refuses a gate needing %s, which names an inherited member and no job',
        async (jobId) => {
            expect(await refusalFor(workflow(decide, gateNeeding(jobId)))).toBe(
                `Error: the gate job in ${WORKFLOW_PATH} needs ${jobId}, which no job in that workflow defines`
            );
        }
    );

    /**
     * `.inf` and `.nan` are YAML floats, and JSON carries neither: `JSON.stringify` writes both as
     * `null`, which the gate reads as "declares no name" and answers with the job id — the one thing
     * a name that is not text must never resolve to. `42` refused already, so a fix that only reached
     * the shapes JSON happens to survive would leave these two silently wrong.
     */
    it.each(['.inf', '.nan', '42'])('refuses a gated job whose name is the non-text scalar %s', async (scalar) => {
        const source = workflow(['  lint:', `    name: ${scalar}`].join('\n'), gateNeeding('lint'));

        expect(await refusalFor(source)).toBe(
            `Error: the lint job in ${WORKFLOW_PATH} declares a name that is not text, ` +
                'which cannot be the name GitHub reports'
        );
    });

    /**
     * Every shape here is legal YAML that GitHub accepts, and every one of them used to refuse — or,
     * worse, resolve to something GitHub never reports — because a line-oriented reader cannot see
     * what a parser sees. Three consecutive review rounds each closed one of these and left the next
     * open, which is why the parse now belongs to the `yaml` package.
     *
     * Each case asserts the derived name against `parserCheckName`, which reads the same source with
     * that package independently. Pinning the literal too would only restate the derivation.
     */
    it.each([
        { label: 'a name field indented three spaces', job: ['  lint:', '   name: Lint'], expected: 'Lint' },
        { label: 'a name field indented five spaces', job: ['  lint:', '     name: Lint'], expected: 'Lint' },
        { label: 'a name field indented six spaces', job: ['  lint:', '      name: Lint'], expected: 'Lint' },
        {
            label: 'a name ending at a tab-separated comment',
            job: ['  lint:', '    name: Lint\t# only lints'],
            expected: 'Lint',
        },
        {
            label: 'a name ending at a space-separated comment',
            job: ['  lint:', '    name: Lint # the fast lane'],
            expected: 'Lint',
        },
        {
            label: 'a plain name continued onto the next line',
            job: ['  lint:', '    name: Types and', '      contracts'],
            expected: 'Types and contracts',
        },
        {
            label: 'a double-quoted name continued onto the next line',
            job: ['  lint:', '    name: "Types and', '      contracts"'],
            expected: 'Types and contracts',
        },
        { label: 'a name key with space before its colon', job: ['  lint:', '    name : Lint'], expected: 'Lint' },
        { label: 'a double-quoted name key', job: ['  lint:', '    "name": Lint'], expected: 'Lint' },
        { label: 'a single-quoted name key', job: ['  lint:', "    'name': Lint"], expected: 'Lint' },
        { label: 'an anchored name', job: ['  lint:', '    name: &fast Lint'], expected: 'Lint' },
        { label: 'a tagged name', job: ['  lint:', '    name: !!str Lint'], expected: 'Lint' },
        { label: 'a folded block name', job: ['  lint:', '    name: >-', '      Lint'], expected: 'Lint' },
        { label: 'a literal block name', job: ['  lint:', '    name: |-', '      Lint'], expected: 'Lint' },
        {
            label: 'a double-quoted name carrying an escape',
            job: ['  lint:', '    name: "Lint \\"fast\\""'],
            expected: 'Lint "fast"',
        },
        {
            label: 'a single-quoted name doubling its apostrophe',
            job: ['  lint:', "    name: 'Lint''s pass'"],
            expected: "Lint's pass",
        },
        { label: 'a name that is only a comment', job: ['  lint:', '    name: # the fast lane'], expected: 'lint' },
        { label: 'a name declared empty', job: ['  lint:', '    name:'], expected: 'lint' },
        { label: 'no name at all', job: ['  lint:', '    runs-on: ubuntu-latest'], expected: 'lint' },
    ])('resolves $label to the name the yaml package produces', async ({ job, expected }) => {
        const source = workflow(job.join('\n'), gateNeeding('lint'));

        expect([...(await gatingNamesFor(source))]).toEqual([parserCheckName(source, 'lint')]);
        expect([...(await gatingNamesFor(source))]).toEqual([expected]);
    });

    /**
     * An alias resolves against an anchor declared elsewhere in the document, which no reader that
     * looks at one line at a time can do. GitHub reports the anchored value.
     */
    it('resolves an aliased name to the name the yaml package produces', async () => {
        const source = workflow(
            ['  decide:', '    name: &fast Lint'].join('\n'),
            ['  lint:', '    name: *fast'].join('\n'),
            gateNeeding('lint')
        );

        expect([...(await gatingNamesFor(source))]).toEqual([parserCheckName(source, 'lint')]);
        expect([...(await gatingNamesFor(source))]).toEqual(['Lint']);
    });

    /**
     * A block sequence may sit at its key's own indent. This used to refuse with `needs no job`,
     * which was simply false — the gate needed three.
     */
    it('reads a needs block sequence written at the key own indent', async () => {
        const ownIndentGate = [
            '  gate:',
            '    name: Gate',
            '    needs:',
            '    - decide',
            '    - dependency-review',
        ].join('\n');

        expect([...(await gatingNamesFor(workflow(decide, dependencyReview, ownIndentGate)))].sort()).toEqual([
            'Decide scope',
            'Dependency review',
        ]);
    });

    /**
     * A trailing comment on a job-id line used to refuse with the generic "cannot read the jobs in",
     * which pointed nowhere near its cause. It is an ordinary comment and resolves.
     */
    it('reads a job whose id line carries a trailing comment', async () => {
        const source = workflow(['  lint: # the fast lane', '    name: Lint'].join('\n'), gateNeeding('lint'));

        expect([...(await gatingNamesFor(source))]).toEqual(['Lint']);
    });

    /**
     * `jobs:` is not the last block in this workflow, and a top-level key that follows it is not a
     * job however it is spelled.
     */
    it('reads only the jobs block when another top-level key follows it', async () => {
        const source = [
            workflow(decide, boundaries, dependencyReview, nightly, gate),
            'permissions:',
            '  contents: read',
        ].join('\n');

        expect([...(await gatingNamesFor(source))].sort()).toEqual(['Decide scope', 'Dependency review', 'boundaries']);
    });

    /**
     * `unit` and `e2e` are one line away from joining the gate, and GitHub reports one check per
     * shard with the expression substituted. The declared name matches none of them, so promoting
     * such a job silently adds an entry that can never fire. Recorded as issue #2924.
     */
    it('refuses a matrix job promoted into the gate rather than gating on a name GitHub never reports', async () => {
        const unit = [
            '  unit:',
            '    name: Unit suite ${{ matrix.shard }}/4',
            '    strategy:',
            '      matrix:',
            '        shard: [1, 2, 3, 4]',
        ].join('\n');

        expect(await refusalFor(workflow(unit, gateNeeding('unit')))).toBe(
            `Error: the unit job in ${WORKFLOW_PATH} names its check Unit suite \${{ matrix.shard }}/4, ` +
                'which GitHub substitutes per matrix job before reporting it'
        );
    });

    /**
     * A reusable workflow reports one check per inner job, named `<job name> / <inner job name>`.
     * The single name derived here matches none of them, so promoting such a job into the gate would
     * add an entry that can never fire — the same failure as a matrix name, from a different cause.
     */
    it('refuses a gated job that calls a reusable workflow', async () => {
        const release = ['  release:', '    name: Release', '    uses: ./.github/workflows/release.yml'].join('\n');

        expect(await refusalFor(workflow(release, gateNeeding('release')))).toBe(
            `Error: the release job in ${WORKFLOW_PATH} calls a reusable workflow, ` +
                'whose checks GitHub reports as one name per inner job rather than the one name this gate derives'
        );
    });

    it.each([
        {
            label: 'a jobs block that is a sequence rather than a mapping of job ids',
            source: workflow('  - decide', '  - gate'),
            message: `Error: cannot read ${WORKFLOW_PATH} to determine which checks gate the merge: it declares no jobs mapping`,
        },
        {
            label: 'a workflow with no gate job',
            source: workflow(decide, boundaries, dependencyReview, nightly),
            message: `Error: ${WORKFLOW_PATH} declares no gate job, so no check can be proven to gate the merge`,
        },
        {
            label: 'a gate job that needs nothing',
            source: workflow(decide, ['  gate:', '    name: Gate', '    runs-on: ubuntu-latest'].join('\n')),
            message: `Error: the gate job in ${WORKFLOW_PATH} needs no job, so no check can be proven to gate the merge`,
        },
        {
            label: 'a gate job whose needs list is empty',
            source: workflow(decide, ['  gate:', '    name: Gate', '    needs: []'].join('\n')),
            message: `Error: the gate job in ${WORKFLOW_PATH} needs no job, so no check can be proven to gate the merge`,
        },
        {
            label: 'a gate job whose needs entry is not a job id',
            source: workflow(decide, ['  gate:', '    name: Gate', '    needs: [decide, 7]'].join('\n')),
            message:
                `Error: the gate job in ${WORKFLOW_PATH} needs an entry that is not a job id, ` +
                'so no check can be proven to gate the merge',
        },
        {
            label: 'a gate job needing a job the workflow does not define',
            source: workflow(decide, ['  gate:', '    name: Gate', '    needs:', '      - typo'].join('\n')),
            message: `Error: the gate job in ${WORKFLOW_PATH} needs typo, which no job in that workflow defines`,
        },
        {
            label: 'a gated job whose name is not text',
            source: workflow(['  lint:', '    name: [Lint, Fast]'].join('\n'), gateNeeding('lint')),
            message:
                `Error: the lint job in ${WORKFLOW_PATH} declares a name that is not text, ` +
                'which cannot be the name GitHub reports',
        },
    ])('refuses $label', async ({ source, message }) => {
        expect(await refusalFor(source)).toBe(message);
    });

    const UNLAUNCHED_GATE_REFUSAL =
        'Error: deliver must run through the protected primary checkout launcher, which passes ' +
        `SOURDAW_TRUSTED_GATE_WORKFLOW from ${WORKFLOW_PATH} at the pinned origin/main commit`;

    /**
     * The launcher parses the workflow at the pinned commit and hands the summary across; nothing in
     * the snapshot can read a workflow for itself. A `deliver` that never came through the launcher
     * therefore cannot say which checks decide the merge, and refuses rather than tolerating every
     * cancellation on the head.
     */
    it.each([
        { label: 'no gating workflow from the launcher', env: {} },
        { label: 'an empty gating workflow', env: { SOURDAW_TRUSTED_GATE_WORKFLOW: '' } },
    ])('refuses $label', ({ env }) => {
        let thrown: unknown;
        try {
            readGateRequiredCheckNames(env);
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe(UNLAUNCHED_GATE_REFUSAL);
    });

    it('derives the gating set from the workflow summary the launcher passed', async () => {
        const names = readGateRequiredCheckNames({
            SOURDAW_TRUSTED_GATE_WORKFLOW: JSON.stringify(
                await summarizeGateWorkflow(workflow(decide, boundaries, dependencyReview, nightly, gate))
            ),
        });

        expect([...names].sort()).toEqual(['Decide scope', 'Dependency review', 'boundaries']);
    });

    /**
     * The summary crosses a process boundary as JSON, so the gate reads it as untrusted text. A
     * value it cannot read is not a gating set, and merging on one would be merging on nothing.
     */
    it.each([
        {
            label: 'a summary that is not JSON',
            serialized: '{',
            expected: `${WORKFLOW_PATH} to determine which checks gate the merge: SOURDAW_TRUSTED_GATE_WORKFLOW is not JSON:`,
        },
        {
            label: 'a summary that is not an object',
            serialized: '["gate"]',
            expected: 'SOURDAW_TRUSTED_GATE_WORKFLOW is not a workflow summary',
        },
        {
            label: 'a summary carrying no jobs mapping',
            serialized: '{"jobs":"gate"}',
            expected: 'SOURDAW_TRUSTED_GATE_WORKFLOW carries no jobs mapping',
        },
        {
            label: 'a summary whose job is not a mapping',
            serialized: '{"jobs":{"gate":"needed"}}',
            expected: 'the gate job is not a mapping',
        },
    ])('refuses $label', ({ serialized, expected }) => {
        let thrown: unknown;
        try {
            gateRequiredCheckNames(serialized);
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toContain(expected);
    });

    /**
     * The launcher carries a workflow it could not parse across as a reason rather than throwing, so
     * the refusal is worded and owned here. Both arms name what was wrong with the file.
     */
    it.each([
        {
            label: 'a workflow that is not valid YAML',
            source: 'jobs:\n  gate:\n   - "unterminated',
            reason: 'not valid YAML',
        },
        {
            label: 'a workflow declaring no jobs mapping',
            source: 'name: Health gates\non:\n  pull_request:\n',
            reason: 'it declares no jobs mapping',
        },
    ])('refuses $label', async ({ source, reason }) => {
        expect(await refusalFor(source)).toContain(
            `cannot read ${WORKFLOW_PATH} to determine which checks gate the merge:`
        );
        expect(await refusalFor(source)).toContain(reason);
    });

    /**
     * The set this repository's own workflow produces, compared against the `yaml` package reading
     * the same file. A hand-copied expectation here would only restate whatever the gate derived;
     * comparing with an independent parse is what makes a divergence fail.
     */
    it('derives the same gating set from the live workflow as the yaml package does', async () => {
        const expected = parserGateNeeds(LIVE_WORKFLOW_SOURCE).map((jobId) =>
            parserCheckName(LIVE_WORKFLOW_SOURCE, jobId)
        );

        expect([...(await gatingNamesFor(LIVE_WORKFLOW_SOURCE))].sort()).toEqual([...expected].sort());
        expect(expected.length).toBeGreaterThan(0);
    });

    /**
     * The rollup on PR #2795 carried exactly two names cancelled with no success beside them:
     * `Dependency review`, which `Gate` needs, and `Nightly failure report`, which it does not.
     */
    it('gates on the dependency scan and not on the nightly report in this repository', async () => {
        const names = await gatingNamesFor(LIVE_WORKFLOW_SOURCE);

        expect(names.has('Dependency review')).toBe(true);
        expect(names.has('Nightly failure report')).toBe(false);
    });
});

describe('delivery CLI', () => {
    it('parses one pull-request number', () => {
        expect(parseCliArgs(['42'])).toEqual({ number: 42, help: false });
    });

    it.each([
        [['42', '--unknown'], /unknown option/],
        [['0'], /usage/],
        [['--help', '--unknown'], /help takes no other arguments/],
    ])('rejects malformed arguments %#', (args, message) => {
        expect(() => parseCliArgs(args)).toThrow(message);
    });
});

describe('delivery shell boundary', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    function rollupPort(pages: Array<RollupPageFixture | string>) {
        const captures: Array<{ command: string; args: string[] }> = [];
        const remaining = [...pages];
        const port = shellPort('jcosta33/sourdaw', {
            capture: (command, args) => {
                captures.push({ command, args });
                const joined = args.join(' ');
                if (joined.includes('pr view')) {
                    return JSON.stringify(shellPullRequest(pullRequest()));
                }
                const page = remaining.shift();
                if (page === undefined) {
                    throw new Error(`unexpected capture: ${command} ${joined}`);
                }
                return typeof page === 'string' ? page : rollupResponse(page);
            },
            run: () => undefined,
        });
        return { captures, port };
    }

    function rollupCaptures(captures: Array<{ command: string; args: string[] }>): string[] {
        return captures.map((entry) => entry.args.join(' ')).filter((joined) => joined.includes('statusCheckRollup'));
    }

    /**
     * The rollup decides whether an UNSTABLE head merges, so both arms of the union have to reach
     * the snapshot. A dropped StatusContext would take a failing external check with it.
     */
    it('asks GitHub for the head rollup and normalizes both arms of its union', () => {
        const { captures, port } = rollupPort([
            {
                nodes: [
                    { __typename: 'CheckRun', name: 'Gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
                    { __typename: 'CheckRun', name: 'Lint', status: 'COMPLETED', conclusion: 'CANCELLED' },
                    { __typename: 'CheckRun', name: 'End-to-end 1/12', status: 'IN_PROGRESS', conclusion: '' },
                    { __typename: 'StatusContext', context: 'coverage/external', state: 'FAILURE' },
                    { __typename: 'StatusContext', context: 'deploy/preview', state: 'PENDING' },
                ],
            },
        ]);

        const checkRuns = port.headCheckRuns(42, 'head');

        expect(rollupCaptures(captures)).toHaveLength(1);
        expect(rollupCaptures(captures)[0]).toContain('oid=head');
        expect(checkRuns).toEqual([
            { name: 'Gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
            { name: 'Lint', status: 'COMPLETED', conclusion: 'CANCELLED' },
            { name: 'End-to-end 1/12', status: 'IN_PROGRESS', conclusion: null },
            { name: 'coverage/external', status: 'COMPLETED', conclusion: 'FAILURE' },
            { name: 'deploy/preview', status: 'PENDING', conclusion: null },
        ]);
    });

    /**
     * A rollup read can refuse, and `pullRequest` is called for every dependent and for an
     * already-merged head — both after the squash has landed. Keeping the read off the snapshot is
     * what stops a transient GitHub failure from stranding dependents on a merged branch.
     */
    it('reads no rollup when asked for a pull-request snapshot', () => {
        const { captures, port } = rollupPort([{ nodes: rollupNodes([checkRun()]) }]);

        const snapshot = port.pullRequest(42);

        expect(snapshot.headRefOid).toBe('head');
        expect(rollupCaptures(captures)).toEqual([]);
        expect(captures.find((capture) => capture.args.includes('view'))?.args.join(' ')).toContain('mergeable');

        port.headCheckRuns(42, 'head');

        expect(rollupCaptures(captures)).toHaveLength(1);
    });

    it('queries and normalizes the immutable merged-by actor node ID', () => {
        const captures: Array<{ command: string; args: string[] }> = [];
        const port = shellPort('jcosta33/sourdaw', {
            capture: (command, args) => {
                captures.push({ command, args });
                const joined = args.join(' ');
                if (joined.includes('pr view')) {
                    return JSON.stringify(
                        shellPullRequest(pullRequest({ state: 'MERGED', mergedByActorNodeId: AUTHOR_BOT_NODE_ID }))
                    );
                }
                if (joined.includes('mergedBy{__typename')) {
                    return args.join('\u0000') ===
                        [
                            'api',
                            'graphql',
                            '-f',
                            'query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){mergedBy{__typename ... on Bot{id}}}}}',
                            '-f',
                            'owner=jcosta33',
                            '-f',
                            'name=sourdaw',
                            '-F',
                            'number=42',
                        ].join('\u0000')
                        ? shellMergedByGraphql({ __typename: 'Bot', id: AUTHOR_BOT_NODE_ID })
                        : shellMergedByGraphql({ __typename: 'Bot', id: REVIEWER_BOT_NODE_ID });
                }
                throw new Error(`unexpected capture: ${command} ${joined}`);
            },
            run: () => undefined,
        });

        expect(port.pullRequest(42).mergedByActorNodeId).toBe(AUTHOR_BOT_NODE_ID);
        expect(captures[0]?.args.join(' ')).toContain('mergedBy');
        expect(captures[1]?.args).toEqual([
            'api',
            'graphql',
            '-f',
            'query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){mergedBy{__typename ... on Bot{id}}}}}',
            '-f',
            'owner=jcosta33',
            '-f',
            'name=sourdaw',
            '-F',
            'number=42',
        ]);
    });

    it('preserves paginated REST issue-comment response order for receipt authority', () => {
        const captures: Array<{ command: string; args: string[] }> = [];
        const comment = (id: string, receiptBody: string, createdAt: string) => ({
            node_id: id,
            body: receiptBody,
            user: { node_id: AUTHOR_BOT_NODE_ID, login: 'renamed-author[bot]', type: 'Bot' },
            created_at: createdAt,
            updated_at: createdAt,
        });
        const port = shellPort('jcosta33/sourdaw', {
            capture: (command, args) => {
                captures.push({ command, args });
                return JSON.stringify([
                    [
                        comment(
                            'IC_x',
                            deliveryReceiptBody(42, 'head', relationshipBody('Closes #2372'), 2372),
                            '2026-08-21T00:00:01Z'
                        ),
                    ],
                    [
                        comment(
                            'IC_y',
                            deliveryReceiptBody(42, 'head', relationshipBody('Closes #2373'), 2373),
                            '2026-08-21T00:00:00Z'
                        ),
                    ],
                ]);
            },
            run: () => undefined,
        });

        expect(port.deliveryReceipts(42).map(({ id }) => id)).toEqual(['IC_x', 'IC_y']);
        expect(captures[0]?.args).toEqual([
            'api',
            '--paginate',
            '--slurp',
            'repos/jcosta33/sourdaw/issues/42/comments?per_page=100',
        ]);
    });

    it('reads complete shellPort receipt comments in ascending issue-comment order and proves the full immutable sequence with GraphQL', () => {
        const captures: Array<{ command: string; args: string[] }> = [];
        const comment = (
            id: string,
            receiptBody: string,
            author: { nodeId: string | null; login: string; type: string }
        ) => ({
            node_id: id,
            body: receiptBody,
            user: { node_id: author.nodeId, login: author.login, type: author.type },
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
        });
        const port = shellPort('jcosta33/sourdaw', {
            capture: (_command, args) => {
                captures.push({ command: 'gh', args });
                const joined = args.join(' ');
                if (joined.includes('issues/42/comments?per_page=100')) {
                    return JSON.stringify([
                        [
                            comment('IC_author_note', 'ordinary note', {
                                nodeId: AUTHOR_BOT_NODE_ID,
                                login: 'renamed-author[bot]',
                                type: 'Bot',
                            }),
                            comment(
                                'IC_foreign_copy',
                                deliveryReceiptBody(42, 'head', relationshipBody('Closes #2372'), 2372),
                                {
                                    nodeId: null,
                                    login: 'jcosta33',
                                    type: 'User',
                                }
                            ),
                        ],
                        [
                            comment(
                                'IC_receipt_older',
                                visibleDeliveryReceiptBody(
                                    42,
                                    'head',
                                    relationshipBody('Closes #2372'),
                                    2372,
                                    'successful'
                                ),
                                {
                                    nodeId: AUTHOR_BOT_NODE_ID,
                                    login: 'renamed-author[bot]',
                                    type: 'Bot',
                                }
                            ),
                            comment(
                                'IC_receipt_newest',
                                visibleDeliveryReceiptBody(
                                    42,
                                    'head',
                                    relationshipBody('Closes #2373'),
                                    2373,
                                    'successful'
                                ),
                                {
                                    nodeId: AUTHOR_BOT_NODE_ID,
                                    login: 'renamed-author[bot]',
                                    type: 'Bot',
                                }
                            ),
                        ],
                    ]);
                }
                if (
                    joined.includes(
                        'comments(first:100,after:$cursor,orderBy:{field:CREATED_AT,direction:ASC}){totalCount pageInfo{hasNextPage endCursor} nodes{id lastEditedAt}}'
                    )
                ) {
                    return shellDeliveryReceiptProofResponse([
                        'IC_author_note',
                        'IC_foreign_copy',
                        'IC_receipt_older',
                        'IC_receipt_newest',
                    ]);
                }
                throw new Error(`unexpected capture: ${joined}`);
            },
            run: () => undefined,
        });

        expect(port.deliveryReceipts(42).map(({ id }) => id)).toEqual([
            'IC_author_note',
            'IC_foreign_copy',
            'IC_receipt_older',
            'IC_receipt_newest',
        ]);
        expect(port.deliveryReceiptProof(42)).toEqual(
            deliveryReceiptProofForIds(['IC_author_note', 'IC_foreign_copy', 'IC_receipt_older', 'IC_receipt_newest'])
        );
        expect(captures).toEqual([
            {
                command: 'gh',
                args: ['api', '--paginate', '--slurp', 'repos/jcosta33/sourdaw/issues/42/comments?per_page=100'],
            },
            {
                command: 'gh',
                args: [
                    'api',
                    'graphql',
                    '-f',
                    ORDERED_RECEIPT_PROOF_QUERY,
                    '-f',
                    'owner=jcosta33',
                    '-f',
                    'name=sourdaw',
                    '-F',
                    'number=42',
                ],
            },
        ]);
    });

    it('reads a stable multi-page GraphQL receipt proof to the final page before trusting the sequence', () => {
        const captures: Array<{ command: string; args: string[] }> = [];
        const port = shellPort('jcosta33/sourdaw', {
            capture: (_command, args) => {
                captures.push({ command: 'gh', args });
                const joined = args.join(' ');
                if (
                    joined.includes(
                        'comments(first:100,after:$cursor,orderBy:{field:CREATED_AT,direction:ASC}){totalCount pageInfo{hasNextPage endCursor} nodes{id lastEditedAt}}'
                    )
                ) {
                    if (joined.includes('cursor=cursor-1')) {
                        return shellDeliveryReceiptProofResponse(['IC_receipt_older', 'IC_receipt_newest'], {
                            totalCount: 4,
                        });
                    }
                    return shellDeliveryReceiptProofResponse(['IC_author_note', 'IC_foreign_copy'], {
                        totalCount: 4,
                        hasNextPage: true,
                        endCursor: 'cursor-1',
                    });
                }
                throw new Error(`unexpected capture: ${joined}`);
            },
            run: () => undefined,
        });

        expect(port.deliveryReceiptProof(42)).toEqual(
            deliveryReceiptProofForIds(['IC_author_note', 'IC_foreign_copy', 'IC_receipt_older', 'IC_receipt_newest'])
        );
        expect(captures).toEqual([
            {
                command: 'gh',
                args: [
                    'api',
                    'graphql',
                    '-f',
                    ORDERED_RECEIPT_PROOF_QUERY,
                    '-f',
                    'owner=jcosta33',
                    '-f',
                    'name=sourdaw',
                    '-F',
                    'number=42',
                ],
            },
            {
                command: 'gh',
                args: [
                    'api',
                    'graphql',
                    '-f',
                    ORDERED_RECEIPT_PROOF_QUERY,
                    '-f',
                    'owner=jcosta33',
                    '-f',
                    'name=sourdaw',
                    '-F',
                    'number=42',
                    '-f',
                    'cursor=cursor-1',
                ],
            },
        ]);
    });

    it('requests GraphQL receipt proof in created-at ascending order', () => {
        const captures: string[] = [];
        const port = shellPort('jcosta33/sourdaw', {
            capture: (_command, args) => {
                const joined = args.join(' ');
                captures.push(joined);
                if (
                    joined.includes(
                        'comments(first:100,after:$cursor,orderBy:{field:CREATED_AT,direction:ASC}){totalCount pageInfo{hasNextPage endCursor} nodes{id lastEditedAt}}'
                    )
                ) {
                    return shellDeliveryReceiptProofResponse([]);
                }
                throw new Error(`unexpected capture: ${joined}`);
            },
            run: () => undefined,
        });

        expect(port.deliveryReceiptProof(42)).toEqual(deliveryReceiptProofForIds([]));
        expect(captures).toEqual([
            `api graphql -f ${ORDERED_RECEIPT_PROOF_QUERY} -f owner=jcosta33 -f name=sourdaw -F number=42`,
        ]);
    });

    it('fails shellPort receipt proof when GraphQL cursors cycle across later pages even if the final count could still be reached', () => {
        let cursorOneReads = 0;
        const port = shellPort('jcosta33/sourdaw', {
            capture: (_command, args) => {
                const joined = args.join(' ');
                if (
                    joined.includes(
                        'comments(first:100,after:$cursor,orderBy:{field:CREATED_AT,direction:ASC}){totalCount pageInfo{hasNextPage endCursor} nodes{id lastEditedAt}}'
                    )
                ) {
                    if (joined.includes('cursor=cursor-2')) {
                        return shellDeliveryReceiptProofResponse(['IC_c'], {
                            totalCount: 4,
                            hasNextPage: true,
                            endCursor: 'cursor-1',
                        });
                    }
                    if (joined.includes('cursor=cursor-1')) {
                        cursorOneReads += 1;
                        return cursorOneReads === 1
                            ? shellDeliveryReceiptProofResponse(['IC_b'], {
                                  totalCount: 4,
                                  hasNextPage: true,
                                  endCursor: 'cursor-2',
                              })
                            : shellDeliveryReceiptProofResponse(['IC_d'], {
                                  totalCount: 4,
                              });
                    }
                    return shellDeliveryReceiptProofResponse(['IC_a'], {
                        totalCount: 4,
                        hasNextPage: true,
                        endCursor: 'cursor-1',
                    });
                }
                throw new Error(`unexpected capture: ${joined}`);
            },
            run: () => undefined,
        });

        expect(() => port.deliveryReceiptProof(42)).toThrow(/cannot inspect delivery receipts for PR #42/i);
    });

    it('fails shellPort receipt proof when a continuing GraphQL page adds no unseen comment ids even if a later page would finish the count', () => {
        const port = shellPort('jcosta33/sourdaw', {
            capture: (_command, args) => {
                const joined = args.join(' ');
                if (joined.includes(ORDERED_RECEIPT_PROOF_QUERY_FRAGMENT)) {
                    if (joined.includes('cursor=cursor-2')) {
                        return shellDeliveryReceiptProofResponse(['IC_b', 'IC_c'], {
                            totalCount: 3,
                        });
                    }
                    if (joined.includes('cursor=cursor-1')) {
                        return shellDeliveryReceiptProofResponse([], {
                            totalCount: 3,
                            hasNextPage: true,
                            endCursor: 'cursor-2',
                        });
                    }
                    return shellDeliveryReceiptProofResponse(['IC_a'], {
                        totalCount: 3,
                        hasNextPage: true,
                        endCursor: 'cursor-1',
                    });
                }
                throw new Error(`unexpected capture: ${joined}`);
            },
            run: () => undefined,
        });

        expect(() => port.deliveryReceiptProof(42)).toThrow(/cannot inspect delivery receipts for PR #42/i);
    });

    it('fails shellPort receipt proof when GraphQL pages repeat a comment id across pages', () => {
        const port = shellPort('jcosta33/sourdaw', {
            capture: (_command, args) => {
                const joined = args.join(' ');
                if (joined.includes(ORDERED_RECEIPT_PROOF_QUERY_FRAGMENT)) {
                    if (joined.includes('cursor=cursor-2')) {
                        return shellDeliveryReceiptProofResponse(['IC_b'], {
                            totalCount: 3,
                        });
                    }
                    if (joined.includes('cursor=cursor-1')) {
                        return shellDeliveryReceiptProofResponse(['IC_a'], {
                            totalCount: 3,
                            hasNextPage: true,
                            endCursor: 'cursor-2',
                        });
                    }
                    return shellDeliveryReceiptProofResponse(['IC_a'], {
                        totalCount: 3,
                        hasNextPage: true,
                        endCursor: 'cursor-1',
                    });
                }
                throw new Error(`unexpected capture: ${joined}`);
            },
            run: () => undefined,
        });

        expect(() => port.deliveryReceiptProof(42)).toThrow(/cannot inspect delivery receipts for PR #42/i);
    });

    it('fails merged shellPort recovery without a persisted authority anchor even when GraphQL proves the same-timestamp author receipt stayed unedited', () => {
        const closes = relationshipBody('Closes #2372');
        const effects: string[] = [];
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const port = shellPort(
            'jcosta33/sourdaw',
            {
                capture: (_command, args) => {
                    const joined = args.join(' ');
                    if (joined.includes('pr view')) {
                        return JSON.stringify(
                            shellPullRequest(pullRequest({ state: 'MERGED', body: relationshipBody('None.') }))
                        );
                    }
                    if (joined.includes('mergedBy{__typename')) {
                        return shellMergedByGraphql({ __typename: 'Bot', id: AUTHOR_BOT_NODE_ID });
                    }
                    if (joined.includes('issues/42/comments?per_page=100')) {
                        return JSON.stringify([
                            [
                                {
                                    node_id: 'IC_same_timestamp',
                                    body: deliveryReceiptBody(42, 'head', closes, 2372),
                                    user: { node_id: AUTHOR_BOT_NODE_ID, login: 'renamed-author[bot]', type: 'Bot' },
                                    created_at: '2026-08-21T00:00:00Z',
                                    updated_at: '2026-08-21T00:00:00Z',
                                },
                            ],
                        ]);
                    }
                    if (joined.includes(ORDERED_RECEIPT_PROOF_QUERY_FRAGMENT)) {
                        return shellDeliveryReceiptProofResponse(['IC_same_timestamp']);
                    }
                    if (joined.includes('pulls?state=open')) {
                        return JSON.stringify([[]]);
                    }
                    throw new Error(`unexpected capture: ${joined}`);
                },
                run: () => undefined,
            },
            { primaryRoot }
        );

        try {
            expect(() =>
                deliverPullRequest(42, port, {
                    complete: (issue) => effects.push(`complete:${issue}`),
                })
            ).toThrow(/delivery receipt authority cannot be proven|delivery receipt changed during recovery/i);
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }

        expect(effects).toEqual([]);
    });

    it('fails merged shellPort recovery when GraphQL marks a same-timestamp author receipt as edited', () => {
        const closes = relationshipBody('Closes #2372');
        const effects: string[] = [];
        const captures: string[] = [];
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const authorityOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
            cwd: primaryRoot,
            encoding: 'utf8',
            input: JSON.stringify({ version: 1, receiptId: 'IC_same_timestamp' }),
        }).trim();
        execFileSync('git', ['update-ref', 'refs/sourdaw/delivery-receipt/pr-42', authorityOid], {
            cwd: primaryRoot,
        });
        const port = shellPort(
            'jcosta33/sourdaw',
            {
                capture: (_command, args) => {
                    const joined = args.join(' ');
                    captures.push(joined);
                    if (joined.includes('pr view')) {
                        return JSON.stringify(shellPullRequest(pullRequest({ state: 'MERGED', body: closes })));
                    }
                    if (joined.includes('mergedBy{__typename')) {
                        return shellMergedByGraphql({ __typename: 'Bot', id: AUTHOR_BOT_NODE_ID });
                    }
                    if (joined.includes('issues/42/comments?per_page=100')) {
                        return JSON.stringify([
                            [
                                {
                                    node_id: 'IC_same_timestamp',
                                    body: deliveryReceiptBody(42, 'head', closes, 2372),
                                    user: { node_id: AUTHOR_BOT_NODE_ID, login: 'renamed-author[bot]', type: 'Bot' },
                                    created_at: '2026-08-21T00:00:00Z',
                                    updated_at: '2026-08-21T00:00:00Z',
                                },
                            ],
                        ]);
                    }
                    if (joined.includes(ORDERED_RECEIPT_PROOF_QUERY_FRAGMENT)) {
                        return shellDeliveryReceiptProofResponse(['IC_same_timestamp'], {
                            editedCommentIds: ['IC_same_timestamp'],
                        });
                    }
                    if (joined.includes('pulls?state=open')) {
                        return JSON.stringify([[]]);
                    }
                    throw new Error(`unexpected capture: ${joined}`);
                },
                run: () => undefined,
            },
            { primaryRoot }
        );

        try {
            expect(() =>
                deliverPullRequest(42, port, {
                    complete: (issue) => effects.push(`complete:${issue}`),
                })
            ).toThrow(/delivery receipt authority cannot be proven/i);
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }
        expect(captures).toEqual([
            expect.stringContaining('pr view 42'),
            expect.stringContaining('mergedBy{__typename'),
            'api --paginate --slurp repos/jcosta33/sourdaw/issues/42/comments?per_page=100',
            expect.stringContaining(ORDERED_RECEIPT_PROOF_QUERY_FRAGMENT),
        ]);
        expect(effects).toEqual([]);
    });

    it.each([
        {
            merger: 'foreign',
            shellSnapshot: pullRequest({ state: 'MERGED', mergedByActorNodeId: REVIEWER_BOT_NODE_ID }),
            graphQlMergedBy: { __typename: 'Bot' as const, id: REVIEWER_BOT_NODE_ID },
            expectedError: /not merged by the author App/,
        },
        {
            merger: 'null',
            shellSnapshot: pullRequest({ state: 'MERGED', mergedByActorNodeId: null }),
            graphQlMergedBy: null,
            expectedError: /merger cannot be verified/,
        },
        {
            merger: 'non-Bot',
            shellSnapshot: pullRequest({ state: 'MERGED' }),
            graphQlMergedBy: { __typename: 'User' as const },
            expectedError: /merger cannot be verified/,
        },
    ])(
        'shellPort refuses $merger merged-by authority before any recovery effect',
        ({ shellSnapshot, graphQlMergedBy, expectedError }) => {
            const effects: string[] = [];
            const port = shellPort('jcosta33/sourdaw', {
                capture: (_command, args) => {
                    const joined = args.join(' ');
                    if (joined.includes('pr view')) {
                        return JSON.stringify(shellPullRequest(shellSnapshot));
                    }
                    if (joined.includes('mergedBy{__typename')) {
                        return shellMergedByGraphql(graphQlMergedBy);
                    }
                    effects.push(`capture:${joined}`);
                    throw new Error(`unexpected recovery read: ${joined}`);
                },
                run: (command, args) => {
                    if (command === 'git' && args[0] === 'fetch') {
                        return;
                    }
                    effects.push(`run:${command}:${args.join(' ')}`);
                },
            });

            expect(() =>
                deliverPullRequest(42, port, {
                    complete: (issue) => effects.push(`complete:${issue}`),
                })
            ).toThrow(expectedError);
            expect(effects).toEqual([]);
        }
    );

    it('fails closed for shellPort merged recovery when current visible v2 authority lacks retained validation, even if REST order would choose Y', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const effects: string[] = [];
        const captures: string[] = [];
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const authorityOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
            cwd: primaryRoot,
            encoding: 'utf8',
            input: JSON.stringify({
                version: 2,
                phase: 'terminal',
                receiptId: 'IC_y',
                receiptBody: deliveryReceiptBody(42, 'head', bodyY, 2373),
            }),
        }).trim();
        execFileSync('git', ['update-ref', 'refs/sourdaw/delivery-receipt/pr-42', authorityOid], {
            cwd: primaryRoot,
        });
        const comment = (id: string, receiptBody: string, createdAt: string) => ({
            node_id: id,
            body: receiptBody,
            user: { node_id: AUTHOR_BOT_NODE_ID, login: 'renamed-author[bot]', type: 'Bot' },
            created_at: createdAt,
            updated_at: createdAt,
        });
        const port = shellPort(
            'jcosta33/sourdaw',
            {
                capture: (_command, args) => {
                    const joined = args.join(' ');
                    captures.push(joined);
                    if (joined.includes('pr view')) {
                        return JSON.stringify(shellPullRequest(pullRequest({ state: 'MERGED' })));
                    }
                    if (joined.includes('mergedBy{__typename')) {
                        return shellMergedByGraphql({ __typename: 'Bot', id: AUTHOR_BOT_NODE_ID });
                    }
                    if (joined.includes('issues/42/comments?per_page=100')) {
                        return JSON.stringify([
                            [comment('IC_x', deliveryReceiptBody(42, 'head', bodyX, 2372), '2026-08-21T00:00:02Z')],
                            [comment('IC_y', deliveryReceiptBody(42, 'head', bodyY, 2373), '2026-08-21T00:00:01Z')],
                        ]);
                    }
                    if (joined.includes(ORDERED_RECEIPT_PROOF_QUERY_FRAGMENT)) {
                        return shellDeliveryReceiptProofResponse(['IC_x', 'IC_y']);
                    }
                    if (joined.includes('pulls?state=open')) {
                        return JSON.stringify([[]]);
                    }
                    throw new Error(`unexpected capture: ${joined}`);
                },
                run: () => undefined,
            },
            { primaryRoot }
        );

        try {
            expect(() =>
                deliverPullRequest(42, port, {
                    complete: (issue) => effects.push(`complete:${issue}`),
                })
            ).toThrow(/delivery receipt authority cannot be proven/i);
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }

        expect(captures[0]).toContain('pr view 42');
        expect(captures[1]).toContain('mergedBy{__typename');
        expect(effects).toEqual([]);
    });

    it('ignores legacy v1 persisted authority until shellPort proves the complete stable merged lineage', () => {
        const closes = relationshipBody('Closes #2372');
        const effects: string[] = [];
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const authorityOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
            cwd: primaryRoot,
            encoding: 'utf8',
            input: JSON.stringify({ version: 1, receiptId: 'IC_legacy_v1' }),
        }).trim();
        execFileSync('git', ['update-ref', 'refs/sourdaw/delivery-receipt/pr-42', authorityOid], { cwd: primaryRoot });
        const port = shellPort(
            'jcosta33/sourdaw',
            {
                capture: (_command, args) => {
                    const joined = args.join(' ');
                    if (joined.includes('pr view 42')) {
                        return JSON.stringify(shellPullRequest(pullRequest({ state: 'MERGED', body: closes })));
                    }
                    if (joined.includes('mergedBy{__typename')) {
                        return shellMergedByGraphql({ __typename: 'Bot', id: AUTHOR_BOT_NODE_ID });
                    }
                    if (joined.includes('issues/42/comments?per_page=100')) {
                        return JSON.stringify([
                            [
                                {
                                    node_id: 'IC_legacy_v1',
                                    body: deliveryReceiptBody(42, 'head', closes, 2372),
                                    user: { node_id: AUTHOR_BOT_NODE_ID, login: 'renamed-author[bot]', type: 'Bot' },
                                    created_at: '2026-08-21T00:00:00Z',
                                    updated_at: '2026-08-21T00:00:00Z',
                                },
                            ],
                        ]);
                    }
                    if (joined.includes(ORDERED_RECEIPT_PROOF_QUERY_FRAGMENT)) {
                        return shellDeliveryReceiptProofResponse(['IC_legacy_v1']);
                    }
                    if (joined.includes('pulls?state=open')) {
                        return JSON.stringify([[]]);
                    }
                    throw new Error(`unexpected capture: ${joined}`);
                },
                run: () => undefined,
            },
            { primaryRoot }
        );

        try {
            deliverPullRequest(42, port, {
                complete: (issue) => effects.push(`complete:${issue}`),
            });
            const freshPort = shellPort(
                'jcosta33/sourdaw',
                { capture: () => expect.fail('unexpected read'), run: () => undefined },
                { primaryRoot }
            );
            expect(freshPort.readDeliveryReceiptAuthority(42)).toEqual({
                phase: 'terminal',
                receiptId: 'IC_legacy_v1',
                receiptBody: deliveryReceiptBody(42, 'head', closes, 2372),
                postMergeValidation: persistedPostMergeValidation('head', closes, 2372),
            });
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }

        expect(effects).toEqual(['complete:2372']);
    });

    it('round-trips prepared shellPort authority with a skipped advisory receiptBody and post-merge validation across fresh instances', () => {
        const closes = relationshipBody('Closes #2372');
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const firstPort = shellPort(
            'jcosta33/sourdaw',
            { capture: () => expect.fail('unexpected capture'), run: () => undefined },
            { primaryRoot }
        );
        const secondPort = shellPort(
            'jcosta33/sourdaw',
            { capture: () => expect.fail('unexpected capture'), run: () => undefined },
            { primaryRoot }
        );
        const authority: PersistedDeliveryReceiptAuthority = {
            phase: 'prepared',
            receiptId: 'IC_delivery_42_1',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'skipped'),
            postMergeValidation: {
                headRefOid: 'head',
                headRefName: 'feat/gate',
                baseRefName: 'main',
                bodySha256: createHash('sha256').update(closes).digest('hex'),
                trackerTarget: 2372,
            },
        };

        try {
            firstPort.writeDeliveryReceiptAuthority(42, authority);
            expect(secondPort.readDeliveryReceiptAuthority(42)).toEqual(authority);
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }
    });

    it('fails shellPort authority CAS when the ref changes before the expected-old update', () => {
        const closes = relationshipBody('Closes #2372');
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        const wrapperRoot = mkdtempSync(join(tmpdir(), 'sourdaw-git-wrapper-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const currentAuthority: PersistedDeliveryReceiptAuthority = {
            phase: 'prepared',
            receiptId: 'IC_current',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: {
                headRefOid: 'head',
                headRefName: 'feat/gate',
                baseRefName: 'main',
                bodySha256: createHash('sha256').update(closes).digest('hex'),
                trackerTarget: 2372,
            },
        };
        const nextAuthority: PersistedDeliveryReceiptAuthority = {
            phase: 'released',
            receiptId: 'IC_current',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
        };
        const hostileAuthority: PersistedDeliveryReceiptAuthority = {
            phase: 'terminal',
            receiptId: 'IC_hostile',
            receiptBody: visibleDeliveryReceiptBody(42, 'hostile-head', closes, 2372, 'successful'),
        };
        const currentOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
            cwd: primaryRoot,
            encoding: 'utf8',
            input: JSON.stringify({ version: 2, ...currentAuthority }),
        }).trim();
        execFileSync('git', ['update-ref', 'refs/sourdaw/delivery-receipt/pr-42', currentOid], { cwd: primaryRoot });
        const hostileOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
            cwd: primaryRoot,
            encoding: 'utf8',
            input: JSON.stringify({ version: 2, ...hostileAuthority }),
        }).trim();
        const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        const wrapperPath = join(wrapperRoot, 'git');
        writeFileSync(
            wrapperPath,
            [
                '#!/usr/bin/env bash',
                'set -euo pipefail',
                `real_git=${JSON.stringify(realGit)}`,
                `ref=${JSON.stringify('refs/sourdaw/delivery-receipt/pr-42')}`,
                `replacement=${JSON.stringify(hostileOid)}`,
                `marker=${JSON.stringify(join(wrapperRoot, 'stale-old-swapped'))}`,
                'if [[ "${1:-}" == "update-ref" && "${2:-}" == "--no-deref" && "${3:-}" == "$ref" && ! -e "$marker" ]]; then',
                '  : > "$marker"',
                '  "$real_git" update-ref "$ref" "$replacement"',
                'fi',
                'exec "$real_git" "$@"',
            ].join('\n')
        );
        chmodSync(wrapperPath, 0o755);
        const previousPath = process.env.PATH;
        process.env.PATH = `${wrapperRoot}:${previousPath ?? ''}`;

        try {
            const port = shellPort(
                'jcosta33/sourdaw',
                { capture: () => expect.fail('unexpected capture'), run: () => undefined },
                { primaryRoot }
            );

            expect(() =>
                port.writeDeliveryReceiptAuthority(42, nextAuthority, {
                    mode: 'present',
                    authority: currentAuthority,
                })
            ).toThrow(/delivery receipt authority could not be stored/i);
            expect(port.readDeliveryReceiptAuthority(42)).toEqual(hostileAuthority);
        } finally {
            process.env.PATH = previousPath;
            rmSync(primaryRoot, { recursive: true, force: true });
            rmSync(wrapperRoot, { recursive: true, force: true });
        }
    });

    it('fails shellPort adapter writes when expectedCurrent mismatches the newer stored authority', () => {
        const closes = relationshipBody('Closes #2372');
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const storedAuthority: PersistedDeliveryReceiptAuthority = {
            phase: 'prepared',
            receiptId: 'IC_current',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: {
                headRefOid: 'head',
                headRefName: 'feat/gate',
                baseRefName: 'main',
                bodySha256: createHash('sha256').update(closes).digest('hex'),
                trackerTarget: 2372,
            },
        };
        const staleExpectedAuthority: PersistedDeliveryReceiptAuthority = {
            phase: 'prepared',
            receiptId: 'IC_stale',
            receiptBody: visibleDeliveryReceiptBody(42, 'older-head', closes, 2372, 'successful'),
            postMergeValidation: {
                headRefOid: 'older-head',
                headRefName: 'feat/older',
                baseRefName: 'main',
                bodySha256: createHash('sha256').update(closes).digest('hex'),
                trackerTarget: 2372,
            },
        };
        const nextAuthority: PersistedDeliveryReceiptAuthority = {
            phase: 'released',
            receiptId: 'IC_current',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
        };
        const firstPort = shellPort(
            'jcosta33/sourdaw',
            { capture: () => expect.fail('unexpected capture'), run: () => undefined },
            { primaryRoot }
        );
        const secondPort = shellPort(
            'jcosta33/sourdaw',
            { capture: () => expect.fail('unexpected capture'), run: () => undefined },
            { primaryRoot }
        );

        try {
            firstPort.writeDeliveryReceiptAuthority(42, storedAuthority);

            expect(() =>
                secondPort.writeDeliveryReceiptAuthority(42, nextAuthority, {
                    mode: 'present',
                    authority: staleExpectedAuthority,
                })
            ).toThrow(/delivery receipt authority could not be stored/i);
            expect(secondPort.readDeliveryReceiptAuthority(42)).toEqual(storedAuthority);
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }
    });

    it('fails shellPort adapter writes when expected authority must still be absent and a newer authority already exists', () => {
        const closes = relationshipBody('Closes #2372');
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const storedAuthority: PersistedDeliveryReceiptAuthority = {
            phase: 'prepared',
            receiptId: 'IC_current',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: {
                headRefOid: 'head',
                headRefName: 'feat/gate',
                baseRefName: 'main',
                bodySha256: createHash('sha256').update(closes).digest('hex'),
                trackerTarget: 2372,
            },
        };
        const nextAuthority: PersistedDeliveryReceiptAuthority = {
            phase: 'released',
            receiptId: 'IC_current',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
        };
        const firstPort = shellPort(
            'jcosta33/sourdaw',
            { capture: () => expect.fail('unexpected capture'), run: () => undefined },
            { primaryRoot }
        );
        const secondPort = shellPort(
            'jcosta33/sourdaw',
            { capture: () => expect.fail('unexpected capture'), run: () => undefined },
            { primaryRoot }
        );

        try {
            firstPort.writeDeliveryReceiptAuthority(42, storedAuthority);

            expect(() =>
                secondPort.writeDeliveryReceiptAuthority(42, nextAuthority, expectedAbsentDeliveryReceiptAuthority())
            ).toThrow(/delivery receipt authority could not be stored/i);
            expect(secondPort.readDeliveryReceiptAuthority(42)).toEqual(storedAuthority);
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }
    });

    it('fails shellPort adapter clears when expectedCurrent mismatches the newer stored authority', () => {
        const closes = relationshipBody('Closes #2372');
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const storedAuthority: PersistedDeliveryReceiptAuthority = {
            phase: 'prepared',
            receiptId: 'IC_current',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: {
                headRefOid: 'head',
                headRefName: 'feat/gate',
                baseRefName: 'main',
                bodySha256: createHash('sha256').update(closes).digest('hex'),
                trackerTarget: 2372,
            },
        };
        const staleExpectedAuthority: PersistedDeliveryReceiptAuthority = {
            phase: 'prepared',
            receiptId: 'IC_stale',
            receiptBody: visibleDeliveryReceiptBody(42, 'older-head', closes, 2372, 'successful'),
            postMergeValidation: {
                headRefOid: 'older-head',
                headRefName: 'feat/older',
                baseRefName: 'main',
                bodySha256: createHash('sha256').update(closes).digest('hex'),
                trackerTarget: 2372,
            },
        };
        const firstPort = shellPort(
            'jcosta33/sourdaw',
            { capture: () => expect.fail('unexpected capture'), run: () => undefined },
            { primaryRoot }
        );
        const secondPort = shellPort(
            'jcosta33/sourdaw',
            { capture: () => expect.fail('unexpected capture'), run: () => undefined },
            { primaryRoot }
        );

        try {
            firstPort.writeDeliveryReceiptAuthority(42, storedAuthority);

            expect(() =>
                secondPort.clearDeliveryReceiptAuthority(42, {
                    mode: 'present',
                    authority: staleExpectedAuthority,
                })
            ).toThrow(/delivery receipt authority could not be cleared/i);
            expect(secondPort.readDeliveryReceiptAuthority(42)).toEqual(storedAuthority);
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }
    });

    it('fails shellPort clear when a hostile authority is recreated after the delete succeeds but before readback', () => {
        const closes = relationshipBody('Closes #2372');
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        const wrapperRoot = mkdtempSync(join(tmpdir(), 'sourdaw-git-wrapper-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const storedAuthority: PersistedDeliveryReceiptAuthority = {
            phase: 'prepared',
            receiptId: 'IC_current',
            receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
            postMergeValidation: {
                headRefOid: 'head',
                headRefName: 'feat/gate',
                baseRefName: 'main',
                bodySha256: createHash('sha256').update(closes).digest('hex'),
                trackerTarget: 2372,
            },
        };
        const hostileAuthority = {
            phase: 'terminal',
            receiptId: 'IC_hostile',
            receiptBody: visibleDeliveryReceiptBody(42, 'hostile-head', closes, 2372, 'successful'),
        } satisfies PersistedDeliveryReceiptAuthority;
        const storedOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
            cwd: primaryRoot,
            encoding: 'utf8',
            input: JSON.stringify({ version: 2, ...storedAuthority }),
        }).trim();
        execFileSync('git', ['update-ref', 'refs/sourdaw/delivery-receipt/pr-42', storedOid], { cwd: primaryRoot });
        const hostileOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
            cwd: primaryRoot,
            encoding: 'utf8',
            input: JSON.stringify({ version: 2, ...hostileAuthority }),
        }).trim();
        const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        const wrapperPath = join(wrapperRoot, 'git');
        writeFileSync(
            wrapperPath,
            [
                '#!/usr/bin/env bash',
                'set -euo pipefail',
                `real_git=${JSON.stringify(realGit)}`,
                `ref=${JSON.stringify('refs/sourdaw/delivery-receipt/pr-42')}`,
                `replacement=${JSON.stringify(hostileOid)}`,
                `marker=${JSON.stringify(join(wrapperRoot, 'post-delete-recreated'))}`,
                'if [[ "${1:-}" == "update-ref" && "${2:-}" == "--no-deref" && "${3:-}" == "-d" && "${4:-}" == "$ref" && ! -e "$marker" ]]; then',
                '  "$real_git" "$@"',
                '  status=$?',
                '  if [[ "$status" -eq 0 ]]; then',
                '    : > "$marker"',
                '    "$real_git" update-ref "$ref" "$replacement"',
                '  fi',
                '  exit "$status"',
                'fi',
                'exec "$real_git" "$@"',
            ].join('\n')
        );
        chmodSync(wrapperPath, 0o755);
        const previousPath = process.env.PATH;
        process.env.PATH = `${wrapperRoot}:${previousPath ?? ''}`;

        try {
            const port = shellPort(
                'jcosta33/sourdaw',
                { capture: () => expect.fail('unexpected capture'), run: () => undefined },
                { primaryRoot }
            );

            expect(() =>
                port.clearDeliveryReceiptAuthority(42, { mode: 'present', authority: storedAuthority })
            ).toThrow(/delivery receipt authority could not be verified/i);
            expect(port.readDeliveryReceiptAuthority(42)).toEqual(hostileAuthority);
        } finally {
            process.env.PATH = previousPath;
            rmSync(primaryRoot, { recursive: true, force: true });
            rmSync(wrapperRoot, { recursive: true, force: true });
        }
    });

    it('fails before merge when a shellPort authority ref changes immediately after the prepared-authority CAS succeeds', () => {
        const closes = relationshipBody('Closes #2372');
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        const wrapperRoot = mkdtempSync(join(tmpdir(), 'sourdaw-git-wrapper-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const hostileAuthority = {
            phase: 'terminal',
            receiptId: 'IC_hostile',
            receiptBody: visibleDeliveryReceiptBody(42, 'hostile-head', closes, 2372, 'successful'),
        } satisfies PersistedDeliveryReceiptAuthority;
        const hostileOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
            cwd: primaryRoot,
            encoding: 'utf8',
            input: JSON.stringify({ version: 2, ...hostileAuthority }),
        }).trim();
        const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        const wrapperPath = join(wrapperRoot, 'git');
        writeFileSync(
            wrapperPath,
            [
                '#!/usr/bin/env bash',
                'set -euo pipefail',
                `real_git=${JSON.stringify(realGit)}`,
                `ref=${JSON.stringify('refs/sourdaw/delivery-receipt/pr-42')}`,
                `zero=${JSON.stringify('0'.repeat(40))}`,
                `replacement=${JSON.stringify(hostileOid)}`,
                `marker=${JSON.stringify(join(wrapperRoot, 'post-cas-swapped'))}`,
                'if [[ "${1:-}" == "update-ref" && "${2:-}" == "--no-deref" && "${3:-}" == "$ref" && "${5:-}" == "$zero" && ! -e "$marker" ]]; then',
                '  "$real_git" "$@"',
                '  status=$?',
                '  if [[ "$status" -eq 0 ]]; then',
                '    : > "$marker"',
                '    "$real_git" update-ref "$ref" "$replacement"',
                '  fi',
                '  exit "$status"',
                'fi',
                'exec "$real_git" "$@"',
            ].join('\n')
        );
        chmodSync(wrapperPath, 0o755);
        const previousPath = process.env.PATH;
        process.env.PATH = `${wrapperRoot}:${previousPath ?? ''}`;
        const captures: string[] = [];
        const receipts: DeliveryReceiptComment[] = [];

        try {
            const port = shellPort(
                'jcosta33/sourdaw',
                {
                    capture: (_command, args) => {
                        const joined = args.join(' ');
                        captures.push(joined);
                        if (joined.includes('pr view 42')) {
                            return JSON.stringify(shellPullRequest(pullRequest({ body: closes })));
                        }
                        if (joined.includes('query($owner:String!,$name:String!,$number:Int!){repository')) {
                            return JSON.stringify({
                                data: {
                                    repository: {
                                        pullRequest: {
                                            reviews: {
                                                nodes: [
                                                    {
                                                        state: 'APPROVED',
                                                        submittedAt: '2026-08-21T00:00:00Z',
                                                        author: {
                                                            id: REVIEWER_BOT_NODE_ID,
                                                            login: 'renamed-reviewer[bot]',
                                                            __typename: 'Bot',
                                                        },
                                                        commit: { oid: 'head' },
                                                    },
                                                ],
                                                pageInfo: { hasPreviousPage: false },
                                            },
                                            reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } },
                                        },
                                    },
                                },
                            });
                        }
                        if (joined.includes('pulls?state=open')) {
                            return JSON.stringify([[]]);
                        }
                        if (joined === 'api repos/jcosta33/sourdaw --jq .delete_branch_on_merge') {
                            return 'false';
                        }
                        if (joined.includes('issues/42/comments?per_page=100')) {
                            return JSON.stringify([
                                receipts.map((receipt) => ({
                                    node_id: receipt.id,
                                    body: receipt.body,
                                    user: {
                                        node_id: receipt.authorNodeId,
                                        login: receipt.authorLogin,
                                        type: receipt.authorType,
                                    },
                                    created_at: receipt.createdAt,
                                    updated_at: receipt.updatedAt,
                                })),
                            ]);
                        }
                        if (joined.includes(ORDERED_RECEIPT_PROOF_QUERY_FRAGMENT)) {
                            return shellDeliveryReceiptProofResponse(receipts.map((receipt) => receipt.id));
                        }
                        if (joined.includes('POST repos/jcosta33/sourdaw/issues/42/comments')) {
                            const body =
                                args.find((argument) => argument.startsWith('body='))?.slice('body='.length) ?? '';
                            const receipt = {
                                id: 'IC_delivery_42_1',
                                body,
                                authorNodeId: AUTHOR_BOT_NODE_ID,
                                authorLogin: 'renamed-author[bot]',
                                authorType: 'Bot',
                                createdAt: '2026-08-21T00:00:00Z',
                                updatedAt: '2026-08-21T00:00:00Z',
                            };
                            receipts.push(receipt);
                            return JSON.stringify({
                                node_id: receipt.id,
                                body: receipt.body,
                                user: {
                                    node_id: receipt.authorNodeId,
                                    login: receipt.authorLogin,
                                    type: receipt.authorType,
                                },
                                created_at: receipt.createdAt,
                                updated_at: receipt.updatedAt,
                            });
                        }
                        if (joined === 'api repos/jcosta33/sourdaw') {
                            return mergeSettings({
                                allow_merge_commit: false,
                                allow_rebase_merge: false,
                                allow_squash_merge: true,
                                delete_branch_on_merge: false,
                            });
                        }
                        if (joined.includes('/merge')) {
                            captures.push('merge-attempted');
                            return JSON.stringify({ merged: true, message: 'merged' });
                        }
                        throw new Error(`unexpected capture: ${joined}`);
                    },
                    run: () => undefined,
                },
                { primaryRoot }
            );

            expect(() => deliverPullRequest(42, port)).toThrow(/delivery receipt authority could not be verified/i);
            expect(captures).not.toContain('merge-attempted');
        } finally {
            process.env.PATH = previousPath;
            rmSync(primaryRoot, { recursive: true, force: true });
            rmSync(wrapperRoot, { recursive: true, force: true });
        }
    });

    it.each([
        {
            label: 'empty headRefOid',
            postMergeValidation: {
                headRefOid: '',
                headRefName: 'feat/gate',
                baseRefName: 'main',
                bodySha256: 'a'.repeat(64),
                trackerTarget: 2372,
            },
        },
        {
            label: 'invalid bodySha256',
            postMergeValidation: {
                headRefOid: 'head',
                headRefName: 'feat/gate',
                baseRefName: 'main',
                bodySha256: 'not-a-digest',
                trackerTarget: 2372,
            },
        },
        {
            label: 'nonsafe trackerTarget',
            postMergeValidation: {
                headRefOid: 'head',
                headRefName: 'feat/gate',
                baseRefName: 'main',
                bodySha256: 'a'.repeat(64),
                trackerTarget: 0,
            },
        },
        {
            label: 'extra nested key',
            postMergeValidation: {
                headRefOid: 'head',
                headRefName: 'feat/gate',
                baseRefName: 'main',
                bodySha256: 'a'.repeat(64),
                trackerTarget: 2372,
                unexpected: true,
            },
        },
    ])(
        'rejects a raw v2 authority ref with malformed nested postMergeValidation: $label',
        ({ postMergeValidation }) => {
            const closes = relationshipBody('Closes #2372');
            const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
            execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
            const authorityOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
                cwd: primaryRoot,
                encoding: 'utf8',
                input: JSON.stringify({
                    version: 2,
                    phase: 'prepared',
                    receiptId: 'IC_malformed_nested',
                    receiptBody: visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'),
                    postMergeValidation,
                }),
            }).trim();
            execFileSync('git', ['update-ref', 'refs/sourdaw/delivery-receipt/pr-42', authorityOid], {
                cwd: primaryRoot,
            });
            const port = shellPort(
                'jcosta33/sourdaw',
                { capture: () => expect.fail('unexpected capture'), run: () => undefined },
                { primaryRoot }
            );

            try {
                expect(() => port.readDeliveryReceiptAuthority(42)).toThrow(/delivery receipt authority is malformed/i);
            } finally {
                rmSync(primaryRoot, { recursive: true, force: true });
            }
        }
    );

    it('rejects a raw v2 authority ref with duplicate top-level receiptId members before JSON.parse collapses them', () => {
        const closes = relationshipBody('Closes #2372');
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const authorityOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
            cwd: primaryRoot,
            encoding: 'utf8',
            input: `{"version":2,"phase":"prepared","receiptId":"IC_first","receiptId":"IC_second","receiptBody":${JSON.stringify(visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'))},"postMergeValidation":{"headRefOid":"head","headRefName":"feat/gate","baseRefName":"main","bodySha256":"${createHash('sha256').update(closes).digest('hex')}","trackerTarget":2372}}`,
        }).trim();
        execFileSync('git', ['update-ref', 'refs/sourdaw/delivery-receipt/pr-42', authorityOid], {
            cwd: primaryRoot,
        });
        const port = shellPort(
            'jcosta33/sourdaw',
            { capture: () => expect.fail('unexpected capture'), run: () => undefined },
            { primaryRoot }
        );

        try {
            expect(() => port.readDeliveryReceiptAuthority(42)).toThrow(
                /duplicate key|delivery receipt authority is malformed/i
            );
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }
    });

    it('rejects a raw v2 authority ref with duplicate nested postMergeValidation members before JSON.parse collapses them', () => {
        const closes = relationshipBody('Closes #2372');
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const authorityOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
            cwd: primaryRoot,
            encoding: 'utf8',
            input: `{"version":2,"phase":"prepared","receiptId":"IC_nested_duplicate","receiptBody":${JSON.stringify(visibleDeliveryReceiptBody(42, 'head', closes, 2372, 'successful'))},"postMergeValidation":{"headRefOid":"head","headRefOid":"rewritten-head","headRefName":"feat/gate","baseRefName":"main","bodySha256":"${createHash('sha256').update(closes).digest('hex')}","trackerTarget":2372}}`,
        }).trim();
        execFileSync('git', ['update-ref', 'refs/sourdaw/delivery-receipt/pr-42', authorityOid], {
            cwd: primaryRoot,
        });
        const port = shellPort(
            'jcosta33/sourdaw',
            { capture: () => expect.fail('unexpected capture'), run: () => undefined },
            { primaryRoot }
        );

        try {
            expect(() => port.readDeliveryReceiptAuthority(42)).toThrow(
                /duplicate key|delivery receipt authority is malformed/i
            );
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }
    });

    it('rejects an exact symlink delivery receipt authority ref path', () => {
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const ref = 'refs/sourdaw/delivery-receipt/pr-42';
        const refPath = execFileSync('git', ['rev-parse', '--git-path', ref], {
            cwd: primaryRoot,
            encoding: 'utf8',
        }).trim();
        const exactRefPath = join(primaryRoot, refPath);
        const targetPath = join(primaryRoot, 'symlink-target');
        mkdirSync(dirname(exactRefPath), { recursive: true });
        const authorityOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
            cwd: primaryRoot,
            encoding: 'utf8',
            input: JSON.stringify({
                version: 2,
                phase: 'terminal',
                receiptId: 'IC_symlink',
                receiptBody: deliveryReceiptBody(42, 'head', relationshipBody('Closes #2372'), 2372),
            }),
        }).trim();
        writeFileSync(targetPath, `${authorityOid}\n`);
        symlinkSync(targetPath, exactRefPath);
        const port = shellPort(
            'jcosta33/sourdaw',
            { capture: () => expect.fail('unexpected capture'), run: () => undefined },
            { primaryRoot }
        );

        try {
            expect(() => port.readDeliveryReceiptAuthority(42)).toThrow(
                /delivery receipt authority cannot be proven|delivery receipt authority cannot be verified/i
            );
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }
    });

    it('rejects a delivery receipt authority ref that becomes symbolic after the path check but before the bound git read', () => {
        const closes = relationshipBody('Closes #2372');
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        const wrapperRoot = mkdtempSync(join(tmpdir(), 'sourdaw-git-wrapper-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const ref = 'refs/sourdaw/delivery-receipt/pr-42';
        const hostileTarget = 'refs/sourdaw/hostile-authority';
        const legitimateAuthority = {
            phase: 'terminal',
            receiptId: 'IC_legitimate',
            receiptBody: deliveryReceiptBody(42, 'head', closes, 2372),
        } satisfies PersistedDeliveryReceiptAuthority;
        const hostileAuthority = {
            phase: 'terminal',
            receiptId: 'IC_hostile',
            receiptBody: deliveryReceiptBody(42, 'hostile-head', closes, 2372),
        } satisfies PersistedDeliveryReceiptAuthority;
        const legitimateOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
            cwd: primaryRoot,
            encoding: 'utf8',
            input: JSON.stringify({ version: 2, ...legitimateAuthority }),
        }).trim();
        const hostileOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
            cwd: primaryRoot,
            encoding: 'utf8',
            input: JSON.stringify({ version: 2, ...hostileAuthority }),
        }).trim();
        execFileSync('git', ['update-ref', ref, legitimateOid], { cwd: primaryRoot });
        execFileSync('git', ['update-ref', hostileTarget, hostileOid], { cwd: primaryRoot });
        const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
        const wrapperPath = join(wrapperRoot, 'git');
        writeFileSync(
            wrapperPath,
            [
                '#!/usr/bin/env bash',
                'set -euo pipefail',
                `real_git=${JSON.stringify(realGit)}`,
                `ref=${JSON.stringify(ref)}`,
                `target=${JSON.stringify(hostileTarget)}`,
                `marker=${JSON.stringify(join(wrapperRoot, 'authority-became-symbolic'))}`,
                'if [[ ! -e "$marker" ]]; then',
                '  if [[ "${1:-}" == "show-ref" && "${2:-}" == "--verify" && "${3:-}" == "--hash" && "${4:-}" == "--" && "${5:-}" == "$ref" ]]; then',
                '    : > "$marker"',
                '    "$real_git" symbolic-ref "$ref" "$target"',
                '  elif [[ "${1:-}" == "for-each-ref" && "${@: -1}" == "$ref" ]]; then',
                '    : > "$marker"',
                '    "$real_git" symbolic-ref "$ref" "$target"',
                '  fi',
                'fi',
                'exec "$real_git" "$@"',
            ].join('\n')
        );
        chmodSync(wrapperPath, 0o755);
        const previousPath = process.env.PATH;
        process.env.PATH = `${wrapperRoot}:${previousPath ?? ''}`;

        try {
            const port = shellPort(
                'jcosta33/sourdaw',
                { capture: () => expect.fail('unexpected capture'), run: () => undefined },
                { primaryRoot }
            );

            expect(() => port.readDeliveryReceiptAuthority(42)).toThrow(
                /delivery receipt authority cannot be proven|delivery receipt authority cannot be verified/i
            );
        } finally {
            process.env.PATH = previousPath;
            rmSync(primaryRoot, { recursive: true, force: true });
            rmSync(wrapperRoot, { recursive: true, force: true });
        }
    });

    it('reads an exact packed delivery receipt authority ref when no loose ref path exists', () => {
        const closes = relationshipBody('Closes #2372');
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const authority = {
            phase: 'terminal',
            receiptId: 'IC_packed',
            receiptBody: deliveryReceiptBody(42, 'head', closes, 2372),
        } satisfies PersistedDeliveryReceiptAuthority;
        const authorityOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
            cwd: primaryRoot,
            encoding: 'utf8',
            input: JSON.stringify({ version: 2, ...authority }),
        }).trim();
        execFileSync('git', ['update-ref', 'refs/sourdaw/delivery-receipt/pr-42', authorityOid], {
            cwd: primaryRoot,
        });
        execFileSync('git', ['pack-refs', '--all', '--prune'], { cwd: primaryRoot });
        const port = shellPort(
            'jcosta33/sourdaw',
            { capture: () => expect.fail('unexpected capture'), run: () => undefined },
            { primaryRoot }
        );

        try {
            expect(port.readDeliveryReceiptAuthority(42)).toEqual(authority);
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }
    });

    it('never accepts a packed descendant delivery receipt authority ref when the exact ref does not exist', () => {
        const closes = relationshipBody('Closes #2372');
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const ref = 'refs/sourdaw/delivery-receipt/pr-42';
        const authority = {
            phase: 'terminal',
            receiptId: 'IC_packed_child',
            receiptBody: deliveryReceiptBody(42, 'head', closes, 2372),
        } satisfies PersistedDeliveryReceiptAuthority;
        const authorityOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
            cwd: primaryRoot,
            encoding: 'utf8',
            input: JSON.stringify({ version: 2, ...authority }),
        }).trim();
        execFileSync('git', [`update-ref`, `${ref}/child`, authorityOid], {
            cwd: primaryRoot,
        });
        execFileSync('git', ['pack-refs', '--all', '--prune'], { cwd: primaryRoot });
        const refPath = execFileSync('git', ['rev-parse', '--git-path', ref], {
            cwd: primaryRoot,
            encoding: 'utf8',
        }).trim();
        rmSync(join(primaryRoot, refPath), { recursive: true, force: true });
        const port = shellPort(
            'jcosta33/sourdaw',
            { capture: () => expect.fail('unexpected capture'), run: () => undefined },
            { primaryRoot }
        );

        try {
            try {
                expect(port.readDeliveryReceiptAuthority(42)).toBeUndefined();
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
                expect(String(error)).toMatch(
                    /delivery receipt authority cannot be proven|delivery receipt authority cannot be verified/i
                );
            }
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }
    });

    it('rejects an exact loose directory that conflicts with a packed delivery receipt authority ref', () => {
        const closes = relationshipBody('Closes #2372');
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const ref = 'refs/sourdaw/delivery-receipt/pr-42';
        const authorityOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
            cwd: primaryRoot,
            encoding: 'utf8',
            input: JSON.stringify({
                version: 2,
                phase: 'terminal',
                receiptId: 'IC_packed_conflict',
                receiptBody: deliveryReceiptBody(42, 'head', closes, 2372),
            }),
        }).trim();
        execFileSync('git', ['update-ref', ref, authorityOid], { cwd: primaryRoot });
        execFileSync('git', ['pack-refs', '--all', '--prune'], { cwd: primaryRoot });
        const refPath = execFileSync('git', ['rev-parse', '--git-path', ref], {
            cwd: primaryRoot,
            encoding: 'utf8',
        }).trim();
        mkdirSync(join(primaryRoot, refPath, 'child'), { recursive: true });
        const port = shellPort(
            'jcosta33/sourdaw',
            { capture: () => expect.fail('unexpected capture'), run: () => undefined },
            { primaryRoot }
        );

        try {
            expect(() => port.readDeliveryReceiptAuthority(42)).toThrow(
                /delivery receipt authority cannot be proven|delivery receipt authority cannot be verified/i
            );
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }
    });

    it.each([
        { label: 'loose', pack: false },
        { label: 'packed', pack: true },
    ])('rejects a $label annotated-tag delivery receipt authority ref', ({ pack }) => {
        const closes = relationshipBody('Closes #2372');
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const authorityOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
            cwd: primaryRoot,
            encoding: 'utf8',
            input: JSON.stringify({
                version: 2,
                phase: 'terminal',
                receiptId: 'IC_tagged',
                receiptBody: deliveryReceiptBody(42, 'head', closes, 2372),
            }),
        }).trim();
        const tagOid = annotatedBlobTagOid(primaryRoot, authorityOid, pack ? 'delivery-packed' : 'delivery-loose');
        execFileSync('git', ['update-ref', 'refs/sourdaw/delivery-receipt/pr-42', tagOid], { cwd: primaryRoot });
        if (pack) {
            execFileSync('git', ['pack-refs', '--all', '--prune'], { cwd: primaryRoot });
        }
        const port = shellPort(
            'jcosta33/sourdaw',
            { capture: () => expect.fail('unexpected capture'), run: () => undefined },
            { primaryRoot }
        );

        try {
            expect(() => port.readDeliveryReceiptAuthority(42)).toThrow(
                /delivery receipt authority cannot be proven|delivery receipt authority cannot be verified/i
            );
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }
    });

    it('rejects an exact broken symlink delivery receipt authority ref path', () => {
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const ref = 'refs/sourdaw/delivery-receipt/pr-42';
        const refPath = execFileSync('git', ['rev-parse', '--git-path', ref], {
            cwd: primaryRoot,
            encoding: 'utf8',
        }).trim();
        const exactRefPath = join(primaryRoot, refPath);
        const targetPath = join(primaryRoot, 'missing-target');
        mkdirSync(dirname(exactRefPath), { recursive: true });
        symlinkSync(targetPath, exactRefPath);
        const port = shellPort(
            'jcosta33/sourdaw',
            { capture: () => expect.fail('unexpected capture'), run: () => undefined },
            { primaryRoot }
        );

        try {
            expect(() => port.readDeliveryReceiptAuthority(42)).toThrow(
                /delivery receipt authority cannot be proven|delivery receipt authority cannot be verified/i
            );
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }
    });

    it('treats an exact delivery receipt authority child-prefix directory as absent', () => {
        const primaryRoot = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-shell-port-'));
        execFileSync('git', ['init', '--quiet'], { cwd: primaryRoot });
        const ref = 'refs/sourdaw/delivery-receipt/pr-42';
        const refPath = execFileSync('git', ['rev-parse', '--git-path', ref], {
            cwd: primaryRoot,
            encoding: 'utf8',
        }).trim();
        const exactRefPath = join(primaryRoot, refPath);
        mkdirSync(join(exactRefPath, 'child'), { recursive: true });
        const port = shellPort(
            'jcosta33/sourdaw',
            { capture: () => expect.fail('unexpected capture'), run: () => undefined },
            { primaryRoot }
        );

        try {
            expect(port.readDeliveryReceiptAuthority(42)).toBeUndefined();
        } finally {
            rmSync(primaryRoot, { recursive: true, force: true });
        }
    });

    it('fails shellPort merged recovery when proof count exceeds the complete REST lineage even if the latest id matches', () => {
        const bodyX = relationshipBody('Closes #2372');
        const effects: string[] = [];
        const port = shellPort('jcosta33/sourdaw', {
            capture: (_command, args) => {
                const joined = args.join(' ');
                if (joined.includes('pr view')) {
                    return JSON.stringify(
                        shellPullRequest(pullRequest({ state: 'MERGED', body: relationshipBody('None.') }))
                    );
                }
                if (joined.includes('mergedBy{__typename')) {
                    return shellMergedByGraphql({ __typename: 'Bot', id: AUTHOR_BOT_NODE_ID });
                }
                if (joined.includes('issues/42/comments?per_page=100')) {
                    return JSON.stringify([
                        [
                            {
                                node_id: 'IC_x',
                                body: deliveryReceiptBody(42, 'head', bodyX, 2372),
                                user: { node_id: AUTHOR_BOT_NODE_ID, login: 'renamed-author[bot]', type: 'Bot' },
                                created_at: '2026-08-21T00:00:00Z',
                                updated_at: '2026-08-21T00:00:00Z',
                            },
                        ],
                    ]);
                }
                if (joined.includes(ORDERED_RECEIPT_PROOF_QUERY_FRAGMENT)) {
                    return shellDeliveryReceiptProofResponse(['IC_x', 'IC_hidden_y']);
                }
                effects.push(`capture:${joined}`);
                throw new Error(`unexpected capture: ${joined}`);
            },
            run: () => undefined,
        });

        expect(() =>
            deliverPullRequest(42, port, {
                complete: (issue) => effects.push(`complete:${issue}`),
            })
        ).toThrow(/delivery receipt authority cannot be proven|delivery receipt changed during recovery/i);
        expect(effects).toEqual([]);
    });

    it('fails shellPort merged recovery when proof latest id differs despite an equal comment count', () => {
        const bodyX = relationshipBody('Closes #2372');
        const effects: string[] = [];
        const port = shellPort('jcosta33/sourdaw', {
            capture: (_command, args) => {
                const joined = args.join(' ');
                if (joined.includes('pr view')) {
                    return JSON.stringify(
                        shellPullRequest(pullRequest({ state: 'MERGED', body: relationshipBody('None.') }))
                    );
                }
                if (joined.includes('mergedBy{__typename')) {
                    return shellMergedByGraphql({ __typename: 'Bot', id: AUTHOR_BOT_NODE_ID });
                }
                if (joined.includes('issues/42/comments?per_page=100')) {
                    return JSON.stringify([
                        [
                            {
                                node_id: 'IC_x',
                                body: deliveryReceiptBody(42, 'head', bodyX, 2372),
                                user: { node_id: AUTHOR_BOT_NODE_ID, login: 'renamed-author[bot]', type: 'Bot' },
                                created_at: '2026-08-21T00:00:00Z',
                                updated_at: '2026-08-21T00:00:00Z',
                            },
                        ],
                    ]);
                }
                if (joined.includes(ORDERED_RECEIPT_PROOF_QUERY_FRAGMENT)) {
                    return shellDeliveryReceiptProofResponse(['IC_hidden_y']);
                }
                effects.push(`capture:${joined}`);
                throw new Error(`unexpected capture: ${joined}`);
            },
            run: () => undefined,
        });

        expect(() =>
            deliverPullRequest(42, port, {
                complete: (issue) => effects.push(`complete:${issue}`),
            })
        ).toThrow(/delivery receipt authority cannot be proven|delivery receipt changed during recovery/i);
        expect(effects).toEqual([]);
    });

    it('fails shellPort receipt proof when the first GraphQL page already reaches totalCount but still claims another page', () => {
        const port = shellPort('jcosta33/sourdaw', {
            capture: (_command, args) => {
                const joined = args.join(' ');
                if (joined.includes(ORDERED_RECEIPT_PROOF_QUERY_FRAGMENT)) {
                    return shellDeliveryReceiptProofResponse(['IC_x'], {
                        totalCount: 1,
                        hasNextPage: true,
                        endCursor: 'cursor-1',
                    });
                }
                throw new Error(`unexpected capture: ${joined}`);
            },
            run: () => undefined,
        });

        expect(() => port.deliveryReceiptProof(42)).toThrow(/cannot inspect delivery receipts for PR #42/i);
    });

    it('fails shellPort receipt proof when a later GraphQL page changes totalCount', () => {
        const port = shellPort('jcosta33/sourdaw', {
            capture: (_command, args) => {
                const joined = args.join(' ');
                if (joined.includes(ORDERED_RECEIPT_PROOF_QUERY_FRAGMENT)) {
                    if (joined.includes('cursor=cursor-1')) {
                        return shellDeliveryReceiptProofResponse(['IC_y'], {
                            totalCount: 3,
                        });
                    }
                    return shellDeliveryReceiptProofResponse(['IC_x'], {
                        totalCount: 2,
                        hasNextPage: true,
                        endCursor: 'cursor-1',
                    });
                }
                throw new Error(`unexpected capture: ${joined}`);
            },
            run: () => undefined,
        });

        expect(() => port.deliveryReceiptProof(42)).toThrow(/cannot inspect delivery receipts for PR #42/i);
    });

    /**
     * The gating set comes from the launcher's environment, not from a file this port reads. Nothing
     * in the snapshot can reach a workflow — no working tree, no checkout, no `git show` — so a port
     * that ran a command to answer this would be reading something the launcher never pinned.
     */
    it('takes the gating set from the launcher environment without reading any file', async () => {
        vi.stubEnv(
            'SOURDAW_TRUSTED_GATE_WORKFLOW',
            JSON.stringify(
                await summarizeGateWorkflow(
                    [
                        'name: Health gates',
                        'jobs:',
                        '  dependency-review:',
                        '    name: Dependency review',
                        '  gate:',
                        '    name: Gate',
                        '    needs: dependency-review',
                    ].join('\n')
                )
            )
        );
        const captures: Array<{ command: string; args: string[] }> = [];
        const port = shellPort('jcosta33/sourdaw', {
            capture: (command, args) => {
                captures.push({ command, args });
                return '';
            },
            run: () => undefined,
        });

        expect([...port.gateRequiredCheckNames()]).toEqual(['Dependency review']);
        expect(captures).toEqual([]);
    });

    /**
     * `contexts` is a paged connection, so the completeness signal has to be asked for and read.
     * Without it a head whose rollup outgrew one page reads as a shorter, tidier rollup than it is.
     */
    it('asks for the completeness signal alongside the rollup nodes', () => {
        const { captures, port } = rollupPort([{ nodes: rollupNodes([checkRun()]) }]);

        port.headCheckRuns(42, 'head');

        const query = rollupCaptures(captures)[0] ?? '';
        expect(query).toContain('totalCount');
        expect(query).toContain('hasNextPage');
        expect(query).toContain('endCursor');
    });

    it('pages the rollup to completion and keeps every context in order', () => {
        const { captures, port } = rollupPort([
            {
                nodes: rollupNodes([checkRun({ name: 'Lint', conclusion: 'CANCELLED' }), checkRun()]),
                totalCount: 3,
                hasNextPage: true,
                endCursor: 'Y3Vyc29yOjI=',
            },
            { nodes: rollupNodes([checkRun({ name: 'Lint' })]), totalCount: 3 },
        ]);

        expect(port.headCheckRuns(42, 'head')).toEqual([
            { name: 'Lint', status: 'COMPLETED', conclusion: 'CANCELLED' },
            { name: 'Gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
            { name: 'Lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
        ]);
        expect(rollupCaptures(captures)).toHaveLength(2);
        expect(rollupCaptures(captures)[0]).not.toContain('cursor=');
        expect(rollupCaptures(captures)[1]).toContain('cursor=Y3Vyc29yOjI=');
    });

    /**
     * The truncation this gate must not reason over: a page that carries fewer nodes than the head
     * actually has. Merging on it would treat absent checks as absent problems.
     */
    it.each([
        { label: 'a page that silently stops short of totalCount', hasNextPage: false, endCursor: null },
        { label: 'a page that claims more contexts but hands back no cursor', hasNextPage: true, endCursor: null },
    ])('refuses $label', ({ hasNextPage, endCursor }) => {
        const { port } = rollupPort([{ nodes: rollupNodes([checkRun()]), totalCount: 19, hasNextPage, endCursor }]);

        let thrown: unknown;
        try {
            port.headCheckRuns(42, 'head');
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe('Error: cannot read all 19 checks on PR #42: got 1');
    });

    /**
     * `hasNextPage` decides on its own whether another page exists. Without it the reader would page
     * on a cursor GitHub left behind on a finished connection, and a rollup it should have refused as
     * truncated would quietly complete itself from a page it was never told to ask for. Here the
     * first page stops short of `totalCount` and still carries a cursor: reading `hasNextPage` means
     * refusing, ignoring it means merging on a second page that was never offered.
     */
    it('refuses a short page that carries a stale cursor without claiming another page', () => {
        const { captures, port } = rollupPort([
            { nodes: rollupNodes([checkRun()]), totalCount: 2, hasNextPage: false, endCursor: 'Y3Vyc29yOjE=' },
            { nodes: rollupNodes([checkRun({ name: 'Lint' })]), totalCount: 2 },
        ]);

        let thrown: unknown;
        try {
            port.headCheckRuns(42, 'head');
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe('Error: cannot read all 2 checks on PR #42: got 1');
        expect(rollupCaptures(captures)).toHaveLength(1);
    });

    /**
     * `nodes.length < totalCount` is what stops the paging once the head is fully accounted for.
     * GitHub can report `hasNextPage` true beside a cursor on a connection whose `totalCount` the
     * first page already satisfies; without this arm the reader fetches again, overshoots the total,
     * and the completeness check then refuses a rollup that was complete on arrival.
     */
    it('stops paging once the nodes account for the total even while a further page is offered', () => {
        const { captures, port } = rollupPort([
            {
                nodes: rollupNodes([checkRun(), checkRun({ name: 'Lint' })]),
                totalCount: 2,
                hasNextPage: true,
                endCursor: 'Y3Vyc29yOjI=',
            },
            { nodes: rollupNodes([checkRun({ name: 'Secret scan' })]), totalCount: 2 },
        ]);

        expect(port.headCheckRuns(42, 'head')).toEqual([
            { name: 'Gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
            { name: 'Lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
        ]);
        expect(rollupCaptures(captures)).toHaveLength(1);
    });

    it('refuses to guess at an entry matching neither arm', () => {
        const { port } = rollupPort([{ nodes: [{ __typename: 'CheckSuite', name: 'Gate' }] }]);

        expect(() => port.headCheckRuns(42, 'head')).toThrow('cannot read a check on PR #42');
    });

    /**
     * Each page field is proven on its own, against a response valid in the other two. A rollup
     * malformed everywhere at once would pass whichever single guard is left standing, and say
     * nothing about the two that were removed.
     */
    it.each([
        { label: 'a head carrying no rollup at all', contexts: undefined },
        {
            label: 'a rollup that reports no total',
            contexts: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
        },
        {
            label: 'a rollup whose page info carries no completeness signal',
            contexts: { totalCount: 0, pageInfo: { endCursor: null }, nodes: [] },
        },
        {
            label: 'a rollup whose nodes are not a list',
            contexts: { totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null } },
        },
    ])('refuses to guess at $label', ({ contexts }) => {
        const rollup = contexts === undefined ? null : { contexts };
        const { port } = rollupPort([
            JSON.stringify({ data: { repository: { object: { statusCheckRollup: rollup } } } }),
        ]);

        let thrown: unknown;
        try {
            port.headCheckRuns(42, 'head');
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe('Error: cannot read the checks on PR #42');
    });

    it('uses complete GitHub reads and exact-head writes', () => {
        const captures: Array<{ command: string; args: string[] }> = [];
        const runs: Array<{ command: string; args: string[] }> = [];
        const shell: ShellRunner = {
            capture: (command, args) => {
                captures.push({ command, args });
                const joined = args.join(' ');
                if (joined.includes('query=')) {
                    return JSON.stringify({
                        data: {
                            repository: {
                                pullRequest: {
                                    reviews: {
                                        nodes: [
                                            {
                                                state: 'APPROVED',
                                                submittedAt: '2026-08-19T00:00:00Z',
                                                author: {
                                                    id: REVIEWER_BOT_NODE_ID,
                                                    login: 'renamed-reviewer[bot]',
                                                    __typename: 'Bot',
                                                },
                                                commit: { oid: 'head' },
                                            },
                                        ],
                                        pageInfo: { hasPreviousPage: false },
                                    },
                                    reviewThreads: {
                                        nodes: [{ isResolved: true }],
                                        pageInfo: { hasNextPage: false },
                                    },
                                },
                            },
                        },
                    });
                }
                if (joined.includes('pulls?state=open')) {
                    return JSON.stringify([
                        [
                            {
                                number: 43,
                                state: 'open',
                                head: { ref: 'feat/child', sha: 'child-head' },
                                base: { ref: 'feat/gate' },
                            },
                        ],
                    ]);
                }
                if (joined.includes('.delete_branch_on_merge')) {
                    return 'false';
                }
                if (joined === 'api repos/jcosta33/sourdaw') {
                    return mergeSettings({
                        allow_merge_commit: true,
                        allow_rebase_merge: false,
                        allow_squash_merge: true,
                        delete_branch_on_merge: false,
                    });
                }
                if (joined.includes('/merge')) {
                    return JSON.stringify({ merged: true, message: 'merged' });
                }
                throw new Error(`unexpected capture: ${command} ${joined}`);
            },
            run: (command, args) => runs.push({ command, args }),
        };
        const port = shellPort('jcosta33/sourdaw', shell);

        expect(port.reviewState(42, 'head')).toEqual({ latestReviewerStateOnHead: 'APPROVED', unresolvedThreads: 0 });
        expect(port.dependents('feat/gate')).toEqual([stacked()]);
        expect(port.repositoryDeletesMergedBranches()).toBe(false);
        port.merge(42, 'head', false, 'feat(delivery): committed subject');
        port.retarget(43, 'main');

        expect(
            captures.some(
                (entry) => entry.command === 'gh' && entry.args.includes('--paginate') && entry.args.includes('--slurp')
            )
        ).toBe(true);
        expect(captures).toContainEqual({
            command: 'gh',
            args: [
                'api',
                '--method',
                'PUT',
                'repos/jcosta33/sourdaw/pulls/42/merge',
                '-f',
                'sha=head',
                '-f',
                'merge_method=squash',
                '-f',
                'commit_title=feat(delivery): committed subject',
            ],
        });
        expect(runs).toContainEqual({
            command: 'gh',
            args: ['api', '--method', 'PATCH', 'repos/jcosta33/sourdaw/pulls/43', '-f', 'base=main', '--silent'],
        });
    });

    it.each([
        [
            'uses squash when it is the only enabled method',
            {
                allow_merge_commit: false,
                allow_rebase_merge: false,
                allow_squash_merge: true,
                delete_branch_on_merge: false,
            },
            'squash',
        ],
        [
            'uses squash even when merge commits are enabled',
            {
                allow_merge_commit: true,
                allow_rebase_merge: true,
                allow_squash_merge: true,
                delete_branch_on_merge: false,
            },
            'squash',
        ],
    ])('%s', (_case, settings, expectedMethod) => {
        const { captures, port } = mergePolicyPort(mergeSettings(settings));

        port.merge(42, 'head', false);

        expect(captures).toContainEqual({
            command: 'gh',
            args: ['api', 'repos/jcosta33/sourdaw'],
        });
        expect(captures).toContainEqual({
            command: 'gh',
            args: [
                'api',
                '--method',
                'PUT',
                'repos/jcosta33/sourdaw/pulls/42/merge',
                '-f',
                'sha=head',
                '-f',
                `merge_method=${expectedMethod}`,
            ],
        });
    });

    it.each([
        ['403', 'gh: HTTP 403: Resource not accessible by integration'],
        ['404', 'gh: HTTP 404: Pull request not found'],
        ['405', 'gh: HTTP 405: Base branch policy rejected the merge'],
        ['409', 'gh: HTTP 409: Head SHA changed before merge'],
        ['422', 'gh: HTTP 422: Pull Request is not mergeable'],
    ])('classifies a shell merge HTTP %s refusal as a definitive rejection', (_code, message) => {
        const shell: ShellRunner = {
            capture: (_command, args) => {
                if (args.join(' ') === 'api repos/jcosta33/sourdaw') {
                    return mergeSettings({
                        allow_merge_commit: false,
                        allow_rebase_merge: false,
                        allow_squash_merge: true,
                        delete_branch_on_merge: false,
                    });
                }
                if (args.includes('repos/jcosta33/sourdaw/pulls/42/merge')) {
                    throw new Error(message);
                }
                throw new Error(`unexpected capture: ${args.join(' ')}`);
            },
            run: () => undefined,
        };
        const port = shellPort('jcosta33/sourdaw', shell);

        try {
            port.merge(42, 'head', false);
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(DeliveryMergeRejectedError);
            expect(String(error)).toContain(message);
        }
    });

    it('keeps shell merge transport ambiguity as a non-definitive error', () => {
        const shell: ShellRunner = {
            capture: (_command, args) => {
                if (args.join(' ') === 'api repos/jcosta33/sourdaw') {
                    return mergeSettings({
                        allow_merge_commit: false,
                        allow_rebase_merge: false,
                        allow_squash_merge: true,
                        delete_branch_on_merge: false,
                    });
                }
                if (args.includes('repos/jcosta33/sourdaw/pulls/42/merge')) {
                    throw new Error('network timeout');
                }
                throw new Error(`unexpected capture: ${args.join(' ')}`);
            },
            run: () => undefined,
        };
        const port = shellPort('jcosta33/sourdaw', shell);

        try {
            port.merge(42, 'head', false);
            expect.unreachable();
        } catch (error) {
            expect(error).not.toBeInstanceOf(DeliveryMergeRejectedError);
            expect(String(error)).toContain('network timeout');
        }
    });

    it('rejects merging when no repository merge method is enabled', () => {
        const { captures, port } = mergePolicyPort(
            mergeSettings({
                allow_merge_commit: false,
                allow_rebase_merge: false,
                allow_squash_merge: false,
                delete_branch_on_merge: false,
            })
        );

        expect(() => port.merge(42, 'head', false)).toThrow(/squash merge is not enabled/);
        expect(captures).not.toContainEqual(
            expect.objectContaining({ args: expect.arrayContaining(['repos/jcosta33/sourdaw/pulls/42/merge']) })
        );
    });

    it('rejects stacked delivery when merged-branch deletion is enabled before the final merge', () => {
        const { captures, port } = stackedDeliveryPort({
            allow_merge_commit: false,
            allow_rebase_merge: false,
            allow_squash_merge: true,
            delete_branch_on_merge: true,
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/automatic merged-branch deletion/);
        expect(captures).not.toContainEqual(
            expect.objectContaining({ args: expect.arrayContaining(['repos/jcosta33/sourdaw/pulls/42/merge']) })
        );
    });

    it('rejects malformed repository merge settings', () => {
        const { captures, port } = mergePolicyPort('{"allow_merge_commit":true}');

        expect(() => port.merge(42, 'head', false)).toThrow(/cannot prove repository merge settings/);
        expect(captures).not.toContainEqual(
            expect.objectContaining({ args: expect.arrayContaining(['repos/jcosta33/sourdaw/pulls/42/merge']) })
        );
    });

    it('rejects a failed repository merge-settings query', () => {
        const { captures, port } = mergePolicyPort(new Error('GitHub unavailable'));

        expect(() => port.merge(42, 'head', false)).toThrow(
            /cannot determine repository merge settings: GitHub unavailable/
        );
        expect(captures).not.toContainEqual(
            expect.objectContaining({ args: expect.arrayContaining(['repos/jcosta33/sourdaw/pulls/42/merge']) })
        );
    });

    it('authenticates fetch by pruning all origin heads over HTTPS', () => {
        const helperDir = mkdtempSync(join(tmpdir(), 'sourdaw-git-helper-'));
        const runs: Array<{ command: string; args: string[] }> = [];
        try {
            const port = shellPort(
                'jcosta33/sourdaw',
                {
                    capture: () => '',
                    run: (command, args) => runs.push({ command, args }),
                },
                { gitToken: 'ghs_minted', helperDir }
            );
            port.fetch();
            expect(runs).toHaveLength(1);
            const args = runs[0]?.args ?? [];
            expect(args.slice(0, 3)).toEqual(['-c', 'credential.helper=', '-c']);
            expect(args[3]).toMatch(/^credential\.helper=\//);
            expect(args[3]).not.toContain('ghs_minted');
            expect(args.slice(4)).toEqual([
                'fetch',
                '--prune',
                GITHUB_HTTPS_REMOTE,
                '+refs/heads/*:refs/remotes/origin/*',
            ]);
            expect(args.join('\0')).not.toContain('ghs_minted');
            expect(args).not.toContain('--force');
            expect(args).not.toContain('+refs/heads/main:refs/remotes/origin/main');
        } finally {
            rmSync(helperDir, { recursive: true, force: true });
        }
    });

    it('accepts a renamed GraphQL reviewer with the immutable reviewer actor ID', () => {
        const shell: ShellRunner = {
            capture: (command, args) => {
                if (args.some((arg) => arg.startsWith('query='))) {
                    return JSON.stringify({
                        data: {
                            repository: {
                                pullRequest: {
                                    reviews: {
                                        nodes: [
                                            {
                                                state: 'APPROVED',
                                                submittedAt: '2026-08-19T00:00:00Z',
                                                author: {
                                                    id: REVIEWER_BOT_NODE_ID,
                                                    login: 'renamed-reviewer',
                                                    __typename: 'Bot',
                                                },
                                                commit: { oid: 'head' },
                                            },
                                        ],
                                        pageInfo: { hasPreviousPage: false },
                                    },
                                    reviewThreads: {
                                        nodes: [{ isResolved: true }],
                                        pageInfo: { hasNextPage: false },
                                    },
                                },
                            },
                        },
                    });
                }
                throw new Error(`unexpected capture: ${command} ${args.join(' ')}`);
            },
            run: () => undefined,
        };
        expect(shellPort('jcosta33/sourdaw', shell).reviewState(42, 'head')).toEqual({
            latestReviewerStateOnHead: 'APPROVED',
            unresolvedThreads: 0,
        });
    });

    it('ignores reviewer approvals that target a different commit than the expected head', () => {
        const shell: ShellRunner = {
            capture: (command, args) => {
                if (args.some((arg) => arg.startsWith('query='))) {
                    return JSON.stringify({
                        data: {
                            repository: {
                                pullRequest: {
                                    reviews: {
                                        nodes: [
                                            {
                                                state: 'APPROVED',
                                                submittedAt: '2026-08-19T00:00:00Z',
                                                author: {
                                                    id: REVIEWER_BOT_NODE_ID,
                                                    login: 'renamed-reviewer[bot]',
                                                    __typename: 'Bot',
                                                },
                                                commit: { oid: 'other-head' },
                                            },
                                        ],
                                        pageInfo: { hasPreviousPage: false },
                                    },
                                    reviewThreads: {
                                        nodes: [{ isResolved: true }],
                                        pageInfo: { hasNextPage: false },
                                    },
                                },
                            },
                        },
                    });
                }
                throw new Error(`unexpected capture: ${command} ${args.join(' ')}`);
            },
            run: () => undefined,
        };
        expect(shellPort('jcosta33/sourdaw', shell).reviewState(42, 'head')).toEqual({
            latestReviewerStateOnHead: null,
            unresolvedThreads: 0,
        });
    });
});
