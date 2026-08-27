import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    deliverPullRequest as deliverPullRequestWithTracker,
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
                return JSON.stringify(args.includes('43') ? child : pullRequest());
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
        ...overrides,
    };
}

function checkRun(overrides: Partial<HeadCheckRun> = {}): HeadCheckRun {
    return { name: 'Gate', status: 'COMPLETED', conclusion: 'SUCCESS', ...overrides };
}

/**
 * Written out rather than read from the workflow, so a wrong derivation changes the production set
 * alone and these expectations still say what the check names are.
 */
const gatingCheckNames: ReadonlySet<string> = new Set([
    'Decide scope',
    'Types and contracts',
    'Lint',
    'Module boundaries',
    'Dependency review',
    'Production build',
    'Rust workspace and collaboration server',
    'Native audio backend (macOS)',
    'Windows device layer',
    'CodeQL',
    'Secret scan',
]);

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
    headCheckRuns?: HeadCheckRun[];
    gateRequiredCheckNames?: ReadonlySet<string>;
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
        gateRequiredCheckNames: () => {
            calls.push('gate-required-check-names');
            return input.gateRequiredCheckNames ?? gatingCheckNames;
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
            return runs;
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
                primary: [pullRequest({ mergeStateStatus })],
                headCheckRuns: [checkRun()],
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

    /**
     * A CLEAN head is decided by GitHub's own aggregate, so the rollup is never read for it — the
     * fake refuses to hand one back, and this delivery never asks.
     */
    it('merges a CLEAN head without reading its check rollup', () => {
        const { port, calls } = fakePort({ primary: [pullRequest(), pullRequest()] });

        deliverPullRequest(42, port);

        expect(calls).toContain('merge:42:head');
        expect(calls.filter((call) => call.startsWith('checks:'))).toEqual([]);
    });

    /**
     * The cancelled run is a corpse of the push run the approval superseded. Its `Gate` is what
     * makes GitHub call the head UNSTABLE; the run that actually decided the head passed.
     */
    it('merges an UNSTABLE head whose only non-success runs were cancelled and whose Gate succeeded', () => {
        const unstable = { mergeStateStatus: 'UNSTABLE' };
        const { port, calls } = fakePort({
            primary: [pullRequest(unstable), pullRequest(unstable)],
            headCheckRuns: supersededRunCheckRuns(),
        });

        deliverPullRequest(42, port);

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
            primary: [pullRequest({ mergeStateStatus: 'UNSTABLE' })],
            headCheckRuns: [
                ...supersededRunCheckRuns(),
                checkRun({ name: 'End-to-end 3/12', status: 'IN_PROGRESS', conclusion: null }),
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
            primary: [pullRequest({ mergeStateStatus: 'UNSTABLE' })],
            headCheckRuns: [
                checkRun({ name: 'Lint', conclusion: 'CANCELLED' }),
                checkRun({ name: 'Gate', conclusion: 'CANCELLED' }),
                checkRun({ name: 'Lint' }),
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
     * the skips are not one either. `Gate` needs that job, so this is why `deliver` refuses PR
     * #2795's head today.
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

        deliverPullRequest(42, port);

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

        deliverPullRequest(42, tolerated.port);

        expect(tolerated.calls).toContain('merge:42:head');

        const refused = fakePort({
            primary: [pullRequest({ mergeStateStatus: 'UNSTABLE' })],
            headCheckRuns: checkRuns,
            gateRequiredCheckNames: new Set(['Gate', 'Lint', 'Secret scan']),
        });

        let thrown: unknown;
        try {
            deliverPullRequest(42, refused.port);
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe(
            'Error: PR #42 merge state is UNSTABLE and check Secret scan was cancelled and never succeeded on head'
        );
        expect(refused.calls).not.toContain('merge:42:head');
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

        deliverPullRequest(42, port);

        expect(calls).toContain('merge:42:head');
    });

    it('refuses an UNSTABLE head with no checks at all', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest({ mergeStateStatus: 'UNSTABLE' })],
            headCheckRuns: [],
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/no Gate check succeeded on head/);
        expect(calls).not.toContain('merge:42:head');
    });

    it('refuses an UNSTABLE head carrying a conclusion it does not recognize', () => {
        const { port, calls } = fakePort({
            primary: [pullRequest({ mergeStateStatus: 'UNSTABLE' })],
            headCheckRuns: [...supersededRunCheckRuns(), checkRun({ name: 'CodeQL', conclusion: 'STALE' })],
        });

        expect(() => deliverPullRequest(42, port)).toThrow(/check CodeQL concluded STALE/);
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

        deliverPullRequest(42, port);

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
    const WORKFLOW_PATH = '.github/workflows/health-gates.yml';

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
    it('maps every job the gate needs to the name GitHub labels its check with', () => {
        const names = gateRequiredCheckNames(workflow(decide, boundaries, dependencyReview, nightly, gate));

        expect([...names].sort()).toEqual(['Decide scope', 'Dependency review', 'boundaries']);
    });

    /**
     * A job that reports on a schedule is not merge evidence, however loudly it is cancelled on a
     * superseded pull-request run.
     */
    it('leaves a job outside the gate needs out of the gating set', () => {
        const names = gateRequiredCheckNames(workflow(decide, boundaries, dependencyReview, nightly, gate));

        expect(names.has('Nightly failure report')).toBe(false);
    });

    it('reads a gate that needs one job written inline', () => {
        const inlineGate = ['  gate:', '    name: Gate', '    needs: dependency-review'].join('\n');

        expect([...gateRequiredCheckNames(workflow(decide, dependencyReview, inlineGate))]).toEqual([
            'Dependency review',
        ]);
    });

    function gateNeeding(jobId: string): string {
        return ['  gate:', '    name: Gate', `    needs: ${jobId}`].join('\n');
    }

    /**
     * A quoted name is one of the two spellings this reader accepts, and a single-quoted value
     * spells an apostrophe by doubling it.
     */
    it('reads a quoted job name and its doubled single quote', () => {
        const lint = ['  lint:', "    name: 'Lint''s pass'", '    runs-on: ubuntu-latest'].join('\n');

        expect([...gateRequiredCheckNames(workflow(lint, gateNeeding('lint')))]).toEqual(["Lint's pass"]);
    });

    /**
     * Every spelling here parses as valid YAML and none of them is a name this reader can resolve.
     * Handing back the raw text instead would name a check GitHub never reports, and every
     * cancellation under the real name would then be tolerated in silence.
     */
    it.each([
        { label: 'a plain name ending in a comment', declared: '    name: Lint # the fast lane' },
        { label: 'an anchored name', declared: '    name: &fast Lint' },
        { label: 'an aliased name', declared: '    name: *fast' },
        { label: 'a tagged name', declared: '    name: !!str Lint' },
        { label: 'a folded block name', declared: '    name: >-' },
        { label: 'a literal block name', declared: '    name: |' },
        { label: 'a double-quoted name carrying an escape', declared: '    name: "Lint \\"fast\\""' },
    ])('refuses $label', ({ declared }) => {
        const lint = ['  lint:', declared, '    runs-on: ubuntu-latest'].join('\n');

        let thrown: unknown;
        try {
            gateRequiredCheckNames(workflow(lint, gateNeeding('lint')));
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe(
            `Error: cannot read ${declared.slice('    name: '.length)} in ${WORKFLOW_PATH} as a plain or quoted scalar`
        );
    });

    function unresolvableJobField(detail: string): string {
        return (
            `Error: the static job in ${WORKFLOW_PATH} ${detail}, ` +
            'which this reader cannot resolve to the name GitHub reports'
        );
    }

    /**
     * A YAML scalar does not end where its line ends. `Types and` continued on a deeper line is one
     * value GitHub reports as `Types and contracts`, and a value that is only a comment is null, so
     * GitHub labels that check with the job id. Read one line at a time, each of these resolves to a
     * name GitHub never reports, and the cancellation this gate exists to catch passes unseen.
     */
    it.each([
        {
            label: 'a plain name wrapped onto the next line',
            declaration: ['    name: Types and', '      contracts'],
            message: unresolvableJobField('continues its name onto the next line'),
        },
        {
            label: 'a double-quoted name wrapped onto the next line',
            declaration: ['    name: "Types and', '      contracts"'],
            message: unresolvableJobField('continues its name onto the next line'),
        },
        {
            label: 'a name that is only a comment',
            declaration: ['    name: # the type lane'],
            message: unresolvableJobField('declares a name that is only a comment'),
        },
    ])('refuses $label', ({ declaration, message }) => {
        const source = workflow(
            ['  static:', ...declaration, '    runs-on: ubuntu-latest'].join('\n'),
            gateNeeding('static')
        );

        let thrown: unknown;
        try {
            gateRequiredCheckNames(source);
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe(message);
    });

    /**
     * The single-line control: the same name written on one line resolves, so each refusal above
     * pins the wrapping rather than the name.
     */
    it('reads a job name that ends on the line it started on', () => {
        const source = workflow(
            ['  static:', '    name: Types and contracts', '    runs-on: ubuntu-latest'].join('\n'),
            gateNeeding('static')
        );

        expect([...gateRequiredCheckNames(source)]).toEqual(['Types and contracts']);
    });

    /**
     * Every one of these spells the same key GitHub reads as `name`, and a prefix test sees none of
     * them. The job then reads as declaring no name at all and the gating set takes the job id —
     * `static` where GitHub reports `Types and contracts`, which is a plausible enough name to
     * escape notice while matching no check on the head.
     */
    it.each([
        { label: 'a name key with space before its colon', declared: '    name : Types and contracts' },
        { label: 'a double-quoted name key', declared: '    "name": Types and contracts' },
        { label: 'a single-quoted name key', declared: "    'name': Types and contracts" },
    ])('refuses $label', ({ declared }) => {
        const source = workflow(
            ['  static:', declared, '    runs-on: ubuntu-latest'].join('\n'),
            gateNeeding('static')
        );

        let thrown: unknown;
        try {
            gateRequiredCheckNames(source);
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe(
            unresolvableJobField(`spells its name key as ${declared.trim().split(':')[0] ?? ''}:`)
        );
    });

    /**
     * `unit` and `e2e` are one line away from joining the gate, and GitHub reports one check per
     * shard with the expression substituted. The declared name matches none of them, so promoting
     * such a job silently adds an entry that can never fire.
     */
    it('refuses a matrix job promoted into the gate rather than gating on a name GitHub never reports', () => {
        const unit = [
            '  unit:',
            '    name: Unit suite ${{ matrix.shard }}/4',
            '    strategy:',
            '      matrix:',
            '        shard: [1, 2, 3, 4]',
        ].join('\n');

        let thrown: unknown;
        try {
            gateRequiredCheckNames(workflow(unit, gateNeeding('unit')));
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe(
            `Error: the unit job in ${WORKFLOW_PATH} names its check Unit suite \${{ matrix.shard }}/4, ` +
                'which GitHub substitutes per matrix job before reporting it'
        );
    });

    /**
     * A job that declares `name:` and leaves it empty is labelled with its job id, exactly as one
     * that declares no name at all.
     */
    it('labels a job declaring an empty name with its job id', () => {
        const lint = ['  lint:', '    name:', '    runs-on: ubuntu-latest'].join('\n');

        expect([...gateRequiredCheckNames(workflow(lint, gateNeeding('lint')))]).toEqual(['lint']);
    });

    /**
     * `jobs:` is not the last block in this workflow, and a top-level key that follows it is not a
     * job however it is spelled.
     */
    it('reads only the jobs block when another top-level key follows it', () => {
        const source = [
            workflow(decide, boundaries, dependencyReview, nightly, gate),
            'permissions:',
            '  contents: read',
        ].join('\n');

        expect([...gateRequiredCheckNames(source)].sort()).toEqual(['Decide scope', 'Dependency review', 'boundaries']);
    });

    it.each([
        {
            label: 'a workflow declaring no jobs',
            source: 'name: Health gates\non:\n  pull_request:\n',
            message: `Error: cannot read the jobs in ${WORKFLOW_PATH} to determine which checks gate the merge`,
        },
        {
            label: 'a jobs block that is not a mapping of job ids',
            source: workflow('  - decide', gate),
            message: `Error: cannot read the jobs in ${WORKFLOW_PATH} to determine which checks gate the merge`,
        },
        {
            label: 'a job field standing outside any job',
            source: workflow('    name: Orphan', gate),
            message: `Error: cannot read the jobs in ${WORKFLOW_PATH} to determine which checks gate the merge`,
        },
        {
            label: 'a needs list indented where this reader cannot place it',
            source: workflow(decide, ['  gate:', '    name: Gate', '    needs:', '        - decide'].join('\n')),
            message: `Error: the gate job in ${WORKFLOW_PATH} needs no job, so no check can be proven to gate the merge`,
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
            label: 'a gate job needing a job the workflow does not define',
            source: workflow(decide, ['  gate:', '    name: Gate', '    needs:', '      - typo'].join('\n')),
            message: `Error: the gate job in ${WORKFLOW_PATH} needs typo, which no job in that workflow defines`,
        },
    ])('refuses $label', ({ source, message }) => {
        let thrown: unknown;
        try {
            gateRequiredCheckNames(source);
        } catch (error) {
            thrown = error;
        }

        expect(String(thrown)).toBe(message);
    });

    type WorkflowRepository = { root: string; commits: string[] };

    function workflowRepository(committed: string[], workingTree?: string): WorkflowRepository {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-health-gates-'));
        const git = (...args: string[]): string =>
            execFileSync('git', ['-C', root, '-c', 'core.hooksPath=', ...args], { encoding: 'utf8', stdio: 'pipe' });
        git('init', '--quiet', '--initial-branch=main');
        git('config', 'user.email', 'lane@example.invalid');
        git('config', 'user.name', 'Lane');
        mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
        const commits = committed.map((source, index) => {
            writeFileSync(join(root, WORKFLOW_PATH), source, 'utf8');
            git('add', WORKFLOW_PATH);
            git('commit', '--quiet', '--no-verify', '-m', `health gates revision ${index}`);
            return git('rev-parse', 'HEAD').trim();
        });
        if (workingTree !== undefined) {
            writeFileSync(join(root, WORKFLOW_PATH), workingTree, 'utf8');
        }
        return { root, commits };
    }

    function pinned(commit: string): NodeJS.ProcessEnv {
        return { SOURDAW_TRUSTED_ORIGIN_COMMIT: commit };
    }

    const UNPINNED_GATE_REFUSAL =
        'Error: deliver must run through the protected primary checkout launcher, which pins ' +
        'SOURDAW_TRUSTED_ORIGIN_COMMIT to the commit that decides which checks gate the merge';

    /**
     * The workflow decides which checks gate an irreversible merge, so it is read as the git object
     * at the commit the launcher pinned rather than from the working tree beside it. A working-tree
     * file is not a pinned input: one stray uncommitted edit would reshape the gate for every
     * delivery, silently, in either direction. Here the working tree gates on one job and the
     * pinned commit on three.
     */
    it('reads the workflow at the pinned commit and not the working tree beside it', () => {
        const { root, commits } = workflowRepository(
            [workflow(decide, boundaries, dependencyReview, nightly, gate)],
            workflow(decide, ['  gate:', '    name: Gate', '    needs: decide'].join('\n'))
        );
        try {
            expect([...readGateRequiredCheckNames(root, undefined, pinned(commits[0] ?? ''))].sort()).toEqual([
                'Decide scope',
                'Dependency review',
                'boundaries',
            ]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    /**
     * `HEAD` is wherever the operator's local `main` happens to sit, and the launcher's pinned
     * `origin/main` is what the delivery closure itself is snapshotted from. A checkout that has
     * not pulled would otherwise read a superseded `needs` list and tolerate the cancellation of a
     * job promoted into the gate since. Here `HEAD` gates on one job and the pinned commit on three.
     */
    it('reads the workflow at the pinned commit and not at the checkout HEAD', () => {
        const { root, commits } = workflowRepository([
            workflow(decide, boundaries, dependencyReview, nightly, gate),
            workflow(decide, ['  gate:', '    name: Gate', '    needs: decide'].join('\n')),
        ]);
        try {
            expect([...readGateRequiredCheckNames(root, undefined, pinned(commits[0] ?? ''))].sort()).toEqual([
                'Decide scope',
                'Dependency review',
                'boundaries',
            ]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    /**
     * Without the pinned commit this gate cannot say which revision of the workflow decides the
     * merge, and a ref name is not that commit either: it resolves to whatever it points at now. A
     * gate that cannot name its own input refuses rather than falling back to a local one.
     */
    it.each([
        { label: 'no pinned origin commit', env: {} },
        { label: 'an unpinned ref where the pinned commit belongs', env: pinned('origin/main') },
        { label: 'a truncated commit', env: pinned('b2ec72d') },
    ])('refuses $label', ({ env }) => {
        const { root } = workflowRepository([workflow(decide, boundaries, dependencyReview, nightly, gate)]);
        let thrown: unknown;
        try {
            readGateRequiredCheckNames(root, undefined, env);
        } catch (error) {
            thrown = error;
        } finally {
            rmSync(root, { recursive: true, force: true });
        }

        expect(String(thrown)).toBe(UNPINNED_GATE_REFUSAL);
    });

    /**
     * An unreadable workflow leaves this gate unable to say which checks decide the merge, and a
     * gate that cannot work that out must refuse rather than tolerate every cancellation on the head.
     */
    it('refuses a repository whose health-gates workflow it cannot read', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-health-gates-'));
        let thrown: unknown;
        try {
            readGateRequiredCheckNames(root, undefined, pinned('0'.repeat(40)));
        } catch (error) {
            thrown = error;
        } finally {
            rmSync(root, { recursive: true, force: true });
        }

        expect(String(thrown)).toContain(
            `Error: cannot read ${WORKFLOW_PATH} to determine which checks gate the merge: `
        );
    });

    /**
     * The rollup on PR #2795 carried exactly two names cancelled with no success beside them:
     * `Dependency review`, which `Gate` needs, and `Nightly failure report`, which it does not.
     */
    it('gates on the dependency scan and not on the nightly report in this repository', () => {
        const root = join(import.meta.dirname, '../..');
        const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

        const names = readGateRequiredCheckNames(root, undefined, pinned(head));

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
                    return JSON.stringify(pullRequest());
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

        port.headCheckRuns(42, 'head');

        expect(rollupCaptures(captures)).toHaveLength(1);
    });

    /**
     * The gating workflow is read as a git object at the primary checkout this port was given, not
     * from whatever directory the process happens to run in, not from its working tree, and not at
     * its `HEAD` — at the `origin/main` commit the launcher pinned into the environment.
     */
    it('reads the gating workflow as a git object at the launcher-pinned commit', () => {
        vi.stubEnv('SOURDAW_TRUSTED_ORIGIN_COMMIT', 'a'.repeat(40));
        const captures: Array<{ command: string; args: string[] }> = [];
        const port = shellPort(
            'jcosta33/sourdaw',
            {
                capture: (command, args) => {
                    captures.push({ command, args });
                    return [
                        'name: Health gates',
                        'jobs:',
                        '  dependency-review:',
                        '    name: Dependency review',
                        '  gate:',
                        '    name: Gate',
                        '    needs: dependency-review',
                    ].join('\n');
                },
                run: () => undefined,
            },
            { repositoryRoot: '/primary/checkout' }
        );

        expect([...port.gateRequiredCheckNames()]).toEqual(['Dependency review']);
        expect(captures).toEqual([
            {
                command: 'git',
                args: ['-C', '/primary/checkout', 'show', `${'a'.repeat(40)}:.github/workflows/health-gates.yml`],
            },
        ]);
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
