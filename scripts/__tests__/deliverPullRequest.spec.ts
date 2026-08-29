import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import {
    deliverPullRequest as deliverPullRequestWithTracker,
    deliverPullRequestWithRequiredCi as deliverPullRequestWithRequiredCiAndTracker,
    gateRequiredCheckNames,
    parseCliArgs,
    readGateRequiredCheckNames,
    shellPort,
    type DeliveryPort,
    type HeadCheckRun,
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

const body = relationshipBody('None.');

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
                return 'false';
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
    primary?: PullRequestSnapshot[];
    review?: ReviewState;
    reviewStates?: ReviewState[];
    dependentSets?: StackedPullRequest[][];
    dirty?: boolean;
    headCheckRuns?: HeadCheckRun[] | Error;
    gateRequiredCheckNames?: ReadonlySet<string> | Error;
    deletesMergedBranches?: boolean;
    failAddReceiptOnce?: boolean;
    failRetargetOnce?: number;
    mergedByActorNodeIdAfterMerge?: string | null;
    primaryBaseRefNameOnReceiptRead?: string;
    primaryBodyOnReceiptRead?: string;
    reviewStateOnReceiptRead?: ReviewState;
    receipts?: DeliveryReceiptComment[];
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

function fakePort(input: FakeInput = {}) {
    const calls: string[] = [];
    const primary = [...(input.primary ?? [pullRequest(), pullRequest()])];
    const reviewStates = [...(input.reviewStates ?? [])];
    const dependentSets = input.dependentSets?.map((set) => [...set]) ?? [[stacked()], [stacked()]];
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
         * Unreadable unless the case under test supplies the head's own check runs, so a delivery
         * that reads check evidence it has no business reading — a dependent's, or an already-merged
         * pull request's — throws instead of quietly passing.
         */
        headCheckRuns: (number, headRefOid) => {
            calls.push(`checks:${number}:${headRefOid}`);
            const runs = number === 42 ? input.headCheckRuns : undefined;
            if (runs === undefined) {
                throw new Error(`PR #${number} check rollup is unreadable`);
            }
            if (runs instanceof Error) {
                throw runs;
            }
            return runs;
        },
        reviewState: (number, expectedHead) => {
            calls.push(`review:${number}:${expectedHead}`);
            return (
                reviewStateAfterReceipt ??
                reviewStates.shift() ??
                input.review ?? { latestReviewerStateOnHead: 'APPROVED', unresolvedThreads: 0 }
            );
        },
        dependents: () => {
            const next = dependentSets.shift();
            if (next !== undefined) {
                lastDependents = next;
            }
            return [...lastDependents];
        },
        repositoryDeletesMergedBranches: () => input.deletesMergedBranches ?? false,
        merge: (number, head) => {
            calls.push(`merge:${number}:${head}`);
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
        log: (message) => calls.push(message),
    };
    const tracker: TrackerCompletionPort = {
        complete: (issueNumber: number) => {
            calls.push(`complete:${issueNumber}`);
        },
    };
    return { port, calls, tracker, receipts };
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
        expect(receipts.map((receipt) => receipt.body)).toEqual([deliveryReceiptBody(42, 'head', bodyY, 2373)]);
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

        expect(calls.filter((call) => call === 'receipts:42')).toHaveLength(3);
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
            label: 'head branch drift',
            mergedPrimaryAfterMerge: { headRefName: 'feat/rewritten-head' },
            error: /headRefName changed during delivery/,
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
                title: 'feat(delivery): post-merge retarget race',
            },
            authorizedBody: relationshipBody('Related #2372'),
            error: /closing target changed during delivery/,
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

    it('recovers an UNKNOWN initial refresh that becomes a merged author-App head', () => {
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

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'review:42:head')).toHaveLength(0);
        expect(calls.filter((call) => call === 'receipts:42')).toHaveLength(1);
        expect(calls).not.toContain('merge:42:head');
        expect(calls).toContain('retarget:43:main');
        expect(calls).toContain('complete:2372');
        expect(calls).toContain('PR #42 was already merged; repaired 1 remaining dependent(s)');
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
        expect(calls.filter((call) => call === 'receipts:42')).toHaveLength(3);
        expect(calls).not.toContain('merge:42:head');
        expect(calls).toContain('retarget:43:main');
        expect(calls).toContain('complete:2372');
        expect(calls).toContain('PR #42 became merged during delivery; repaired 1 dependent(s)');
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

    it('accepts X to Y to X receipt lineage and recovers the newest successful X receipt after merge', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const seededX: DeliveryReceiptComment = {
            id: 'IC_seeded_x',
            body: deliveryReceiptBody(42, 'head', bodyX, 2372),
            authorNodeId: AUTHOR_BOT_NODE_ID,
            authorLogin: 'renamed-author[bot]',
            authorType: 'Bot',
            createdAt: '2026-08-21T00:00:00.000Z',
            updatedAt: '2026-08-21T00:00:00.000Z',
        };
        const { port, calls, receipts, tracker } = fakePort({
            primary: [
                pullRequest({ body: bodyY }),
                pullRequest({ body: bodyY }),
                pullRequest({ body: bodyY }),
                pullRequest({ body: bodyY }),
                pullRequest({ state: 'MERGED', body: bodyX }),
                pullRequest({ state: 'MERGED', body: relationshipBody('None.') }),
            ],
            primaryBodyOnReceiptRead: bodyX,
            dependentSets: [[], []],
            receipts: [seededX],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/closing target changed during delivery/);
        expect(calls).not.toContain('merge:42:head');
        expect(receipts.map((receipt) => receipt.body)).toEqual([
            deliveryReceiptBody(42, 'head', bodyX, 2372),
            deliveryReceiptBody(42, 'head', bodyY, 2373),
        ]);

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(2);
        expect(calls.filter((call) => call === 'merge:42:head')).toHaveLength(1);
        expect(receipts.map((receipt) => receipt.body)).toEqual([
            deliveryReceiptBody(42, 'head', bodyX, 2372),
            deliveryReceiptBody(42, 'head', bodyY, 2373),
            deliveryReceiptBody(42, 'head', bodyX, 2372),
        ]);
        expect(receipts.map((receipt) => Date.parse(receipt.createdAt))).toEqual([
            Date.parse('2026-08-21T00:00:00.000Z'),
            Date.parse('2026-08-21T00:00:01.000Z'),
            Date.parse('2026-08-21T00:00:02.000Z'),
        ]);

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(2);
        expect(calls).not.toContain('complete:2373');
    });

    it('completes the receipt issue after a single-receipt merged body drift', () => {
        const closes = relationshipBody('Closes #2372');
        const { port, calls, tracker } = fakePort({
            primary: [pullRequest({ state: 'MERGED', body: relationshipBody('None.') })],
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

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('retarget:43:main');
        expect(calls).toContain('complete:2372');
        expect(calls.indexOf('complete:2372')).toBeGreaterThan(calls.indexOf('retarget:43:main'));
    });

    it('recovers the newest X to Y receipt after merge', () => {
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
            receipts: [
                receipt('IC_x', bodyX, 2372, '2026-08-21T00:00:00Z'),
                receipt('IC_y', bodyY, 2373, '2026-08-21T00:00:01Z'),
            ],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('complete:2373');
        expect(calls).not.toContain('complete:2372');
    });

    it('recovers a unique newer X after tied historical X and Y receipts', () => {
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
            receipts: [
                receipt('IC_historical_x', bodyX, 2372, '2026-08-21T00:00:00Z'),
                receipt('IC_historical_y', bodyY, 2373, '2026-08-21T00:00:00Z'),
                receipt('IC_newest_x', bodyX, 2372, '2026-08-21T00:00:01Z'),
            ],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('complete:2372');
        expect(calls).not.toContain('complete:2373');
    });

    it('uses REST comment order to recover Y after equal-timestamp X then Y receipts', () => {
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
            receipts: [receipt('IC_first', staleBody, 2372), receipt('IC_second', currentBody, 2373)],
        });

        deliverPullRequest(42, port, tracker);

        expect(calls).toContain('complete:2373');
        expect(calls).not.toContain('complete:2372');
    });

    it('writes the immutable delivery receipt before merge and uses it after mutable-body drift', () => {
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
        expect(calls).not.toContainEqual(expect.stringMatching(/delivered|success/i));

        deliverPullRequest(42, port, tracker);

        expect(calls.filter((call) => call === 'complete:2372')).toHaveLength(2);
        expect(calls.filter((call) => call === 'add-receipt:42')).toHaveLength(1);
        expect(calls).toContain('PR #42 was already merged; repaired 0 remaining dependent(s)');
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

    it('rejects adjacent byte-identical receipt payloads instead of choosing authority', () => {
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

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/duplicate delivery receipts/);
        expect(calls).not.toContain('merge:42:head');
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
        { ciState: 'successful', mergeStateStatus: 'CLEAN' },
        { ciState: 'failed', mergeStateStatus: 'BLOCKED' },
        { ciState: 'pending', mergeStateStatus: 'UNKNOWN' },
        { ciState: 'absent', mergeStateStatus: '' },
        { ciState: 'cancelled', mergeStateStatus: 'UNSTABLE' },
        { ciState: 'malformed', mergeStateStatus: 'not-a-github-state' },
        { ciState: 'unavailable', mergeStateStatus: 'UNAVAILABLE' },
    ])('merges with $ciState CI evidence while CI admission is advisory', ({ mergeStateStatus }) => {
        const forbiddenCiRead = new Error('advisory delivery must not read CI evidence');
        const { port, calls } = fakePort({
            primary: [pullRequest({ mergeStateStatus }), pullRequest({ mergeStateStatus })],
            gateRequiredCheckNames: forbiddenCiRead,
            headCheckRuns: forbiddenCiRead,
        });

        deliverPullRequest(42, port);

        expect(calls).toContain('merge:42:head');
        expect(calls).not.toContain('gate-required-check-names');
        expect(calls.filter((call) => call.startsWith('checks:'))).toEqual([]);
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
        expect(calls.filter((call) => call.startsWith('checks:'))).toEqual([]);
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
        const comment = (id: string, receiptBody: string) => ({
            node_id: id,
            body: receiptBody,
            user: { node_id: AUTHOR_BOT_NODE_ID, login: 'renamed-author[bot]', type: 'Bot' },
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
        });
        const port = shellPort('jcosta33/sourdaw', {
            capture: (command, args) => {
                captures.push({ command, args });
                return JSON.stringify([
                    [comment('IC_x', deliveryReceiptBody(42, 'head', relationshipBody('Closes #2372'), 2372))],
                    [comment('IC_y', deliveryReceiptBody(42, 'head', relationshipBody('Closes #2373'), 2373))],
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

    it('uses REST response order, not created_at order, for shellPort merged recovery', () => {
        const bodyX = relationshipBody('Closes #2372');
        const bodyY = relationshipBody('Closes #2373');
        const effects: string[] = [];
        const captures: string[] = [];
        const comment = (id: string, receiptBody: string, createdAt: string) => ({
            node_id: id,
            body: receiptBody,
            user: { node_id: AUTHOR_BOT_NODE_ID, login: 'renamed-author[bot]', type: 'Bot' },
            created_at: createdAt,
            updated_at: createdAt,
        });
        const port = shellPort('jcosta33/sourdaw', {
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
                if (joined.includes('pulls?state=open')) {
                    return JSON.stringify([[]]);
                }
                throw new Error(`unexpected capture: ${joined}`);
            },
            run: () => undefined,
        });

        deliverPullRequest(42, port, {
            complete: (issue) => effects.push(`complete:${issue}`),
        });

        expect(captures.slice(0, 3)).toEqual([
            expect.stringContaining('pr view 42'),
            expect.stringContaining('mergedBy{__typename'),
            'api --paginate --slurp repos/jcosta33/sourdaw/issues/42/comments?per_page=100',
        ]);
        expect(effects).toEqual(['complete:2373']);
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
        port.merge(42, 'head', false);
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
