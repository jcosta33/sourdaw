import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { canonicalJson } from '../canonicalRecord.ts';
import { renderConfirmationReply } from '../confirmReviewRepairs.ts';
import { AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import {
    pullRequestMutationLockRef,
    readPullRequestMutationLockOid,
    readPullRequestMutationLockOwner,
    withPullRequestMutationLock,
    type PullRequestMutationSerialization,
} from '../pullRequestMutationLock.ts';
import {
    parseRetirementRecord,
    renderRetirementMarker,
    retirementReviewBodyDigest,
    type RetirementRecord,
} from '../retirementRecord.ts';
import {
    inspectRetirementReviewState,
    parseRetirePullRequestArgs,
    retirePullRequest,
    retirementIsAncestor,
    serializedRetirePullRequest,
    type RetirePullRequestPort,
    type RetirementReviewState,
} from '../retirePullRequest.ts';
import { renderReviewRepairReply, type ReviewRepairRecord } from '../reviewRepair.ts';
import {
    commentClientMutationId,
    shellPort,
    type IssueComment,
    type SupersededPullRequest,
} from '../supersedePullRequestGh.ts';

const pr = 5361;
const head = 'a'.repeat(40);
const findingId = '1001';
const reviewId = 'PRR_requested';
const threadId = 'PRRT_1';
const repairId = '1002';
const confirmationId = '1003';
const repair: ReviewRepairRecord = {
    format: 'repair-v1',
    pr,
    thread: threadId,
    finding: { commentId: Number(findingId), path: 'scripts/test-health-gate-scripts.sh', line: 237, side: 'RIGHT' },
    commit: head,
    summary: 'Corrected the audit note.',
    evidence: [],
    head,
};
const record: RetirementRecord = {
    format: 'retirement-v1',
    pr,
    head,
    base: 'main',
    rationale: 'The obsolete source branch was retired; the unsuppressed hosted scan now passes.',
    evidence: [
        {
            url: 'https://github.com/jcosta33/sourdaw/actions/runs/39926416970',
            observation: 'Scheduled scan detected its positive control and found no real target leak.',
        },
    ],
    findings: [
        {
            rootCommentId: findingId,
            threadId,
            authorRepairCommentId: repairId,
            reviewerConfirmationCommentId: confirmationId,
        },
    ],
    reviewBodies: [
        { reviewId, bodyDigest: retirementReviewBodyDigest('One audit fact is wrong.'), rootCommentIds: [findingId] },
    ],
};

function comment(id: string, body: string, authorNodeId: string): IssueComment {
    return {
        id: `IC_${id}`,
        fullDatabaseId: id,
        body,
        authorNodeId,
        authorLogin: 'bot[bot]',
        authorType: 'Bot',
    };
}

function reviewState(): RetirementReviewState {
    return {
        threads: [
            {
                threadId,
                rootCommentId: findingId,
                rootReviewId: reviewId,
                resolved: true,
                replies: [
                    { id: repairId, body: renderReviewRepairReply(repair), authorNodeId: AUTHOR_BOT_NODE_ID },
                    {
                        id: confirmationId,
                        body: renderConfirmationReply(repair, head),
                        authorNodeId: REVIEWER_BOT_NODE_ID,
                    },
                ],
            },
        ],
        requestedReviews: [{ reviewId, body: 'One audit fact is wrong.', head }],
    };
}

function providerProjection(state: RetirementReviewState = reviewState()) {
    return {
        data: {
            repository: {
                nameWithOwner: 'jcosta33/sourdaw',
                pullRequest: {
                    number: pr,
                    reviewThreads: {
                        nodes: state.threads.map((thread) => ({
                            id: thread.threadId,
                            isResolved: thread.resolved,
                            comments: {
                                nodes: [
                                    {
                                        databaseId: Number(thread.rootCommentId),
                                        pullRequestReview: { id: thread.rootReviewId },
                                    },
                                    ...thread.replies.map((reply) => {
                                        if (reply.authorNodeId === null) {
                                            return { databaseId: Number(reply.id), body: reply.body, author: null };
                                        }
                                        return {
                                            databaseId: Number(reply.id),
                                            body: reply.body,
                                            author: { __typename: 'Bot', id: reply.authorNodeId },
                                        };
                                    }),
                                ],
                                pageInfo: { hasNextPage: false },
                            },
                        })),
                        pageInfo: { hasNextPage: false },
                    },
                    reviews: {
                        nodes: state.requestedReviews.map((review) => ({
                            id: review.reviewId,
                            state: 'CHANGES_REQUESTED',
                            body: review.body,
                            commit: { oid: review.head },
                        })),
                        pageInfo: { hasNextPage: false },
                    },
                },
            },
        },
    };
}

type FixtureOptions = {
    head?: string;
    headRepository?: string | null;
    base?: string;
    reviewState?: RetirementReviewState;
    afterCommentReviewState?: RetirementReviewState;
    closeError?: boolean;
    closeMovesHead?: boolean;
};

function fixture(options: FixtureOptions = {}) {
    const calls: string[] = [];
    let state = 'OPEN';
    let closedAt: string | null = null;
    let currentHead = options.head ?? head;
    let comments: IssueComment[] = [];
    let commentPosted = false;
    const inspect = (): SupersededPullRequest => ({
        number: pr,
        state,
        head: currentHead,
        headRefName: 'agent/4944/nightly-secret-scan-bacteria-fingerprint',
        headRepository: options.headRepository === undefined ? 'jcosta33/sourdaw' : options.headRepository,
        repository: 'jcosta33/sourdaw',
        base: options.base ?? 'main',
        merged: false,
        closedAt,
        comments: [...comments],
    });
    const port: RetirePullRequestPort = {
        inspect: () => inspect(),
        assertCurrentPullRequest: () => undefined,
        isAncestor: (commit, target) => commit === target,
        inspectReviewThreads: () => [],
        inspectRetirementReviewState: () => {
            calls.push('reviews');
            if (commentPosted) {
                return options.afterCommentReviewState ?? options.reviewState ?? reviewState();
            }
            return options.reviewState ?? reviewState();
        },
        comment: (_number, body) => {
            calls.push('comment');
            commentPosted = true;
            const created = comment('2001', body, AUTHOR_BOT_NODE_ID);
            comments.push(created);
            return { ...created, clientMutationId: commentClientMutationId(pr, body) };
        },
        close: () => {
            calls.push('close');
            if (options.closeError) {
                throw new Error('close transport lost');
            }
            state = 'CLOSED';
            closedAt = '2026-10-24T00:00:00Z';
            if (options.closeMovesHead) {
                currentHead = 'b'.repeat(40);
            }
            return { closedAt };
        },
        deleteComment: (id) => {
            calls.push('delete');
            comments = comments.filter((entry) => entry.id !== id);
        },
        log: (message) => calls.push(message),
    };
    return { calls, port, state: () => inspect() };
}

async function withLockRoot(operation: (root: string) => Promise<void>): Promise<void> {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-retirement-lock-'));
    vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('GIT_TRACE2_EVENT', '0');
    try {
        execFileSync('git', ['init', '--quiet'], { cwd: root });
        await operation(root);
    } finally {
        vi.unstubAllEnvs();
        rmSync(root, { recursive: true, force: true });
    }
}

const serializeFixture: PullRequestMutationSerialization = (root, number, operation) =>
    withPullRequestMutationLock(root, number, operation, {
        ownerFence: { kind: 'pid', pid: process.pid, startedAt: 'retirement-fixture-process' },
    });

function runSerialized(root: string, port: RetirePullRequestPort) {
    return serializedRetirePullRequest(root, pr, head, record, AUTHOR_BOT_NODE_ID, port, serializeFixture);
}

function ownerOid(root: string): string | undefined {
    return readPullRequestMutationLockOid(root, pullRequestMutationLockRef(pr), pr);
}

function nativeClosureFixture(root: string, moveAtCommentRead?: number, closeError = false) {
    let currentHead = head;
    let state = 'OPEN';
    let closedAt: string | null = null;
    let comments: IssueComment[] = [];
    let commentReads = 0;
    let moveAt = moveAtCommentRead;
    let damage: ((value: ReturnType<typeof core>) => unknown) | undefined;
    const events: string[] = [];
    const core = () => ({
        data: {
            repository: {
                nameWithOwner: 'jcosta33/sourdaw',
                pullRequest: {
                    id: 'PR_retire',
                    number: pr,
                    state,
                    headRefOid: currentHead,
                    headRefName: 'fix/retire',
                    headRepository: { nameWithOwner: 'jcosta33/sourdaw' },
                    baseRefName: 'main',
                    baseRefOid: head,
                    baseRef: null,
                    merged: false,
                    closedAt,
                },
            },
        },
    });
    const capture = (command: string, args: string[]): string => {
        if (command === 'git') {
            return join(root, '.git');
        }
        const query = args.find((arg) => arg.startsWith('query=')) ?? '';
        if (query.includes('reviewThreads(first:100)')) {
            events.push('reviews');
            return JSON.stringify(providerProjection());
        }
        if (query.includes('headRefOid')) {
            const preceding = events.at(-1);
            events.push('core');
            if (damage !== undefined && preceding === 'reviews' && commentReads === 4) {
                const apply = damage;
                damage = undefined;
                return JSON.stringify(apply(core()));
            }
            return JSON.stringify(core());
        }
        if (query.includes('node(id:$subjectId)')) {
            events.push('comments');
            commentReads += 1;
            if (commentReads === moveAt) {
                currentHead = 'b'.repeat(40);
            }
            return JSON.stringify({
                data: {
                    node: {
                        id: 'PR_retire',
                        comments: {
                            nodes: comments.map((entry) => ({
                                id: entry.id,
                                fullDatabaseId: entry.fullDatabaseId,
                                body: entry.body,
                                author: {
                                    id: entry.authorNodeId,
                                    login: entry.authorLogin,
                                    __typename: entry.authorType,
                                },
                            })),
                            pageInfo: { hasNextPage: false, endCursor: null },
                        },
                    },
                },
            });
        }
        const field = (name: string) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
        if (query.includes('addComment(input:')) {
            events.push('comment');
            const entry = comment('2001', field('body'), AUTHOR_BOT_NODE_ID);
            comments.push(entry);
            return JSON.stringify({
                data: {
                    addComment: {
                        clientMutationId: field('clientMutationId'),
                        commentEdge: {
                            node: {
                                ...entry,
                                author: { id: AUTHOR_BOT_NODE_ID, __typename: 'Bot', login: 'author[bot]' },
                            },
                        },
                    },
                },
            });
        }
        if (query.includes('deleteIssueComment(input:')) {
            events.push('delete');
            comments = comments.filter((entry) => entry.id !== field('id'));
            return JSON.stringify({ data: { deleteIssueComment: { clientMutationId: field('clientMutationId') } } });
        }
        if (query.includes('closePullRequest(input:')) {
            events.push('close');
            if (closeError) {
                throw new Error('native close transport lost');
            }
            state = 'CLOSED';
            closedAt = '2026-10-24T00:00:00Z';
            return JSON.stringify({
                data: {
                    closePullRequest: {
                        clientMutationId: field('clientMutationId'),
                        pullRequest: { id: 'PR_retire', state, closedAt },
                    },
                },
            });
        }
        throw new Error(`unexpected native provider query: ${query}`);
    };
    const native = shellPort({ configDir: root, env: {}, dispose: () => undefined }, root, capture);
    const port: RetirePullRequestPort = {
        ...native,
        inspectRetirementReviewState: () => inspectRetirementReviewState(pr, (args) => capture('gh', args)),
        isAncestor: (commit, target) => commit === target,
        log: (message) => events.push(message),
    };
    return {
        port,
        events,
        comments: () => comments,
        state: () => state,
        moveOnReplay: () => {
            moveAt = commentReads + 2;
        },
        damageWitness: (apply: NonNullable<typeof damage>) => {
            damage = apply;
        },
    };
}

describe('native obsolete pull-request retirement', () => {
    it('keeps the actual native inspection and close adapters valid on a stable head', async () => {
        await withLockRoot(async (root) => {
            const current = nativeClosureFixture(root);
            await expect(runSerialized(root, current.port)).resolves.toBe('pull-request-retired:5361');
            await expect(runSerialized(root, current.port)).resolves.toBe('pull-request-retired:5361');
            expect(current.events.filter((event) => event === 'close')).toHaveLength(1);
            const closeIndex = current.events.indexOf('close');
            expect(current.events.slice(closeIndex - 2, closeIndex + 1)).toEqual(['reviews', 'core', 'close']);
            expect(current.comments()).toHaveLength(1);
        });
    });

    it('refuses before native close when the final comment response follows a moved head', async () => {
        await withLockRoot(async (root) => {
            const current = nativeClosureFixture(root, 4);
            await expect(runSerialized(root, current.port)).rejects.toThrow();
            expect(current.events).not.toContain('close');
            expect(current.state()).toBe('OPEN');
        });
    });

    it('refuses native CLOSED replay when its final comment response follows a moved head', async () => {
        await withLockRoot(async (root) => {
            const current = nativeClosureFixture(root);
            await runSerialized(root, current.port);
            current.moveOnReplay();
            const before = current.events.filter((event) => ['comment', 'delete', 'close'].includes(event));
            await expect(runSerialized(root, current.port)).rejects.toThrow();
            expect(current.events.filter((event) => ['comment', 'delete', 'close'].includes(event))).toEqual(before);
        });
    });

    it.each<[string, Parameters<ReturnType<typeof nativeClosureFixture>['damageWitness']>[0]]>([
        [
            'wrong repository',
            (value) => {
                value.data.repository.nameWithOwner = 'other/repository';
                return value;
            },
        ],
        [
            'wrong PR',
            (value) => {
                value.data.repository.pullRequest.number = pr + 1;
                return value;
            },
        ],
        [
            'changed node ID',
            (value) => {
                value.data.repository.pullRequest.id = 'PR_other';
                return value;
            },
        ],
        [
            'missing core',
            (value) => {
                Reflect.deleteProperty(value.data.repository, 'pullRequest');
                return value;
            },
        ],
        [
            'missing head',
            (value) => {
                Reflect.deleteProperty(value.data.repository.pullRequest, 'headRefOid');
                return value;
            },
        ],
        [
            'malformed head',
            (value) => {
                value.data.repository.pullRequest.headRefOid = 'invalid';
                return value;
            },
        ],
        [
            'moved base',
            (value) => {
                value.data.repository.pullRequest.baseRefName = 'other-base';
                return value;
            },
        ],
        [
            'moved source',
            (value) => {
                value.data.repository.pullRequest.headRepository.nameWithOwner = 'other/source';
                return value;
            },
        ],
        ['malformed envelope', () => ({ errors: [{ message: 'partial core response' }] })],
    ])('refuses a %s final core witness before the real close adapter runs', async (_label, damage) => {
        await withLockRoot(async (root) => {
            const current = nativeClosureFixture(root);
            current.damageWitness(damage);
            await expect(runSerialized(root, current.port)).rejects.toThrow();
            expect(current.events).not.toContain('close');
            expect(current.state()).toBe('OPEN');
        });
    });

    it('preserves native marker and journal after an ambiguous real close result', async () => {
        await withLockRoot(async (root) => {
            const current = nativeClosureFixture(root, undefined, true);
            await expect(runSerialized(root, current.port)).rejects.toThrow(/native close transport lost/u);
            expect(current.events.filter((event) => event === 'close')).toHaveLength(1);
            expect(current.events).not.toContain('delete');
            expect(current.comments()).toHaveLength(1);
            const oid = ownerOid(root);
            expect(oid).toBeDefined();
            expect(readPullRequestMutationLockOwner(root, oid!, pr)).toMatchObject({
                mutation: { phase: 'remote-mutation-attempted' },
            });
        });
    });

    it('retains native closure evidence if the head moves inside the post-close comment response', async () => {
        await withLockRoot(async (root) => {
            const current = nativeClosureFixture(root, 5);
            await expect(runSerialized(root, current.port)).rejects.toThrow(/core identity/u);
            expect(current.events.filter((event) => event === 'close')).toHaveLength(1);
            expect(current.events).not.toContain('delete');
            expect(current.comments()).toHaveLength(1);
            expect(ownerOid(root)).toBeDefined();
        });
    });
    it.each(['OPEN', 'CLOSED'] as const)('refuses a fractured thread/review projection on an %s PR', (state) => {
        const current = fixture();
        if (state === 'CLOSED') {
            retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, current.port);
        }
        const first = reviewState();
        first.requestedReviews[0]!.body += ' A later body blocker.';
        const second = reviewState();
        second.threads[0]!.resolved = false;
        let providerCalls = 0;
        current.port.inspectRetirementReviewState = () =>
            inspectRetirementReviewState(pr, () => {
                providerCalls += 1;
                if (providerCalls % 2 === 1) {
                    return JSON.stringify(providerProjection(first));
                }
                return JSON.stringify(providerProjection(second));
            });
        const writes = current.calls.filter((call) => ['comment', 'delete', 'close'].includes(call));
        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, current.port)).toThrow();
        expect(current.calls.filter((call) => ['comment', 'delete', 'close'].includes(call))).toEqual(writes);
        expect(providerCalls).toBe(1);
    });

    it('reads both complete authority connections from one provider response', () => {
        const calls: string[][] = [];
        expect(
            inspectRetirementReviewState(pr, (args) => {
                calls.push(args);
                return JSON.stringify(providerProjection());
            })
        ).toEqual(reviewState());
        expect(calls).toHaveLength(1);
        const query = calls[0]!.find((arg) => arg.startsWith('query='));
        expect(query).toContain('reviewThreads(first:100)');
        expect(query).toContain('reviews(first:100,states:[CHANGES_REQUESTED])');
        expect(query).toContain('comments(first:100)');
    });

    it('keeps plain deleted-author and foreign replies eligible in a complete provider response', () => {
        const response = providerProjection();
        const comments = response.data.repository.pullRequest.reviewThreads.nodes[0]!.comments.nodes;
        comments.push({ databaseId: 1004, body: 'Plain deleted-author reply.', author: null });
        comments.push({
            databaseId: 1005,
            body: 'Plain foreign reply.',
            author: { __typename: 'User', id: 'USER_foreign' },
        });
        const current = fixture();
        current.port.inspectRetirementReviewState = () =>
            inspectRetirementReviewState(pr, () => JSON.stringify(response));
        expect(retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, current.port)).toBe('pull-request-retired:5361');
        expect(current.state().state).toBe('CLOSED');
    });

    it.each<[string, (response: ReturnType<typeof providerProjection>) => void]>([
        [
            'missing threads',
            (response) => {
                Reflect.deleteProperty(response.data.repository.pullRequest, 'reviewThreads');
            },
        ],
        [
            'missing reviews',
            (response) => {
                Reflect.deleteProperty(response.data.repository.pullRequest, 'reviews');
            },
        ],
        [
            'truncated threads',
            (response) => {
                response.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage = true;
            },
        ],
        [
            'truncated reviews',
            (response) => {
                response.data.repository.pullRequest.reviews.pageInfo.hasNextPage = true;
            },
        ],
        [
            'missing thread page info',
            (response) => {
                Reflect.deleteProperty(response.data.repository.pullRequest.reviewThreads, 'pageInfo');
            },
        ],
        [
            'invalid review page info',
            (response) => {
                Object.assign(response.data.repository.pullRequest.reviews.pageInfo, { hasNextPage: 'false' });
            },
        ],
        [
            'invalid thread nodes',
            (response) => {
                Object.assign(response.data.repository.pullRequest.reviewThreads, { nodes: null });
            },
        ],
        [
            'invalid review nodes',
            (response) => {
                Object.assign(response.data.repository.pullRequest.reviews, { nodes: null });
            },
        ],
        [
            'truncated nested comments',
            (response) => {
                response.data.repository.pullRequest.reviewThreads.nodes[0]!.comments.pageInfo.hasNextPage = true;
            },
        ],
        [
            'missing nested comments',
            (response) => {
                Reflect.deleteProperty(response.data.repository.pullRequest.reviewThreads.nodes[0]!, 'comments');
            },
        ],
        [
            'missing comment page info',
            (response) => {
                Reflect.deleteProperty(
                    response.data.repository.pullRequest.reviewThreads.nodes[0]!.comments,
                    'pageInfo'
                );
            },
        ],
        [
            'empty comment roots',
            (response) => {
                response.data.repository.pullRequest.reviewThreads.nodes[0]!.comments.nodes = [];
            },
        ],
        [
            'oversized nested comments',
            (response) => {
                const comments = response.data.repository.pullRequest.reviewThreads.nodes[0]!.comments;
                comments.nodes = Array.from({ length: 101 }, () => comments.nodes[0]!);
            },
        ],
        [
            'invalid thread node',
            (response) => {
                Object.assign(response.data.repository.pullRequest.reviewThreads.nodes, { 0: null });
            },
        ],
        [
            'invalid requested review node',
            (response) => {
                Object.assign(response.data.repository.pullRequest.reviews.nodes, { 0: null });
            },
        ],
        [
            'missing review commit',
            (response) => {
                Reflect.deleteProperty(response.data.repository.pullRequest.reviews.nodes[0]!, 'commit');
            },
        ],
        [
            'invalid extra reply actor',
            (response) => {
                response.data.repository.pullRequest.reviewThreads.nodes[0]!.comments.nodes.push({
                    databaseId: 1004,
                    body: 'Plain extra reply.',
                    author: null,
                });
                Object.assign(response.data.repository.pullRequest.reviewThreads.nodes[0]!.comments.nodes[3]!, {
                    author: false,
                });
            },
        ],
        [
            'unexpected review state',
            (response) => {
                response.data.repository.pullRequest.reviews.nodes[0]!.state = 'APPROVED';
            },
        ],
        [
            'unsupported query',
            (response) => {
                Object.assign(response, { errors: [{ message: 'unsupported query' }] });
            },
        ],
    ])('refuses %s in the single provider response before writes', (_label, damage) => {
        const response = providerProjection();
        damage(response);
        const current = fixture();
        let providerCalls = 0;
        current.port.inspectRetirementReviewState = () =>
            inspectRetirementReviewState(pr, () => {
                providerCalls += 1;
                return JSON.stringify(response);
            });
        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, current.port)).toThrow();
        expect(current.calls.filter((call) => ['comment', 'delete', 'close'].includes(call))).toEqual([]);
        expect(providerCalls).toBe(1);
    });

    it('refuses malformed provider JSON before writes without another provider call', () => {
        const current = fixture();
        let providerCalls = 0;
        current.port.inspectRetirementReviewState = () =>
            inspectRetirementReviewState(pr, () => {
                providerCalls += 1;
                return '{invalid';
            });
        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, current.port)).toThrow();
        expect(current.calls.filter((call) => ['comment', 'delete', 'close'].includes(call))).toEqual([]);
        expect(providerCalls).toBe(1);
    });
    it('reproduces the missing native path by requiring a confirmed-repair record to close exactly once', () => {
        const { calls, port, state } = fixture();

        expect(retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toBe('pull-request-retired:5361');
        expect(state().state).toBe('CLOSED');
        expect(state().comments).toHaveLength(1);
        expect(state().comments[0]?.body).toBe(renderRetirementMarker(record));
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual(['comment', 'close']);

        expect(retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toBe('pull-request-retired:5361');
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual(['comment', 'close']);
    });

    const refusalCases: [string, string, RetirementRecord, RetirementReviewState, string, string][] = [
        ['wrong actor', REVIEWER_BOT_NODE_ID, record, reviewState(), head, 'main'],
        ['moved head', AUTHOR_BOT_NODE_ID, record, reviewState(), 'b'.repeat(40), 'main'],
        ['moved base', AUTHOR_BOT_NODE_ID, record, reviewState(), head, 'other'],
        [
            'unresolved root',
            AUTHOR_BOT_NODE_ID,
            record,
            { ...reviewState(), threads: [{ ...reviewState().threads[0]!, resolved: false }] },
            head,
            'main',
        ],
        ['missing root', AUTHOR_BOT_NODE_ID, record, { ...reviewState(), threads: [] }, head, 'main'],
        [
            'unmapped body review',
            AUTHOR_BOT_NODE_ID,
            record,
            { ...reviewState(), requestedReviews: [{ reviewId: 'PRR_other', body: 'An additional issue.', head }] },
            head,
            'main',
        ],
    ];

    it.each(refusalCases)('refuses %s before any remote write', (_label, actor, input, reviews, actualHead, base) => {
        const { calls, port } = fixture({ head: actualHead, base, reviewState: reviews });

        expect(() => retirePullRequest(pr, head, input, actor, port)).toThrow();
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual([]);
    });

    it('refuses a reviewer confirmation whose record digest differs from the author repair', () => {
        const changed = { ...repair, summary: 'Different repair.' };
        const reviews = reviewState();
        reviews.threads[0]!.replies[1] = {
            id: confirmationId,
            body: renderConfirmationReply(changed, head),
            authorNodeId: REVIEWER_BOT_NODE_ID,
        };
        const { calls, port } = fixture({ reviewState: reviews });

        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow();
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual([]);
    });

    it.each(['unconfirmed author record', 'duplicate reviewer confirmation'] as const)(
        'refuses a caller-selected pair that hides another %s',
        (extra) => {
            const reviews = reviewState();
            if (extra === 'unconfirmed author record') {
                reviews.threads[0]!.replies.push({
                    id: '1004',
                    body: renderReviewRepairReply({ ...repair, summary: 'A second distinct repair claim.' }),
                    authorNodeId: AUTHOR_BOT_NODE_ID,
                });
            } else {
                reviews.threads[0]!.replies.push({
                    id: '1004',
                    body: renderConfirmationReply(repair, head),
                    authorNodeId: REVIEWER_BOT_NODE_ID,
                });
            }
            const { calls, port, state } = fixture({ reviewState: reviews });

            expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow();
            expect(state()).toMatchObject({ state: 'OPEN', comments: [] });
            expect(calls.filter((call) => ['comment', 'delete', 'close'].includes(call))).toEqual([]);
        }
    );

    it.each(['head', 'marker'] as const)(
        'refuses closed replay %s movement during its review proof',
        async (movement) => {
            await withLockRoot(async (root) => {
                const current = fixture();
                await runSerialized(root, current.port);
                const inspect = current.port.inspect;
                let moved = false;
                current.port.inspectRetirementReviewState = () => {
                    moved = true;
                    return reviewState();
                };
                current.port.inspect = (number) => {
                    const snapshot = inspect(number);
                    if (!moved) {
                        return snapshot;
                    }
                    if (movement === 'head') {
                        return { ...snapshot, head: 'b'.repeat(40) };
                    }
                    return {
                        ...snapshot,
                        comments: snapshot.comments.map((entry) => ({
                            ...entry,
                            id: 'IC_replacement',
                            fullDatabaseId: '2002',
                        })),
                    };
                };
                const before = [...current.calls];

                await expect(runSerialized(root, current.port)).rejects.toThrow();
                expect(current.calls).toEqual(before);
                expect(ownerOid(root)).toBeUndefined();
            });
        }
    );

    it('retains the owner when acknowledged created markers disappear only from subsequent observations', async () => {
        await withLockRoot(async (root) => {
            const current = fixture();
            const inspect = current.port.inspect;
            current.port.inspect = (number) => ({ ...inspect(number), comments: [] });
            const attempt = runSerialized(root, current.port);

            await expect(attempt).rejects.toThrow(/preserved lock owner/u);
            expect(current.state()).toMatchObject({ state: 'OPEN' });
            expect(current.state().comments).toHaveLength(1);
            expect(current.calls).not.toContain('delete');
            expect(current.calls).not.toContain('close');
            const oid = ownerOid(root);
            expect(oid).toBeDefined();
            expect(readPullRequestMutationLockOwner(root, oid!, pr)).toMatchObject({
                version: 4,
                operation: 'delivery',
                mutation: { phase: 'remote-mutation-attempted' },
            });
            await expect(attempt).rejects.toThrow(`pnpm deliver --recover-lock ${pr} --owner ${oid}`);
        });
    });

    it.each(['compact', 'legacy'] as const)(
        'keeps whole-thread %s replay compatible with superseded repairs and unrelated replies',
        (kind) => {
            const reviews = reviewState();
            const olderHead = 'b'.repeat(40);
            reviews.threads[0]!.replies.unshift({
                id: '999',
                body: renderReviewRepairReply({ ...repair, head: olderHead }),
                authorNodeId: AUTHOR_BOT_NODE_ID,
            });
            reviews.threads[0]!.replies.push(
                { id: '1004', body: 'Unrelated discussion.', authorNodeId: AUTHOR_BOT_NODE_ID },
                { id: '1005', body: 'Unrelated reviewer discussion.', authorNodeId: REVIEWER_BOT_NODE_ID },
                { id: '1006', body: 'sourdaw-repair-v1 malformed foreign marker', authorNodeId: 'BOT_foreign' }
            );
            if (kind === 'legacy') {
                reviews.threads[0]!.replies[2]!.body = renderReviewRepairReply(repair);
            }
            const { calls, port, state } = fixture({ reviewState: reviews });
            port.isAncestor = (commit, target) => commit === target || (commit === olderHead && target === head);

            expect(retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toBe('pull-request-retired:5361');
            expect(state().state).toBe('CLOSED');
            const writes = calls.filter((call) => ['comment', 'delete', 'close'].includes(call));
            expect(retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toBe('pull-request-retired:5361');
            expect(calls.filter((call) => ['comment', 'delete', 'close'].includes(call))).toEqual(writes);
        }
    );

    it('requires caller IDs to name the native authoritative repair after identical duplicate replies', () => {
        const reviews = reviewState();
        reviews.threads[0]!.replies.splice(1, 0, {
            id: '1004',
            body: renderReviewRepairReply(repair),
            authorNodeId: AUTHOR_BOT_NODE_ID,
        });
        const input = {
            ...record,
            findings: [
                { ...record.findings[0]!, authorRepairCommentId: '1004', reviewerConfirmationCommentId: '1005' },
            ],
        };
        reviews.threads[0]!.replies[2]!.id = '1005';
        const { port, calls } = fixture({ reviewState: reviews });

        expect(() => retirePullRequest(pr, head, input, AUTHOR_BOT_NODE_ID, port)).toThrow(/authoritative/u);
        expect(calls.filter((call) => ['comment', 'delete', 'close'].includes(call))).toEqual([]);
    });

    it('keeps confirmed roots from non-requested reviews alongside the separately total requested-body map', () => {
        const reviews = reviewState();
        const otherRepair = { ...repair, thread: 'PRRT_other', finding: { ...repair.finding, commentId: 1007 } };
        reviews.threads.push({
            threadId: 'PRRT_other',
            rootCommentId: '1007',
            rootReviewId: 'PRR_comment',
            resolved: true,
            replies: [
                { id: '1008', body: renderReviewRepairReply(otherRepair), authorNodeId: AUTHOR_BOT_NODE_ID },
                { id: '1009', body: renderConfirmationReply(otherRepair), authorNodeId: REVIEWER_BOT_NODE_ID },
            ],
        });
        const input = {
            ...record,
            findings: [
                ...record.findings,
                {
                    rootCommentId: '1007',
                    threadId: 'PRRT_other',
                    authorRepairCommentId: '1008',
                    reviewerConfirmationCommentId: '1009',
                },
            ],
        };
        const { port, state } = fixture({ reviewState: reviews });
        expect(retirePullRequest(pr, head, input, AUTHOR_BOT_NODE_ID, port)).toBe('pull-request-retired:5361');
        expect(state().state).toBe('CLOSED');
    });

    it('uses exact-head comparison for older author selection and refuses unavailable ancestry', () => {
        const calls: string[][] = [];
        const olderHead = 'b'.repeat(40);
        expect(
            retirementIsAncestor(head, head, () => {
                throw new Error('no comparison needed');
            })
        ).toBe(true);
        for (const status of ['ahead', 'identical', 'behind', 'diverged']) {
            expect(
                retirementIsAncestor(olderHead, head, (args) => {
                    calls.push(args);
                    return status;
                })
            ).toBe(['ahead', 'identical'].includes(status));
        }
        expect(calls[0]).toEqual(['api', `repos/jcosta33/sourdaw/compare/${olderHead}...${head}`, '--jq', '.status']);
        expect(() => retirementIsAncestor(olderHead, head, () => 'unknown')).toThrow(/ancestry/u);
        expect(() => retirementIsAncestor('invalid', head, () => 'ahead')).toThrow(/SHAs/u);
    });

    it('refuses a confirmation that predates the selected repair before any mutation', () => {
        const reviews = reviewState();
        reviews.threads[0]!.replies[0]!.id = '1003';
        reviews.threads[0]!.replies[1]!.id = '1002';
        const input = {
            ...record,
            findings: [
                { ...record.findings[0]!, authorRepairCommentId: '1003', reviewerConfirmationCommentId: '1002' },
            ],
        };
        const { calls, port, state } = fixture({ reviewState: reviews });

        expect(() => retirePullRequest(pr, head, input, AUTHOR_BOT_NODE_ID, port)).toThrow(/confirmation.*repair/u);
        expect(state()).toMatchObject({ state: 'OPEN', comments: [] });
        expect(calls.filter((call) => ['comment', 'delete', 'close'].includes(call))).toEqual([]);
    });

    it.each(['initial', 'prewrite', 'preclose', 'postclose', 'closed replay'] as const)(
        'refuses same-ID review-body edits at %s proof',
        (phase) => {
            const { calls, port, state } = fixture();
            if (phase === 'closed replay') {
                retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port);
            }
            let reads = 0;
            const editAt = { initial: 1, prewrite: 2, preclose: 3, postclose: 4, 'closed replay': 1 }[phase];
            port.inspectRetirementReviewState = () => {
                const reviews = reviewState();
                if (++reads >= editAt) {
                    reviews.requestedReviews[0]!.body += ' A new independent blocker.';
                }
                return reviews;
            };
            const beforeWrites = calls.filter((call) => ['comment', 'delete', 'close'].includes(call));

            expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow(/review.*body/u);
            const writes = calls.filter((call) => ['comment', 'delete', 'close'].includes(call));
            if (phase === 'initial' || phase === 'prewrite' || phase === 'closed replay') {
                expect(writes).toEqual(beforeWrites);
            } else if (phase === 'preclose') {
                expect(writes).toEqual(['comment', 'delete']);
                expect(state()).toMatchObject({ state: 'OPEN', comments: [] });
            } else {
                expect(writes).toEqual(['comment', 'close']);
                expect(state().state).toBe('CLOSED');
                expect(state().comments).toHaveLength(1);
            }
        }
    );

    it.each([null, 'fork-owner/sourdaw'])('refuses a %s source repository before any write', (headRepository) => {
        const { calls, port } = fixture({ headRepository });
        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow();
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual([]);
    });

    it('refuses a retirement with no confirmed finding or requested review', () => {
        const { calls, port } = fixture({ reviewState: { threads: [], requestedReviews: [] } });
        expect(() =>
            retirePullRequest(pr, head, { ...record, findings: [], reviewBodies: [] }, AUTHOR_BOT_NODE_ID, port)
        ).toThrow();
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual([]);
    });

    it('compensates a newly posted marker when the review-root set changes before close', () => {
        const changed = reviewState();
        changed.threads.push({ ...changed.threads[0]!, threadId: 'PRRT_new', rootCommentId: '1004' });
        const { calls, port, state } = fixture({ afterCommentReviewState: changed });

        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow();
        expect(state().state).toBe('OPEN');
        expect(state().comments).toEqual([]);
        expect(calls.filter((call) => call === 'comment' || call === 'close' || call === 'delete')).toEqual([
            'comment',
            'delete',
        ]);
    });

    it('preserves the exact marker and refuses success when close transport is ambiguous', () => {
        const { calls, port, state } = fixture({ closeError: true });

        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow(/close transport lost/u);
        expect(state().comments).toHaveLength(1);
        expect(calls).not.toContain('delete');
    });

    it('refuses post-close head movement and preserves the marker for investigation', () => {
        const { calls, port, state } = fixture({ closeMovesHead: true });
        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow();
        expect(state().state).toBe('CLOSED');
        expect(state().comments).toHaveLength(1);
        expect(calls).not.toContain('delete');
    });

    it('refuses closure if its sole marker disappears at the last PR proof', () => {
        const { calls, port, state } = fixture();
        const inspect = port.inspect;
        let reads = 0;
        port.inspect = (number) => {
            if (++reads === 4) {
                port.deleteComment('IC_2001');
            }
            return inspect(number);
        };

        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow(/marker/u);
        expect(calls).not.toContain('close');
        expect(state()).toMatchObject({ state: 'OPEN', comments: [] });
    });

    it('rejects malformed, duplicate-key and credential-shaped records before publication', () => {
        expect(() => parseRetirementRecord('{"format":"retirement-v1","format":"retirement-v1"}')).toThrow();
        expect(() => parseRetirementRecord(JSON.stringify({ ...record, rationale: 'Bearer abc123' }))).toThrow();
    });

    it.each(['initial', 'closed replay'] as const)('refuses unbound historical review bodies on %s', (phase) => {
        const { calls, port, state } = fixture();
        if (phase === 'closed replay') {
            retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port);
        }
        const historical = { ...record, reviewBodies: [{ reviewId, rootCommentIds: [findingId] }] };
        const before = state();
        const writes = [...calls];
        expect(() => parseRetirementRecord(canonicalJson(historical))).toThrow(/missing or unexpected fields/u);
        expect(() =>
            retirePullRequest(pr, head, parseRetirementRecord(canonicalJson(historical)), AUTHOR_BOT_NODE_ID, port)
        ).toThrow();
        expect(state()).toEqual(before);
        expect(calls).toEqual(writes);
    });

    it.each(['OPEN', 'CLOSED'] as const)('refuses to adopt an unbound historical marker on an %s PR', (state) => {
        const current = fixture();
        const inspect = current.port.inspect;
        const historical = { ...record, reviewBodies: [{ reviewId, rootCommentIds: [findingId] }] };
        current.port.inspect = (number) => ({
            ...inspect(number),
            state,
            closedAt: state === 'CLOSED' ? '2026-10-24T00:00:00Z' : null,
            comments: [comment('2001', `sourdaw-retirement-v1 ${canonicalJson(historical)}`, AUTHOR_BOT_NODE_ID)],
        });

        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, current.port)).toThrow();
        expect(current.calls.filter((call) => ['comment', 'delete', 'close'].includes(call))).toEqual([]);
    });

    it('binds exact UTF-8 review-body bytes without trimming or interpreting prose', () => {
        expect(retirementReviewBodyDigest('One audit fact is wrong.')).toBe(record.reviewBodies[0]!.bodyDigest);
        expect(retirementReviewBodyDigest('One audit fact is wrong.\n')).not.toBe(record.reviewBodies[0]!.bodyDigest);
        expect(() =>
            parseRetirementRecord(
                canonicalJson({ ...record, reviewBodies: [{ ...record.reviewBodies[0], bodyDigest: 'a'.repeat(40) }] })
            )
        ).toThrow(/SHA-256/u);
    });

    it('holds the real owner through all reads and writes, then releases before reporting success', async () => {
        await withLockRoot(async (root) => {
            const { port, calls } = fixture();
            const inspect = port.inspect;
            port.inspect = (number) => {
                expect(ownerOid(root)).toBeDefined();
                return inspect(number);
            };
            const comment = port.comment;
            const close = port.close;
            const checkAttempt = () => {
                const oid = ownerOid(root);
                expect(oid).toBeDefined();
                expect(readPullRequestMutationLockOwner(root, oid!, pr)).toMatchObject({
                    version: 4,
                    operation: 'delivery',
                    mutation: { phase: 'remote-mutation-attempted' },
                });
            };
            port.comment = (number, body) => {
                checkAttempt();
                return comment(number, body);
            };
            port.close = (number) => {
                checkAttempt();
                return close(number);
            };
            port.log = (message) => {
                expect(ownerOid(root)).toBeUndefined();
                calls.push(message);
            };

            await expect(runSerialized(root, port)).resolves.toBe('pull-request-retired:5361');
            await expect(runSerialized(root, port)).resolves.toBe('pull-request-retired:5361');
            expect(calls.filter((call) => ['comment', 'close', 'delete'].includes(call))).toEqual(['comment', 'close']);
            expect(ownerOid(root)).toBeUndefined();
        });
    });

    it('releases a read-only refusal and a verified complete OPEN rollback while still refusing', async () => {
        await withLockRoot(async (root) => {
            const refused = fixture({ head: 'b'.repeat(40) });
            await expect(runSerialized(root, refused.port)).rejects.toThrow();
            expect(ownerOid(root)).toBeUndefined();
            const changed = reviewState();
            changed.requestedReviews[0]!.body += ' A later blocker.';
            const rolledBack = fixture({ afterCommentReviewState: changed });
            const deleteComment = rolledBack.port.deleteComment;
            rolledBack.port.deleteComment = (id) => {
                const oid = ownerOid(root);
                expect(oid).toBeDefined();
                expect(readPullRequestMutationLockOwner(root, oid!, pr)).toMatchObject({
                    mutation: { phase: 'remote-mutation-attempted' },
                });
                deleteComment(id);
            };
            await expect(runSerialized(root, rolledBack.port)).rejects.toThrow(/review.*body/u);
            expect(rolledBack.state()).toMatchObject({ state: 'OPEN', comments: [] });
            expect(rolledBack.calls).not.toContain('pull-request-retired:5361');
            expect(ownerOid(root)).toBeUndefined();
        });
    });

    it.each([
        'comment ambiguity',
        'close ambiguity',
        'failed rollback',
        'unverified rollback',
        'post-close body drift',
    ] as const)('retains the real journaled owner and recovery route after %s', async (failure) => {
        await withLockRoot(async (root) => {
            const changed = reviewState();
            changed.requestedReviews[0]!.body += ' A later blocker.';
            const current = fixture({
                closeError: failure === 'close ambiguity',
                afterCommentReviewState: failure.includes('rollback') ? changed : undefined,
            });
            if (failure === 'comment ambiguity') {
                const comment = current.port.comment;
                current.port.comment = (number, body) => {
                    comment(number, body);
                    throw new Error('comment transport lost');
                };
            } else if (failure === 'failed rollback') {
                current.port.deleteComment = () => {
                    throw new Error('delete denied');
                };
            } else if (failure === 'unverified rollback') {
                const inspect = current.port.inspect;
                let deleted = false;
                const deleteComment = current.port.deleteComment;
                current.port.deleteComment = (id) => {
                    deleteComment(id);
                    deleted = true;
                };
                current.port.inspect = (number) => {
                    if (deleted) {
                        throw new Error('rollback verification unavailable');
                    }
                    return inspect(number);
                };
            } else if (failure === 'post-close body drift') {
                current.port.inspectRetirementReviewState = () =>
                    current.state().state === 'CLOSED' ? changed : reviewState();
            }
            const attempt = runSerialized(root, current.port);
            await expect(attempt).rejects.toThrow(/preserved lock owner/u);
            const oid = ownerOid(root);
            expect(oid).toBeDefined();
            expect(readPullRequestMutationLockOwner(root, oid!, pr)).toMatchObject({
                version: 4,
                operation: 'delivery',
                mutation: { phase: 'remote-mutation-attempted' },
            });
            await expect(attempt).rejects.toThrow(`pnpm deliver --recover-lock ${pr} --owner ${oid}`);
            expect(current.calls).not.toContain('pull-request-retired:5361');
            const beforeRetry = [...current.calls];
            await expect(runSerialized(root, current.port)).rejects.toThrow(/already being delivered/u);
            expect(current.calls).toEqual(beforeRetry);
            expect(ownerOid(root)).toBe(oid);
        });
    });

    it('requires exact CLI head and record arguments', () => {
        expect(parseRetirePullRequestArgs(['5361', '--head', head, '--record', '/tmp/retirement.json'])).toMatchObject({
            number: pr,
            head,
            recordPath: '/tmp/retirement.json',
        });
        expect(() => parseRetirePullRequestArgs(['5361', '--record', '/tmp/retirement.json'])).toThrow();
    });

    it.each([
        ['other-owner/sourdaw', pr],
        ['jcosta33/sourdaw', pr + 1],
    ])('refuses review read bound to repository %s and PR %i', (repository, number) => {
        const page = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
        const gh = () =>
            JSON.stringify({
                data: {
                    repository: {
                        nameWithOwner: repository,
                        pullRequest: { number, reviewThreads: page, reviews: page },
                    },
                },
            });
        expect(() => inspectRetirementReviewState(pr, gh)).toThrow();
    });
});
