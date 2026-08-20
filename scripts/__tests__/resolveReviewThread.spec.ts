import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_LOGIN, REVIEWER_BOT_LOGIN } from '../githubAppIdentity.ts';
import {
    inspectReviewThread,
    parseResolveReviewThreadArgs,
    resolveReviewThread,
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
    throwResolveWithConcurrentState?: boolean;
    failDelete?: boolean;
    rootAuthorLogin?: string | null;
    isResolved?: boolean;
};
function fakePort(input: Input = {}) {
    const calls: string[] = [];
    let index = 0;
    let resolved = input.isResolved ?? false;
    let resolveCalled = false;
    let comments = [
        {
            id: rootId,
            fullDatabaseId: '9223372036854775807',
            body: 'review',
            authorLogin: input.rootAuthorLogin ?? REVIEWER_BOT_LOGIN,
        },
    ];
    const port: ResolveReviewThreadPort = {
        inspect: () => {
            calls.push(`inspect:${++index}`);
            if (input.throwResolveWithConcurrentState && resolveCalled) {
                resolved = true;
            }
            return {
                head: input.heads?.[index - 1] ?? head,
                thread: {
                    id: threadId,
                    isResolved: resolved,
                    rootCommentId: rootId,
                    rootCommentFullDatabaseId: '9223372036854775807',
                    rootAuthorLogin: comments[0]?.authorLogin ?? null,
                    comments,
                },
            };
        },
        replyDone: (id) => {
            calls.push(`reply:${id}`);
            comments = [
                ...comments,
                { id: replyId, fullDatabaseId: '9223372036854775808', body: 'Done', authorLogin: AUTHOR_BOT_LOGIN },
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
                        },
                    ];
                }
                throw new Error('reply transport lost');
            }
            return { id: replyId, fullDatabaseId: '9223372036854775808', authorLogin: AUTHOR_BOT_LOGIN };
        },
        resolve: (id) => {
            calls.push(`resolve:${id}`);
            resolveCalled = true;
            if (input.throwResolveWithConcurrentState) {
                throw new Error('resolve transport lost');
            }
            resolved = true;
        },
        unresolve: (id) => {
            calls.push(`unresolve:${id}`);
            resolved = false;
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
    return { port, calls, authorLogin: input.authorLogin ?? AUTHOR_BOT_LOGIN, state: () => ({ resolved, comments }) };
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
    author: { login: REVIEWER_BOT_LOGIN },
};

describe('review thread resolution', () => {
    it('uses supported GraphQL reply and deletion input fields', () => {
        const source = readFileSync(join(import.meta.dirname, '../resolveReviewThread.ts'), 'utf8');
        expect(source).toContain('pullRequestReviewThreadId:$threadId');
        expect(source).toContain('deletePullRequestReviewComment(input:{id:$replyId})');
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
            `resolve:${threadId}`,
            'inspect:3',
            `log:review-thread-resolved:42:${threadId}`,
        ]);
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
            /resolve transport lost[\s\S]*ambiguous review-thread resolution/i
        );
        expect(calls.filter((call) => call.startsWith('unresolve:'))).toEqual([]);
        expect(state().resolved).toBe(true);
    });
    it('deletes the exact new reply when the head moves after replying', () => {
        const { port, authorLogin, state, calls } = fakePort({ heads: [head, movedHead, movedHead, movedHead] });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(/head moved/i);
        expect(state()).toMatchObject({ resolved: false, comments: [{ id: rootId }] });
        expect(calls).toContain(`delete:${replyId}`);
    });
    it('reports original and compensation failure', () => {
        const { port, authorLogin } = fakePort({ throwAfterReply: true, failDelete: true });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(
            /reply transport lost[\s\S]*compensation failed/i
        );
    });
});
