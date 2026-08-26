import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    deliverPullRequest as deliverPullRequestWithTracker,
    parseCliArgs,
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
                return JSON.stringify(rawPullRequest(args.includes('43') ? child : pullRequest()));
            }
            if (joined.includes('statusCheckRollup')) {
                return rollupResponse({
                    nodes: rollupNodes(joined.includes('oid=child-head') ? child.checkRuns : pullRequest().checkRuns),
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
        mergeStateStatus: 'CLEAN',
        reviewDecision: '',
        changedFiles: 3,
        additions: 40,
        deletions: 5,
        checkRuns: [checkRun()],
        ...overrides,
    };
}

function checkRun(overrides: Partial<HeadCheckRun> = {}): HeadCheckRun {
    return { name: 'Gate', status: 'COMPLETED', conclusion: 'SUCCESS', ...overrides };
}

/**
 * The shape an approving review leaves behind when its own run cancels the push run still in
 * flight: every cancelled name succeeded again on the same commit, beside a job the workflow
 * skipped outright and never cancelled.
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

function rawPullRequest(snapshot: PullRequestSnapshot): Record<string, unknown> {
    return Object.fromEntries(Object.entries(snapshot).filter(([field]) => field !== 'checkRuns'));
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
    deletesMergedBranches?: boolean;
    failRetargetOnce?: number;
    receipts?: DeliveryReceiptComment[];
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
    let failedRetarget = false;
    const receipts = [...(input.receipts ?? [])];
    const port: DeliveryPort & {
        deliveryReceipts: (number: number) => DeliveryReceiptComment[];
        addDeliveryReceipt: (number: number, body: string) => DeliveryReceiptComment;
    } = {
        fetch: () => calls.push('fetch'),
        pullRequest: (number) => {
            if (number === 42) {
                const next = primary.shift();
                if (next === undefined) {
                    throw new Error('missing primary fixture');
                }
                return next;
            }
            const current = pullRequests.get(number);
            if (current === undefined) {
                throw new Error(`missing PR #${number} fixture`);
            }
            return current;
        },
        reviewState: (number, expectedHead) => {
            calls.push(`review:${number}:${expectedHead}`);
            return (
                reviewStates.shift() ?? input.review ?? { latestReviewerStateOnHead: 'APPROVED', unresolvedThreads: 0 }
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
        merge: (number, head) => calls.push(`merge:${number}:${head}`),
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
            return structuredClone(receipts);
        },
        addDeliveryReceipt: (number, receiptBody) => {
            calls.push(`add-receipt:${number}`);
            const receipt = {
                id: `IC_delivery_${number}`,
                body: receiptBody,
                authorNodeId: AUTHOR_BOT_NODE_ID,
                authorLogin: 'renamed-author[bot]',
                authorType: 'Bot',
                createdAt: '2026-08-21T00:00:00Z',
                updatedAt: '2026-08-21T00:00:00Z',
            };
            receipts.push(receipt);
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

    it('converges issue completion on an already-merged retry from its author-bot receipt', () => {
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

    it('writes the immutable delivery receipt before merge and uses it after mutable-body drift', () => {
        const closes = relationshipBody('Closes #2372');
        const child = stacked();
        const { port, calls, tracker } = fakePort({
            primary: [
                pullRequest({ body: closes }),
                pullRequest({ body: closes }),
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

    it('fails closed on malformed, mismatched, or edited author-bot receipts', () => {
        const closes = relationshipBody('Closes #2372');
        const receipt = deliveryReceiptBody(42, 'head', closes, 2373);
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
                id: 'IC_wrong_target',
                body: receipt,
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

    it('rejects duplicate delivery receipts instead of choosing authority', () => {
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
            receipts: [receipt, { ...receipt, id: 'IC_delivery_42_duplicate' }],
        });

        expect(() => deliverPullRequest(42, port, tracker)).toThrow(/duplicate delivery receipts/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('merges the expected head and retargets stable dependents', () => {
        const { port, calls } = fakePort();

        deliverPullRequest(42, port);

        expect(calls).toEqual(expect.arrayContaining(['merge:42:head', 'retarget:43:main']));
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
                pullRequest({ mergeStateStatus: 'CLEAN', baseRefOid: 'base-before' }),
                pullRequest({ mergeStateStatus: 'BLOCKED', baseRefOid: 'base-after' }),
            ],
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/BLOCKED/);
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

    it.each(['BLOCKED', 'BEHIND', 'DIRTY', 'DRAFT', 'UNKNOWN'])(
        'rejects merge state %s and names it, because it reports something other than checks',
        (mergeStateStatus) => {
            const { port, calls } = fakePort({
                primary: [pullRequest({ mergeStateStatus, checkRuns: [checkRun()] })],
            });

            let thrown: unknown;
            try {
                deliverPullRequest(42, port);
            } catch (error) {
                thrown = error;
            }

            expect(String(thrown)).toBe(`Error: PR #42 merge state is ${mergeStateStatus}`);
            expect(calls).not.toContain('merge:42:head');
        }
    );

    it('merges a CLEAN head', () => {
        const { port, calls } = fakePort({ primary: [pullRequest(), pullRequest()] });

        deliverPullRequest(42, port);

        expect(calls).toContain('merge:42:head');
    });

    /**
     * The cancelled run is a corpse of the push run the approval superseded. Its `Gate` is what
     * makes GitHub call the head UNSTABLE; the run that actually decided the head passed.
     */
    it('merges an UNSTABLE head whose only non-success runs were cancelled and whose Gate succeeded', () => {
        const superseded = { mergeStateStatus: 'UNSTABLE', checkRuns: supersededRunCheckRuns() };
        const { port, calls } = fakePort({
            primary: [pullRequest(superseded), pullRequest(superseded)],
        });

        deliverPullRequest(42, port);

        expect(calls).toContain('merge:42:head');
    });

    it.each(['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])(
        'refuses an UNSTABLE head carrying a check that concluded %s',
        (conclusion) => {
            const { port, calls } = fakePort({
                primary: [
                    pullRequest({
                        mergeStateStatus: 'UNSTABLE',
                        checkRuns: [...supersededRunCheckRuns(), checkRun({ name: 'Unit suite 1/4', conclusion })],
                    }),
                ],
            });

            let thrown: unknown;
            try {
                deliverPullRequest(42, port);
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
            primary: [
                pullRequest({
                    mergeStateStatus: 'UNSTABLE',
                    checkRuns: [
                        ...supersededRunCheckRuns(),
                        checkRun({ name: 'End-to-end 3/12', status: 'IN_PROGRESS', conclusion: null }),
                    ],
                }),
            ],
        });

        let thrown: unknown;
        try {
            deliverPullRequest(42, port);
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
            primary: [
                pullRequest({
                    mergeStateStatus: 'UNSTABLE',
                    checkRuns: [
                        checkRun({ name: 'Lint', conclusion: 'CANCELLED' }),
                        checkRun({ name: 'Gate', conclusion: 'CANCELLED' }),
                        checkRun({ name: 'Lint' }),
                    ],
                }),
            ],
        });

        let thrown: unknown;
        try {
            deliverPullRequest(42, port);
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe('Error: PR #42 merge state is UNSTABLE and no Gate check succeeded on head');
        expect(calls).not.toContain('merge:42:head');
    });

    /**
     * The live shape of `Dependency review` on an approval run: the push run's attempt was
     * cancelled, and the review-triggered run skipped the job because it is gated on
     * `pull_request`. `Gate` passes on `skipped`, so a green `Gate` is not a dependency verdict, and
     * the skips are not one either. This is why `deliver` refuses PR #2795's head today.
     */
    it('refuses an UNSTABLE head whose cancelled check only ever skipped beside that cancellation', () => {
        const { port, calls } = fakePort({
            primary: [
                pullRequest({
                    mergeStateStatus: 'UNSTABLE',
                    checkRuns: [
                        ...supersededRunCheckRuns(),
                        checkRun({ name: 'Dependency review', conclusion: 'CANCELLED' }),
                        checkRun({ name: 'Dependency review', conclusion: 'SKIPPED' }),
                        checkRun({ name: 'Dependency review', conclusion: 'SKIPPED' }),
                    ],
                }),
            ],
        });

        let thrown: unknown;
        try {
            deliverPullRequest(42, port);
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe(
            'Error: PR #42 merge state is UNSTABLE and check Dependency review was cancelled and never succeeded on head'
        );
        expect(calls).not.toContain('merge:42:head');
    });

    /**
     * The rule keys on a cancellation, not on the absence of a success: a job the workflow simply
     * never ran on this head has nothing to supersede and nothing to prove.
     */
    it('merges an UNSTABLE head carrying a check that only ever skipped and never cancelled', () => {
        const superseded = {
            mergeStateStatus: 'UNSTABLE',
            checkRuns: [
                ...supersededRunCheckRuns(),
                checkRun({ name: 'Windows device layer', conclusion: 'SKIPPED' }),
                checkRun({ name: 'Windows device layer', conclusion: 'SKIPPED' }),
            ],
        };
        const { port, calls } = fakePort({ primary: [pullRequest(superseded), pullRequest(superseded)] });

        deliverPullRequest(42, port);

        expect(calls).toContain('merge:42:head');
    });

    it('refuses an UNSTABLE head with no checks at all', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest({ mergeStateStatus: 'UNSTABLE', checkRuns: [] })],
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/no Gate check succeeded on head/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('refuses an UNSTABLE head carrying a conclusion it does not recognize', () => {
        const { port, calls } = fakePort({
            primary: [
                pullRequest({
                    mergeStateStatus: 'UNSTABLE',
                    checkRuns: [...supersededRunCheckRuns(), checkRun({ name: 'CodeQL', conclusion: 'STALE' })],
                }),
            ],
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/check CodeQL concluded STALE/);
        expect(calls).not.toContain('merge:42:head');
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
    function rollupPort(pages: Array<RollupPageFixture | string>) {
        const captures: Array<{ command: string; args: string[] }> = [];
        const remaining = [...pages];
        const port = shellPort('jcosta33/sourdaw', {
            capture: (command, args) => {
                captures.push({ command, args });
                const joined = args.join(' ');
                if (joined.includes('pr view')) {
                    return JSON.stringify(rawPullRequest(pullRequest()));
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

        const snapshot = port.pullRequest(42);

        expect(rollupCaptures(captures)).toHaveLength(1);
        expect(rollupCaptures(captures)[0]).toContain('oid=head');
        expect(snapshot.checkRuns).toEqual([
            { name: 'Gate', status: 'COMPLETED', conclusion: 'SUCCESS' },
            { name: 'Lint', status: 'COMPLETED', conclusion: 'CANCELLED' },
            { name: 'End-to-end 1/12', status: 'IN_PROGRESS', conclusion: null },
            { name: 'coverage/external', status: 'COMPLETED', conclusion: 'FAILURE' },
            { name: 'deploy/preview', status: 'PENDING', conclusion: null },
        ]);
        expect(snapshot).not.toHaveProperty('statusCheckRollup');
    });

    /**
     * `contexts` is a paged connection, so the completeness signal has to be asked for and read.
     * Without it a head whose rollup outgrew one page reads as a shorter, tidier rollup than it is.
     */
    it('asks for the completeness signal alongside the rollup nodes', () => {
        const { captures, port } = rollupPort([{ nodes: rollupNodes([checkRun()]) }]);

        port.pullRequest(42);

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

        const snapshot = port.pullRequest(42);

        expect(snapshot.checkRuns).toEqual([
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
            port.pullRequest(42);
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe('Error: cannot read all 19 checks on PR #42: got 1');
    });

    it('refuses to guess at an entry matching neither arm', () => {
        const { port } = rollupPort([{ nodes: [{ __typename: 'CheckSuite', name: 'Gate' }] }]);

        expect(() => port.pullRequest(42)).toThrow('cannot read a check on PR #42');
    });

    it.each([
        { label: 'a head carrying no rollup at all', object: { statusCheckRollup: null } },
        {
            label: 'a rollup whose nodes are not a list',
            object: { statusCheckRollup: { contexts: { totalCount: 0 } } },
        },
    ])('refuses to guess at $label', ({ object }) => {
        const { port } = rollupPort([JSON.stringify({ data: { repository: { object } } })]);

        expect(() => port.pullRequest(42)).toThrow('cannot read the checks on PR #42');
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
