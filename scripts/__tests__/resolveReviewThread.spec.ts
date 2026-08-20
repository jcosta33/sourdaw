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
const rootCommentId = 'PRRC_root';
const replyId = 'PRRC_reply';

type FakeInput = {
    authorLogin?: string;
    heads?: string[];
    thread?: Partial<{
        id: string;
        isResolved: boolean;
        rootCommentId: string | null;
        rootCommentFullDatabaseId: string | null;
        rootAuthorLogin: string | null;
    }>;
    failDelete?: boolean;
};

function fakePort(input: FakeInput = {}) {
    const calls: string[] = [];
    let inspectionCount = 0;
    let isResolved = input.thread?.isResolved ?? false;
    let replyExists = false;
    const port: ResolveReviewThreadPort = {
        inspect: () => {
            const currentHead = input.heads?.[inspectionCount] ?? head;
            inspectionCount += 1;
            calls.push(`inspect:${inspectionCount}`);
            return {
                head: currentHead,
                thread: {
                    id: threadId,
                    rootCommentId,
                    rootCommentFullDatabaseId: '9223372036854775807',
                    rootAuthorLogin: REVIEWER_BOT_LOGIN,
                    commentIds: replyExists ? [rootCommentId, replyId] : [rootCommentId],
                    ...input.thread,
                    isResolved,
                },
            };
        },
        replyDone: (id) => {
            calls.push(`reply:${id}:Done`);
            replyExists = true;
            return { id: replyId, fullDatabaseId: '9223372036854775808' };
        },
        resolve: (id) => {
            calls.push(`resolve:${id}`);
            isResolved = true;
        },
        unresolve: (id) => {
            calls.push(`unresolve:${id}`);
            isResolved = false;
        },
        deleteReply: (id) => {
            calls.push(`delete:${id}`);
            if (input.failDelete === true) {
                throw new Error('delete denied');
            }
            replyExists = false;
        },
        log: (message) => calls.push(`log:${message}`),
    };
    return { calls, port, authorLogin: input.authorLogin ?? AUTHOR_BOT_LOGIN };
}

describe('review thread resolution', () => {
    it('uses the supported GraphQL reply and deletion input fields', () => {
        const source = readFileSync(join(import.meta.dirname, '../resolveReviewThread.ts'), 'utf8');
        expect(source).toContain('pullRequestReviewThreadId:$threadId');
        expect(source).toContain('deletePullRequestReviewComment(input:{id:$replyId})');
    });

    it('finds the requested reviewer thread on a later GraphQL page', () => {
        const calls: string[][] = [];
        const response = (nodes: unknown[], hasNextPage: boolean, endCursor: string | null) =>
            JSON.stringify({
                data: {
                    repository: {
                        pullRequest: {
                            headRefOid: head,
                            reviewThreads: { nodes, pageInfo: { hasNextPage, endCursor } },
                        },
                    },
                },
            });
        const inspection = inspectReviewThread(42, threadId, (args) => {
            calls.push(args);
            if (calls.length === 1) {
                return response([], true, 'cursor-1');
            }
            return response(
                [
                    {
                        id: threadId,
                        isResolved: false,
                        comments: {
                            nodes: [
                                {
                                    id: rootCommentId,
                                    fullDatabaseId: '9223372036854775807',
                                    author: { login: REVIEWER_BOT_LOGIN },
                                },
                            ],
                        },
                    },
                ],
                false,
                null
            );
        });
        expect(inspection).toMatchObject({
            head,
            thread: {
                id: threadId,
                rootCommentId,
                rootCommentFullDatabaseId: '9223372036854775807',
            },
        });
        expect(calls).toHaveLength(2);
        expect(calls[1]).toContain('cursor=cursor-1');
    });

    it('proves absence only after the final GraphQL page', () => {
        const calls: string[][] = [];
        const inspection = inspectReviewThread(42, threadId, (args) => {
            calls.push(args);
            const hasNextPage = calls.length === 1;
            return JSON.stringify({
                data: {
                    repository: {
                        pullRequest: {
                            headRefOid: head,
                            reviewThreads: {
                                nodes: [],
                                pageInfo: { hasNextPage, endCursor: hasNextPage ? 'cursor-1' : null },
                            },
                        },
                    },
                },
            });
        });
        expect(inspection).toEqual({ head, thread: null });
        expect(calls).toHaveLength(2);
    });

    it('parses only the required strict arguments', () => {
        expect(parseResolveReviewThreadArgs(['42', '--thread', threadId, '--head', head])).toEqual({
            number: 42,
            threadId,
            head,
            help: false,
        });
        for (const args of [
            [],
            ['0', '--thread', threadId, '--head', head],
            ['42', '--thread', 'bad id', '--head', head],
            ['42', '--thread', threadId, '--head', 'abc'],
            ['42', '--head', head, '--thread', threadId],
            ['42', '--thread', threadId, '--head', head, 'extra'],
        ]) {
            expect(() => parseResolveReviewThreadArgs(args)).toThrow(/usage|head|thread/i);
        }
    });

    it.each([
        ['wrong head', { heads: [movedHead] }],
        ['wrong root owner', { thread: { rootAuthorLogin: 'someone[bot]' } }],
        ['already resolved', { thread: { isResolved: true } }],
        ['missing root database id', { thread: { rootCommentFullDatabaseId: null } }],
    ])('refuses %s without mutations', (_case, input) => {
        const { port, calls, authorLogin } = fakePort(input);
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow();
        expect(calls.filter((call) => /^(reply|resolve|unresolve|delete):/.test(call))).toEqual([]);
    });

    it('refuses an unexpected author login without mutations', () => {
        const { port, calls } = fakePort({ authorLogin: 'someone[bot]' });
        expect(() => resolveReviewThread(42, threadId, head, 'someone[bot]', port)).toThrow(/author/);
        expect(calls).toEqual([]);
    });

    it('preserves 64-bit decimal fullDatabaseId values without numeric coercion', () => {
        const { port, calls, authorLogin } = fakePort();
        resolveReviewThread(42, threadId, head, authorLogin, port);
        expect(calls).toContain(`reply:${threadId}:Done`);
    });

    it('replies before rechecking the head, then resolves and verifies', () => {
        const { port, calls, authorLogin } = fakePort();
        expect(resolveReviewThread(42, threadId, head, authorLogin, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls).toEqual([
            'inspect:1',
            `reply:${threadId}:Done`,
            'inspect:2',
            `resolve:${threadId}`,
            'inspect:3',
            `log:review-thread-resolved:42:${threadId}`,
        ]);
    });

    it('deletes the reply and leaves the thread unresolved when the head moves after the reply', () => {
        const { port, calls, authorLogin } = fakePort({ heads: [head, movedHead, movedHead] });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(/head moved/);
        expect(calls).toEqual(['inspect:1', `reply:${threadId}:Done`, 'inspect:2', `delete:${replyId}`, 'inspect:3']);
    });

    it('unresolves and deletes the reply when the head moves after resolution', () => {
        const { port, calls, authorLogin } = fakePort({ heads: [head, head, movedHead, movedHead] });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(/head moved/);
        expect(calls).toEqual([
            'inspect:1',
            `reply:${threadId}:Done`,
            'inspect:2',
            `resolve:${threadId}`,
            'inspect:3',
            `unresolve:${threadId}`,
            `delete:${replyId}`,
            'inspect:4',
        ]);
    });

    it('surfaces compensation failures alongside the original failure', () => {
        const { port, calls, authorLogin } = fakePort({ heads: [head, movedHead], failDelete: true });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(
            /head moved[\s\S]*compensation failed/i
        );
        expect(calls).toEqual(['inspect:1', `reply:${threadId}:Done`, 'inspect:2', `delete:${replyId}`, 'inspect:3']);
    });
});
