import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_LOGIN } from '../githubAppIdentity.ts';
import {
    inspectIssueComments,
    parseSupersedePullRequestArgs,
    supersedePullRequest,
    deleteComment,
    type SupersedePullRequestPort,
} from '../supersedePullRequest.ts';

const head = 'a'.repeat(40);
const movedHead = 'b'.repeat(40);
const oldComment = { id: 'IC_old', fullDatabaseId: '9223372036854775807', body: 'old', authorLogin: 'reviewer[bot]' };
type Input = {
    heads?: string[];
    authorLogin?: string;
    replacementState?: string;
    throwAfterComment?: boolean;
    concurrentCommentOnThrow?: boolean;
    throwCloseWithConcurrentState?: boolean;
    failDelete?: boolean;
    returnedCommentBody?: string;
};
function fakePort(input: Input = {}) {
    const calls: string[] = [];
    let index = 0;
    let state = 'OPEN';
    let closeCalled = false;
    let comments = [oldComment];
    const snapshot = (number: number) =>
        number === 2244
            ? {
                  number,
                  state,
                  head: input.heads?.[index++] ?? head,
                  repository: 'jcosta33/sourdaw',
                  base: 'main',
                  comments,
              }
            : {
                  number,
                  state: input.replacementState ?? 'MERGED',
                  head: 'c'.repeat(40),
                  repository: 'jcosta33/sourdaw',
                  base: 'main',
                  comments: [],
              };
    const port: SupersedePullRequestPort = {
        inspect: (number) => {
            calls.push(`inspect:${number}`);
            if (number === 2244 && input.throwCloseWithConcurrentState && closeCalled) {
                state = 'CLOSED';
            }
            return snapshot(number);
        },
        comment: (number, body) => {
            calls.push(`comment:${number}:${body}`);
            const created = {
                id: 'IC_new',
                fullDatabaseId: '9223372036854775808',
                body: input.returnedCommentBody ?? body,
                authorLogin: AUTHOR_BOT_LOGIN,
            };
            comments = [...comments, created];
            if (input.throwAfterComment) {
                if (input.concurrentCommentOnThrow) {
                    comments = [
                        ...comments,
                        {
                            id: 'IC_concurrent',
                            fullDatabaseId: '9223372036854775809',
                            body,
                            authorLogin: AUTHOR_BOT_LOGIN,
                        },
                    ];
                }
                throw new Error('comment transport lost');
            }
            return created;
        },
        close: (number) => {
            calls.push(`close:${number}`);
            closeCalled = true;
            if (input.throwCloseWithConcurrentState) {
                throw new Error('close transport lost');
            }
            state = 'CLOSED';
        },
        reopen: (number) => {
            calls.push(`reopen:${number}`);
            state = 'OPEN';
        },
        deleteComment: (id) => {
            calls.push(`delete:${id}`);
            if (input.failDelete) {
                throw new Error('delete denied');
            }
            comments = comments.filter((comment) => comment.id !== id);
        },
        log: (message) => calls.push(`log:${message}`),
    };
    return { port, calls, authorLogin: input.authorLogin ?? AUTHOR_BOT_LOGIN, state: () => ({ state, comments }) };
}

describe('pull-request supersession', () => {
    it.each([
        ['missing', { data: { deleteIssueComment: { clientMutationId: null } } }],
        ['mismatched', { data: { deleteIssueComment: { clientMutationId: 'IC_other' } } }],
    ])('rejects a %s delete-comment receipt', (_case, response) => {
        expect(() => deleteComment('IC_new', () => JSON.stringify(response))).toThrow(
            /delete supersession comment returned an invalid result/i
        );
    });
    it('paginates over 100 pull-request comments before supersession compensation can compare them', () => {
        const first = Array.from({ length: 100 }, (_, index) => ({
            id: `IC_${index}`,
            fullDatabaseId: String(index + 1),
            body: 'old',
            author: { login: 'reviewer[bot]' },
        }));
        const final = {
            id: 'IC_100',
            fullDatabaseId: '9223372036854775808',
            body: 'Superseded by #2246.',
            author: { login: AUTHOR_BOT_LOGIN },
        };
        const calls: string[][] = [];
        const comments = inspectIssueComments('PR_kwDOExample', (args) => {
            calls.push(args);
            const firstPage = calls.length === 1;
            return JSON.stringify({
                data: {
                    node: {
                        comments: {
                            nodes: firstPage ? first : [final],
                            pageInfo: { hasNextPage: firstPage, endCursor: firstPage ? 'issue-comments-1' : null },
                        },
                    },
                },
            });
        });
        expect(comments).toHaveLength(101);
        expect(comments.at(-1)?.id).toBe('IC_100');
        expect(calls[1]).toContain('cursor=issue-comments-1');
    });

    it.each([
        ['repeated', 'issue-comments-1'],
        ['empty', ''],
    ])('fails closed on a %s issue-comment cursor', (_case, cursor) => {
        let call = 0;
        expect(() =>
            inspectIssueComments('PR_kwDOExample', () => {
                call += 1;
                return JSON.stringify({
                    data: {
                        node: {
                            comments: {
                                nodes: [],
                                pageInfo: { hasNextPage: true, endCursor: cursor },
                            },
                        },
                    },
                });
            })
        ).toThrow(/pagination/i);
    });

    it('parses strict arguments', () => {
        expect(parseSupersedePullRequestArgs(['2244', '--head', head, '--replacement', '2246'])).toMatchObject({
            oldNumber: 2244,
            head,
            replacementNumber: 2246,
        });
        for (const args of [
            [],
            ['2244', '--replacement', '2246', '--head', head],
            ['2244', '--head', head, '--replacement', '2244'],
        ]) {
            expect(() => parseSupersedePullRequestArgs(args)).toThrow(/usage/i);
        }
    });
    it.each([
        ['wrong actor', 'other[bot]', {}],
        ['replacement open', AUTHOR_BOT_LOGIN, { replacementState: 'OPEN' }],
    ])('refuses %s without mutations', (_name, login, input) => {
        const { port, calls } = fakePort(input);
        expect(() => supersedePullRequest(2244, head, 2246, login, port)).toThrow();
        expect(calls.filter((call) => !call.startsWith('inspect:'))).toEqual([]);
    });
    it('comments, reinspects, closes, and verifies', () => {
        const { port, calls, authorLogin } = fakePort();
        expect(supersedePullRequest(2244, head, 2246, authorLogin, port)).toBe('pull-request-superseded:2244:2246');
        expect(calls).toEqual([
            'inspect:2244',
            'inspect:2246',
            'comment:2244:Superseded by #2246.',
            'inspect:2244',
            'close:2244',
            'inspect:2244',
            'log:pull-request-superseded:2244:2246',
        ]);
    });
    it('refuses a wrong-body comment receipt before checking stability or closing', () => {
        const { port, calls, authorLogin, state } = fakePort({ returnedCommentBody: 'Superseded by #9999.' });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(
            /add supersession comment returned an invalid result/i
        );
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
        expect(state()).toMatchObject({ state: 'OPEN', comments: [oldComment] });
    });
    it('fails closed when a thrown comment mutation collides with an identical concurrent comment', () => {
        const { port, authorLogin, state, calls } = fakePort({
            throwAfterComment: true,
            concurrentCommentOnThrow: true,
        });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(
            /comment transport lost[\s\S]*ambiguous supersession comment mutation/i
        );
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state().comments.map((comment) => comment.id)).toEqual(['IC_old', 'IC_new', 'IC_concurrent']);
    });
    it('does not reopen a concurrent state after close throws without a receipt', () => {
        const { port, authorLogin, state, calls } = fakePort({ throwCloseWithConcurrentState: true });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(
            /close transport lost[\s\S]*ambiguous PR closure/i
        );
        expect(calls.filter((call) => call.startsWith('reopen:'))).toEqual([]);
        expect(state().state).toBe('CLOSED');
    });
    it('rolls back after a post-comment head move', () => {
        const { port, authorLogin, state, calls } = fakePort({ heads: [head, movedHead, movedHead, movedHead] });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(/head moved/i);
        expect(state()).toMatchObject({ state: 'OPEN', comments: [oldComment] });
        expect(calls).toContain('delete:IC_new');
    });
    it('surfaces compensation failure', () => {
        const { port, authorLogin } = fakePort({ throwAfterComment: true, failDelete: true });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(
            /comment transport lost[\s\S]*compensation failed/i
        );
    });
});
