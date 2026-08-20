import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_LOGIN, REVIEWER_BOT_LOGIN } from '../githubAppIdentity.ts';
import {
    parseResolveReviewThreadArgs,
    resolveReviewThread,
    type ResolveReviewThreadPort,
} from '../resolveReviewThread.ts';

const head = 'a'.repeat(40);
const threadId = 'PRRT_kwDOExample';

type FakeInput = {
    authorLogin?: string;
    currentHead?: string;
    afterReplyHead?: string;
    thread?: Partial<{
        id: string;
        isResolved: boolean;
        rootCommentDatabaseId: number | null;
        rootAuthorLogin: string | null;
    }>;
};

function fakePort(input: FakeInput = {}) {
    const calls: string[] = [];
    let inspectionCount = 0;
    let isResolved = input.thread?.isResolved ?? false;
    const port: ResolveReviewThreadPort = {
        inspect: () => {
            inspectionCount += 1;
            calls.push(`inspect:${inspectionCount}`);
            const currentHead =
                inspectionCount > 1 ? (input.afterReplyHead ?? input.currentHead ?? head) : (input.currentHead ?? head);
            return {
                head: currentHead,
                thread: {
                    id: threadId,
                    rootCommentDatabaseId: 99,
                    rootAuthorLogin: REVIEWER_BOT_LOGIN,
                    ...input.thread,
                    isResolved,
                },
            };
        },
        replyDone: (number, commentId) => calls.push(`reply:${number}:${commentId}:Done`),
        resolve: (id) => {
            calls.push(`resolve:${id}`);
            isResolved = true;
        },
        log: (message) => calls.push(`log:${message}`),
    };
    return { calls, port, authorLogin: input.authorLogin ?? AUTHOR_BOT_LOGIN };
}

describe('review thread resolution', () => {
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
        ['wrong head', { currentHead: 'b'.repeat(40) }],
        ['wrong root owner', { thread: { rootAuthorLogin: 'someone[bot]' } }],
        ['already resolved', { thread: { isResolved: true } }],
        ['missing root database id', { thread: { rootCommentDatabaseId: null } }],
    ])('refuses %s without mutations', (_case, input) => {
        const { port, calls, authorLogin } = fakePort(input);
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow();
        expect(calls.filter((call) => call.startsWith('reply:') || call.startsWith('resolve:'))).toEqual([]);
    });

    it('refuses an unexpected author login without mutations', () => {
        const { port, calls } = fakePort({ authorLogin: 'someone[bot]' });
        expect(() => resolveReviewThread(42, threadId, head, 'someone[bot]', port)).toThrow(/author/);
        expect(calls).toEqual([]);
    });

    it('replies before rechecking the head, then resolves and verifies', () => {
        const { port, calls, authorLogin } = fakePort();
        expect(resolveReviewThread(42, threadId, head, authorLogin, port)).toBe(
            `review-thread-resolved:42:${threadId}`
        );
        expect(calls).toEqual([
            'inspect:1',
            'reply:42:99:Done',
            'inspect:2',
            `resolve:${threadId}`,
            'inspect:3',
            `log:review-thread-resolved:42:${threadId}`,
        ]);
    });

    it('refuses resolution when the head moves after the reply', () => {
        const { port, calls, authorLogin } = fakePort({ afterReplyHead: 'b'.repeat(40) });
        expect(() => resolveReviewThread(42, threadId, head, authorLogin, port)).toThrow(/head moved/);
        expect(calls).toEqual(['inspect:1', 'reply:42:99:Done', 'inspect:2']);
    });
});
