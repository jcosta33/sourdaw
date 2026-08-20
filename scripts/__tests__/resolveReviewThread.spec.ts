import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_LOGIN, REVIEWER_BOT_LOGIN } from '../githubAppIdentity.ts';
import {
    inspectReviewThread,
    parseResolveReviewThreadArgs,
    resolveReviewThread,
    deleteReply,
    type ResolveReviewThreadPort,
} from '../resolveReviewThread.ts';

const head = 'a'.repeat(40);
const movedHead = 'b'.repeat(40);
const threadId = 'PRRT_kwDOExample';
const rootId = 'PRRC_root';
const replyId = 'PRRC_reply';
type Input = {
    heads?: string[];
    authorLogin?: string;
    throwAfterReply?: boolean;
    concurrentReplyOnThrow?: boolean;
    concurrentReplyBeforeConvergence?: boolean;
    foreignLowerReplyBeforeConvergence?: boolean;
    resolveBeforeConvergence?: boolean;
    throwResolveWithConcurrentState?: boolean;
    failDelete?: boolean;
    rootAuthorLogin?: string | null;
    rootAuthorType?: string | null;
    isResolved?: boolean;
    initialResolvedByLogin?: string | null;
    initialResolvedByType?: string | null;
    resolvedByAfterResolve?: string | null;
    resolvedByTypeAfterResolve?: string | null;
    existingReplyCount?: number;
    deleteReplyAfterResolve?: boolean;
    editReplyAfterResolve?: boolean;
    replyClientMutationId?: string;
    replyAuthorType?: string;
    resolveClientMutationId?: string;
};
function fakePort(input: Input = {}) {
    const calls: string[] = [];
    let index = 0;
    let resolved = input.isResolved ?? false;
    let resolveCalled = false;
    let resolvedByLogin: string | null = input.initialResolvedByLogin ?? null;
    let resolvedByType: string | null = input.initialResolvedByType ?? null;
    let concurrentReplyAdded = false;
    let comments = [
        {
            id: rootId,
            fullDatabaseId: '9223372036854775807',
            body: 'review',
            authorLogin: input.rootAuthorLogin ?? REVIEWER_BOT_LOGIN,
            authorType: input.rootAuthorType ?? 'Bot',
        },
    ];
    for (let replyIndex = 0; replyIndex < (input.existingReplyCount ?? 0); replyIndex += 1) {
        comments.push({
            id: replyIndex === 0 ? replyId : `PRRC_existing_${replyIndex}`,
            fullDatabaseId: String(9223372036854775808n + BigInt(replyIndex)),
            body: 'Done',
            authorLogin: AUTHOR_BOT_LOGIN,
            authorType: 'Bot',
        });
    }
    const port: ResolveReviewThreadPort = {
        inspect: () => {
            calls.push(`inspect:${++index}`);
            if (input.concurrentReplyBeforeConvergence && !concurrentReplyAdded && index === 2) {
                concurrentReplyAdded = true;
                comments = [
                    ...comments,
                    {
                        id: 'PRRC_concurrent',
                        fullDatabaseId: '9223372036854775809',
                        body: 'Done',
                        authorLogin: AUTHOR_BOT_LOGIN,
                        authorType: 'Bot',
                    },
                ];
            }
            if (input.foreignLowerReplyBeforeConvergence && !concurrentReplyAdded && index === 2) {
                concurrentReplyAdded = true;
                comments = [
                    ...comments,
                    {
                        id: 'PRRC_foreign',
                        fullDatabaseId: '9223372036854775806',
                        body: 'Done',
                        authorLogin: AUTHOR_BOT_LOGIN,
                        authorType: 'Bot',
                    },
                ];
            }
            if (input.resolveBeforeConvergence && index === 2) {
                resolved = true;
                resolvedByLogin = AUTHOR_BOT_LOGIN;
                resolvedByType = 'Bot';
            }
            if (input.throwResolveWithConcurrentState && resolveCalled) {
                resolved = true;
            }
            if (resolveCalled && input.resolvedByAfterResolve !== undefined) {
                resolvedByLogin = input.resolvedByAfterResolve;
                resolvedByType = input.resolvedByTypeAfterResolve ?? 'Bot';
            }
            if (resolveCalled && input.deleteReplyAfterResolve) {
                comments = comments.filter((comment) => comment.id !== replyId);
            }
            if (resolveCalled && input.editReplyAfterResolve) {
                comments = comments.map((comment) =>
                    comment.id === replyId ? { ...comment, body: 'Edited' } : comment
                );
            }
            return {
                head: input.heads?.[index - 1] ?? head,
                thread: {
                    id: threadId,
                    isResolved: resolved,
                    resolvedByLogin,
                    resolvedByType,
                    rootCommentId: rootId,
                    rootCommentFullDatabaseId: '9223372036854775807',
                    rootAuthorLogin: comments[0]?.authorLogin ?? null,
                    rootAuthorType: comments[0]?.authorType ?? null,
                    comments,
                },
            };
        },
        replyDone: (id) => {
            calls.push(`reply:${id}`);
            comments = [
                ...comments,
                {
                    id: replyId,
                    fullDatabaseId: '9223372036854775808',
                    body: 'Done',
                    authorLogin: AUTHOR_BOT_LOGIN,
                    authorType: input.replyAuthorType ?? 'Bot',
                },
            ];
            if (input.throwAfterReply) {
                if (input.concurrentReplyOnThrow) {
                    comments = [
                        ...comments,
                        {
                            id: 'PRRC_concurrent',
                            fullDatabaseId: '9223372036854775809',
                            body: 'Done',
                            authorLogin: AUTHOR_BOT_LOGIN,
                            authorType: 'Bot',
                        },
                    ];
                }
                throw new Error('reply transport lost');
            }
            return {
                id: replyId,
                fullDatabaseId: '9223372036854775808',
                authorLogin: AUTHOR_BOT_LOGIN,
                authorType: input.replyAuthorType ?? 'Bot',
                clientMutationId: input.replyClientMutationId ?? `review-reply:${id}`,
            };
        },
        resolve: (id) => {
            calls.push(`resolve:${id}`);
            resolveCalled = true;
            if (input.throwResolveWithConcurrentState) {
                throw new Error('resolve transport lost');
            }
            resolved = true;
            resolvedByLogin = AUTHOR_BOT_LOGIN;
            resolvedByType = 'Bot';
            return {
                resolvedByLogin,
                resolvedByType,
                clientMutationId: input.resolveClientMutationId ?? `review-resolve:${id}`,
            };
        },
        deleteReply: (id) => {
            calls.push(`delete:${id}`);
            if (input.failDelete) {
                throw new Error('delete denied');
            }
            comments = comments.filter((comment) => comment.id !== id);
        },
        log: (message) => calls.push(`log:${message}`),
    };
    return {
        port,
        calls,
        authorLogin: input.authorLogin ?? AUTHOR_BOT_LOGIN,
        state: () => ({ resolved, resolvedByLogin, resolvedByType, comments }),
    };
}

function threadPage(nodes: unknown[], hasNextPage: boolean, endCursor: string | null) {
    return JSON.stringify({
        data: {
            repository: {
                pullRequest: { headRefOid: head, reviewThreads: { nodes, pageInfo: { hasNextPage, endCursor } } },
            },
        },
    });
}
function commentPage(nodes: unknown[], hasNextPage: boolean, endCursor: string | null) {
    return JSON.stringify({
        data: { node: { id: threadId, comments: { nodes, pageInfo: { hasNextPage, endCursor } } } },
    });
}
const root = {
    id: rootId,
    fullDatabaseId: '9223372036854775807',
    body: 'review',
    author: { login: REVIEWER_BOT_LOGIN, __typename: 'Bot' },
};

describe('review thread resolution', () => {
    it('uses supported GraphQL reply and deletion input fields', () => {
        const source = readFileSync(join(import.meta.dirname, '../resolveReviewThread.ts'), 'utf8');
        expect(source).toContain('pullRequestReviewThreadId:$threadId');
        expect(source).toContain(
            'deletePullRequestReviewComment(input:{id:$replyId,clientMutationId:$clientMutationId})'
        );
        expect(source).toContain(
            'addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId,body:$body,clientMutationId:$clientMutationId})'
        );
        expect(source).toContain('resolveReviewThread(input:{threadId:$threadId,clientMutationId:$clientMutationId})');
    });
    it.each([
        [
            'missing comment',
            { data: { deletePullRequestReviewComment: { clientMutationId: replyId, pullRequestReviewComment: null } } },
        ],
        [
            'mismatched comment',
            {
                data: {
                    deletePullRequestReviewComment: {
                        clientMutationId: replyId,
                        pullRequestReviewComment: { id: 'PRRC_other' },
                    },
                },
            },
        ],
        [
            'missing client mutation',
            {
                data: {
                    deletePullRequestReviewComment: {
                        clientMutationId: null,
                        pullRequestReviewComment: { id: replyId },
                    },
                },
            },
        ],
        [
            'mismatched client mutation',
            {
                data: {
                    deletePullRequestReviewComment: {
                        clientMutationId: 'PRRC_other',
                        pullRequestReviewComment: { id: replyId },
                    },
                },
            },
        ],
    ])('rejects a %s delete-reply receipt', (_case, response) => {
        expect(() => deleteReply(replyId, () => JSON.stringify(response))).toThrow(
            /delete review reply returned an invalid result/i
        );
    });
    it('finds the requested thread on a later page and paginates its comments', () => {
        let call = 0;
        const calls: string[][] = [];
        const inspection = inspectReviewThread(42, threadId, (args) => {
            calls.push(args);
            call += 1;
            if (call === 1) {
                return threadPage([], true, 'threads-1');
            }
            if (call === 2) {
                return threadPage([{ id: threadId, isResolved: false }], false, null);
            }
            return commentPage([root], false, null);
        });
        expect(inspection).toMatchObject({
            head,
            thread: { id: threadId, rootCommentFullDatabaseId: '9223372036854775807' },
        });
        expect(call).toBe(3);
    });
    it('rejects partial GraphQL data with errors before accepting a review thread', () => {
        expect(() =>
            inspectReviewThread(42, threadId, () =>
                JSON.stringify({
                    data: {
                        repository: {
                            pullRequest: {
                                headRefOid: head,
                                reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
                            },
                        },
                    },
                    errors: [{ message: 'partial failure' }],
                })
            )
        ).toThrow(/invalid GraphQL envelope/i);
    });
    it('proves absence only after the final thread page', () => {
        let call = 0;
        const inspection = inspectReviewThread(42, threadId, () => {
            call += 1;
            return threadPage([], call === 1, call === 1 ? 'threads-1' : null);
        });
        expect(inspection).toEqual({ head, thread: null });
        expect(call).toBe(2);
    });
    it('finds and retains a created reply beyond 100 comments', () => {
        const first = Array.from({ length: 100 }, (_, index) => ({
            id: `PRRC_${index}`,
            fullDatabaseId: String(index + 1),
            body: 'old',
            author: { login: REVIEWER_BOT_LOGIN },
        }));
        first[0] = root;
        const later = {
            id: replyId,
            fullDatabaseId: '9223372036854775808',
            body: 'Done',
            author: { login: AUTHOR_BOT_LOGIN },
        };
        let call = 0;
        const calls: string[][] = [];
        const inspection = inspectReviewThread(42, threadId, (args) => {
            calls.push(args);
            call += 1;
            if (call === 1) {
                return threadPage([{ id: threadId, isResolved: false }], false, null);
            }
            if (call === 2) {
                return commentPage(first, true, 'comments-1');
            }
            return commentPage([later], false, null);
        });
        expect(inspection.thread?.comments).toHaveLength(101);
        expect(inspection.thread?.comments.at(-1)?.id).toBe(replyId);
        expect(calls[2]).toContain('cursor=comments-1');
    });
    it.each([
        ['repeated', 'comments-1'],
        ['empty', ''],
    ])('fails closed on a %s comment cursor', (_case, cursor) => {
        let call = 0;
        expect(() =>
            inspectReviewThread(42, threadId, () => {
                call += 1;
                if (call === 1) {
                    return threadPage([{ id: threadId, isResolved: false }], false, null);
                }
                return commentPage([], true, cursor);
            })
        ).toThrow(/pagination/i);
    });
    it('parses strict arguments', () => {
        expect(parseResolveReviewThreadArgs(['42', '--thread', threadId, '--head', head])).toMatchObject({
            number: 42,
            threadId,
            head,
        });
        for (const args of [
            [],
            ['42', '--head', head, '--thread', threadId],
            ['42', '--thread', threadId, '--head', 'bad'],
        ]) {
            expect(() => parseResolveReviewThreadArgs(args)).toThrow(/usage/i);
        }
    });
    it.each([
        ['wrong head', { heads: [movedHead] }],
        ['wrong author', { rootAuthorLogin: 'other[bot]' }],
        ['resolved', { isResolved: true }],
    ])('refuses %s with zero mutations', (_name, input) => {
        const { port, calls, authorLogin } = fakePort(input);
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow();
        expect(calls.filter((call) => !call.startsWith('inspect:'))).toEqual([]);
    });
    it('refuses the wrong actor with zero mutations', () => {
        const { port, calls } = fakePort();
        expect(() => resolveReviewThread(42, threadId, head, 'other[bot]', port)).toThrow(/author/i);
        expect(calls).toEqual([]);
    });
    it('runs reply, resolve, and final inspection in order', () => {
        const { port, calls, authorLogin } = fakePort();
        expect(resolveReviewThread(42, threadId, head, authorLogin, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls).toEqual([
            'inspect:1',
            `reply:${threadId}`,
            'inspect:2',
            'inspect:3',
            `resolve:${threadId}`,
            'inspect:4',
            `log:review-thread-resolved:42:${threadId}`,
        ]);
    });
    it('rejects a mismatched reply client receipt before resolve', () => {
        const { port, calls, authorLogin } = fakePort({ replyClientMutationId: 'wrong' });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(/reply returned an invalid/i);
        expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([]);
    });
    it('rejects a User-typed reply receipt before resolve or success', () => {
        const { port, calls, authorLogin } = fakePort({ replyAuthorType: 'User' });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(/reply returned an invalid/i);
        expect(calls.filter((call) => call.startsWith('resolve:') || call.startsWith('log:'))).toEqual([]);
    });
    it('rejects a mismatched resolve client receipt without accepting state ownership', () => {
        const { port, calls, authorLogin } = fakePort({ resolveClientMutationId: 'wrong' });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(
            /resolve review thread returned an invalid/i
        );
        expect(calls.filter((call) => call.startsWith('unresolve:'))).toEqual([]);
    });
    it('fails without success when the exact receipt reply disappears before final inspection', () => {
        const { port, calls, authorLogin } = fakePort({ deleteReplyAfterResolve: true });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(/reply receipt/i);
        expect(calls.filter((call) => call.startsWith('unresolve:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
    });
    it('does not unresolve a thread whose resolution marker changed concurrently', () => {
        const { port, calls, authorLogin, state } = fakePort({ resolvedByAfterResolve: 'other[bot]' });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(/not resolved by/i);
        expect(calls.filter((call) => call.startsWith('unresolve:'))).toEqual([]);
        expect(state().resolved).toBe(true);
    });
    it('does not unresolve a same-identity resolution after its final head check fails', () => {
        const { port, calls, authorLogin, state } = fakePort({
            heads: [head, head, head, movedHead, movedHead],
        });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(/head moved/i);
        expect(calls.filter((call) => call.startsWith('unresolve:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state()).toMatchObject({ resolved: true, comments: [{ id: rootId }, { id: replyId, body: 'Done' }] });
    });
    it('does not delete an edited reply during a failed receipted resolution', () => {
        const { port, calls, authorLogin, state } = fakePort({
            heads: [head, head, head, movedHead, movedHead],
            editReplyAfterResolve: true,
            resolvedByAfterResolve: 'jcosta33-author',
        });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(/head moved/i);
        expect(calls.filter((call) => call.startsWith('unresolve:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state().comments.find((comment) => comment.id === replyId)?.body).toBe('Edited');
    });
    it('fails closed when a thrown reply mutation collides with an identical concurrent comment', () => {
        const { port, authorLogin, state, calls } = fakePort({ throwAfterReply: true, concurrentReplyOnThrow: true });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(
            /reply transport lost[\s\S]*ambiguous review reply mutation/i
        );
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state().comments.map((comment) => comment.id)).toEqual([rootId, replyId, 'PRRC_concurrent']);
    });
    it('does not unresolve a concurrent state after resolve throws without a receipt', () => {
        const { port, authorLogin, state, calls } = fakePort({ throwResolveWithConcurrentState: true });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(
            /resolve transport lost[\s\S]*durable evidence/i
        );
        expect(calls.filter((call) => call.startsWith('unresolve:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state().comments.find((comment) => comment.id === replyId)?.body).toBe('Done');
        expect(state().resolved).toBe(true);
    });
    it('deletes the exact new reply when the head moves after replying', () => {
        const { port, authorLogin, state, calls } = fakePort({ heads: [head, movedHead, movedHead, movedHead] });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(/head moved/i);
        expect(state()).toMatchObject({ resolved: false, comments: [{ id: rootId }] });
        expect(calls).toContain(`delete:${replyId}`);
    });
    it('reuses one exact existing Done reply and performs the missing resolution', () => {
        const { port, calls, authorLogin } = fakePort({ existingReplyCount: 1 });
        expect(resolveReviewThread(42, threadId, head, authorLogin, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('reply:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([`resolve:${threadId}`]);
    });
    it('converges multiple existing Done replies to the smallest fullDatabaseId before resolving', () => {
        const { port, calls, authorLogin } = fakePort({ existingReplyCount: 2 });
        expect(resolveReviewThread(42, threadId, head, authorLogin, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:PRRC_existing_1']);
        expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([`resolve:${threadId}`]);
    });
    it('converges an interleaved concurrent Done reply before resolution', () => {
        const { port, calls, authorLogin, state } = fakePort({ concurrentReplyBeforeConvergence: true });
        expect(resolveReviewThread(42, threadId, head, authorLogin, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:PRRC_concurrent']);
        expect(state().comments.filter((comment) => comment.body === 'Done')).toEqual([
            expect.objectContaining({ id: replyId }),
        ]);
    });
    it("deletes only this invocation's noncanonical reply when another invocation resolves first", () => {
        const { port, calls, authorLogin, state } = fakePort({
            foreignLowerReplyBeforeConvergence: true,
            resolveBeforeConvergence: true,
        });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(/already resolved/i);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([`delete:${replyId}`]);
        expect(calls.filter((call) => call.startsWith('resolve:'))).toEqual([]);
        expect(state().comments.map((comment) => comment.id)).toEqual([rootId, 'PRRC_foreign']);
    });
    it('returns completed success without mutation only for one exact Bot Done marker', () => {
        const { port, calls, authorLogin } = fakePort({
            isResolved: true,
            initialResolvedByLogin: AUTHOR_BOT_LOGIN,
            initialResolvedByType: 'Bot',
            existingReplyCount: 1,
        });
        expect(resolveReviewThread(42, threadId, head, authorLogin, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls).toEqual(['inspect:1', `log:review-thread-resolved:42:${threadId}`]);
    });
    it('fails closed for a completed thread with multiple Done markers', () => {
        const { port, calls, authorLogin } = fakePort({
            isResolved: true,
            initialResolvedByLogin: AUTHOR_BOT_LOGIN,
            initialResolvedByType: 'Bot',
            existingReplyCount: 2,
        });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(/exactly one/i);
        expect(calls.filter((call) => !call.startsWith('inspect:'))).toEqual([]);
    });
    it('rejects a User-typed root reviewer for a completed thread without mutation', () => {
        const { port, calls, authorLogin } = fakePort({
            isResolved: true,
            initialResolvedByLogin: AUTHOR_BOT_LOGIN,
            initialResolvedByType: 'Bot',
            existingReplyCount: 1,
            rootAuthorType: 'User',
        });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(/root comment/i);
        expect(calls.filter((call) => !call.startsWith('inspect:'))).toEqual([]);
    });
    it('rejects a User-typed reviewer marker before any mutation', () => {
        const { port, calls, authorLogin } = fakePort({ rootAuthorType: 'User' });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(/root comment/i);
        expect(calls.filter((call) => !call.startsWith('inspect:'))).toEqual([]);
    });
    it('reports original and compensation failure', () => {
        const { port, authorLogin } = fakePort({ throwAfterReply: true, failDelete: true });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(
            /reply transport lost[\s\S]*compensation failed/i
        );
    });
});
