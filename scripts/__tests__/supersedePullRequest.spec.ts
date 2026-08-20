import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
const oldComment = {
    id: 'IC_old',
    fullDatabaseId: '9223372036854775807',
    body: 'old',
    authorLogin: 'reviewer[bot]',
    authorType: 'Bot',
};
type Input = {
    heads?: string[];
    authorLogin?: string;
    replacementState?: string;
    initialState?: string;
    throwAfterComment?: boolean;
    concurrentCommentOnThrow?: boolean;
    concurrentCommentBeforeConvergence?: boolean;
    foreignLowerCommentBeforeConvergence?: boolean;
    closeBeforeConvergence?: boolean;
    throwCloseWithConcurrentState?: boolean;
    throwCloseOnceWithoutState?: boolean;
    failDelete?: boolean;
    returnedCommentBody?: string;
    bases?: string[];
    changedClosedAtAfterClose?: boolean;
    deleteCommentAfterClose?: boolean;
    editCommentAfterComment?: boolean;
    returnedCommentClientMutationId?: string;
    returnedCommentAuthorType?: string;
    existingCommentCount?: number;
    existingCommentAuthorType?: string;
};
function fakePort(input: Input = {}) {
    const calls: string[] = [];
    let index = 0;
    let state = input.initialState ?? 'OPEN';
    let closeCalled = false;
    let closeFailures = 0;
    let commentCalled = false;
    let concurrentCommentAdded = false;
    let closedAt: string | null = null;
    let comments = [oldComment];
    for (let commentIndex = 0; commentIndex < (input.existingCommentCount ?? 0); commentIndex += 1) {
        comments.push({
            id: commentIndex === 0 ? 'IC_new' : `IC_existing_${commentIndex}`,
            fullDatabaseId: String(9223372036854775808n + BigInt(commentIndex)),
            body: 'Superseded by #2246.',
            authorLogin: AUTHOR_BOT_LOGIN,
            authorType: input.existingCommentAuthorType ?? 'Bot',
        });
    }
    const snapshot = (number: number) => {
        if (number === 2244) {
            const inspection = index++;
            return {
                number,
                state,
                head: input.heads?.[inspection] ?? head,
                repository: 'jcosta33/sourdaw',
                base: input.bases?.[inspection] ?? 'main',
                closedAt,
                comments,
            };
        }
        return {
            number,
            state: input.replacementState ?? 'MERGED',
            head: 'c'.repeat(40),
            repository: 'jcosta33/sourdaw',
            base: 'main',
            closedAt: '2026-08-20T12:00:00Z',
            comments: [],
        };
    };
    const port: SupersedePullRequestPort = {
        inspect: (number) => {
            calls.push(`inspect:${number}`);
            if (
                number === 2244 &&
                input.concurrentCommentBeforeConvergence &&
                !concurrentCommentAdded &&
                comments.length > 1
            ) {
                concurrentCommentAdded = true;
                comments = [
                    ...comments,
                    {
                        id: 'IC_concurrent',
                        fullDatabaseId: '9223372036854775809',
                        body: 'Superseded by #2246.',
                        authorLogin: AUTHOR_BOT_LOGIN,
                        authorType: 'Bot',
                    },
                ];
            }
            if (
                number === 2244 &&
                input.foreignLowerCommentBeforeConvergence &&
                !concurrentCommentAdded &&
                commentCalled
            ) {
                concurrentCommentAdded = true;
                comments = [
                    ...comments,
                    {
                        id: 'IC_foreign',
                        fullDatabaseId: '9223372036854775806',
                        body: 'Superseded by #2246.',
                        authorLogin: AUTHOR_BOT_LOGIN,
                        authorType: 'Bot',
                    },
                ];
            }
            if (number === 2244 && input.closeBeforeConvergence && commentCalled) {
                state = 'CLOSED';
                closedAt = '2026-08-20T12:00:00Z';
            }
            if (number === 2244 && input.throwCloseWithConcurrentState && closeCalled) {
                state = 'CLOSED';
                closedAt = '2026-08-20T12:00:01Z';
            }
            if (number === 2244 && closeCalled && input.changedClosedAtAfterClose) {
                closedAt = '2026-08-20T12:00:02Z';
            }
            if (number === 2244 && closeCalled && input.deleteCommentAfterClose) {
                comments = comments.filter((comment) => comment.id !== 'IC_new');
            }
            if (number === 2244 && !closeCalled && input.editCommentAfterComment) {
                comments = comments.map((comment) =>
                    comment.id === 'IC_new' ? { ...comment, body: 'Edited' } : comment
                );
            }
            return snapshot(number);
        },
        comment: (number, body) => {
            calls.push(`comment:${number}:${body}`);
            commentCalled = true;
            const created = {
                id: 'IC_new',
                fullDatabaseId: '9223372036854775808',
                body: input.returnedCommentBody ?? body,
                authorLogin: AUTHOR_BOT_LOGIN,
                authorType: input.returnedCommentAuthorType ?? 'Bot',
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
                            authorType: 'Bot',
                        },
                    ];
                }
                throw new Error('comment transport lost');
            }
            return {
                ...created,
                clientMutationId: input.returnedCommentClientMutationId ?? `supersede-comment:${number}:${body}`,
            };
        },
        close: (number) => {
            calls.push(`close:${number}`);
            closeCalled = true;
            if (input.throwCloseWithConcurrentState) {
                throw new Error('close transport lost');
            }
            if (input.throwCloseOnceWithoutState && closeFailures === 0) {
                closeFailures += 1;
                throw new Error('close transport lost');
            }
            state = 'CLOSED';
            closedAt = '2026-08-20T12:00:00Z';
            return { closedAt };
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
    return {
        port,
        calls,
        authorLogin: input.authorLogin ?? AUTHOR_BOT_LOGIN,
        state: () => ({ state, closedAt, comments }),
    };
}

describe('pull-request supersession', () => {
    it('uses client mutation receipts for forward comment and close mutations', () => {
        const source = readFileSync(join(import.meta.dirname, '../supersedePullRequest.ts'), 'utf8');
        expect(source).toContain(
            'addComment(input:{subjectId:$subjectId,body:$body,clientMutationId:$clientMutationId})'
        );
        expect(source).toContain(
            'closePullRequest(input:{pullRequestId:$pullRequestId,clientMutationId:$clientMutationId})'
        );
    });
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
                        id: 'PR_kwDOExample',
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
    it('rejects partial GraphQL data with errors before accepting issue comments', () => {
        expect(() =>
            inspectIssueComments('PR_kwDOExample', () =>
                JSON.stringify({
                    data: {
                        node: {
                            id: 'PR_kwDOExample',
                            comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
                        },
                    },
                    errors: [{ message: 'partial failure' }],
                })
            )
        ).toThrow(/invalid GraphQL envelope/i);
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
                            id: 'PR_kwDOExample',
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
    it('rejects a valid-looking comment page for a different subject node', () => {
        expect(() =>
            inspectIssueComments('PR_kwDOExample', () =>
                JSON.stringify({
                    data: {
                        node: {
                            id: 'PR_other',
                            comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
                        },
                    },
                })
            )
        ).toThrow(/invalid issue comments/i);
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
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state()).toMatchObject({ state: 'OPEN', comments: [oldComment, { id: 'IC_new' }] });
    });
    it('refuses a mismatched comment client receipt before close', () => {
        const { port, calls, authorLogin } = fakePort({ returnedCommentClientMutationId: 'wrong' });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(
            /add supersession comment returned an invalid result/i
        );
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
    });
    it('rejects a User-typed comment receipt before close or success', () => {
        const { port, calls, authorLogin } = fakePort({ returnedCommentAuthorType: 'User' });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(/invalid result/i);
        expect(calls.filter((call) => call.startsWith('close:') || call.startsWith('log:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
    });
    it('refuses a retargeted old PR before close', () => {
        const { port, calls, authorLogin } = fakePort({ bases: ['main', 'release'] });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(
            /changed after supersession comment/i
        );
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
    });
    it('fails without success when the exact receipt comment disappears before final inspection', () => {
        const { port, calls, authorLogin } = fakePort({ deleteCommentAfterClose: true });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(/comment receipt/i);
        expect(calls.filter((call) => call.startsWith('reopen:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('log:'))).toEqual([]);
    });
    it('does not reopen a pull request whose close marker changed concurrently', () => {
        const { port, calls, authorLogin, state } = fakePort({ changedClosedAtAfterClose: true });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(/closed by another actor/i);
        expect(calls.filter((call) => call.startsWith('reopen:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state().comments.find((comment) => comment.id === 'IC_new')?.body).toBe('Superseded by #2246.');
        expect(state().state).toBe('CLOSED');
    });
    it('does not reopen a same-marker close when its final head check fails', () => {
        const { port, calls, authorLogin, state } = fakePort({
            heads: [head, head, head, movedHead, movedHead],
        });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(/head moved/i);
        expect(calls.filter((call) => call.startsWith('reopen:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state()).toMatchObject({ state: 'CLOSED', comments: [oldComment, { id: 'IC_new' }] });
    });
    it('rejects a late retarget after close without reopening or deleting the receipt comment', () => {
        const { port, calls, authorLogin, state } = fakePort({
            bases: ['main', 'main', 'main', 'release', 'release'],
        });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(/base changed after mutation/i);
        expect(calls.filter((call) => call.startsWith('reopen:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state()).toMatchObject({ state: 'CLOSED', comments: [oldComment, { id: 'IC_new' }] });
    });
    it('does not delete an edited comment before an unreceipted close', () => {
        const { port, calls, authorLogin, state } = fakePort({
            heads: [head, movedHead, movedHead],
            editCommentAfterComment: true,
        });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(/head moved/i);
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(state().comments.find((comment) => comment.id === 'IC_new')?.body).toBe('Edited');
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
            /close transport lost[\s\S]*durable evidence/i
        );
        expect(calls.filter((call) => call.startsWith('reopen:'))).toEqual([]);
        expect(state().state).toBe('CLOSED');
    });
    it('preserves a comment after an open close throw, then reuses it on retry', () => {
        const { port, authorLogin, state, calls } = fakePort({ throwCloseOnceWithoutState: true });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(
            /close transport lost[\s\S]*attempted[\s\S]*durable evidence/i
        );
        expect(state()).toMatchObject({ state: 'OPEN', comments: [oldComment, { id: 'IC_new' }] });
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual([]);
        expect(supersedePullRequest(2244, head, 2246, authorLogin, port)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('comment:'))).toEqual(['comment:2244:Superseded by #2246.']);
    });
    it('rolls back after a post-comment head move', () => {
        const { port, authorLogin, state, calls } = fakePort({ heads: [head, movedHead, movedHead, movedHead] });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(/head moved/i);
        expect(state()).toMatchObject({ state: 'OPEN', comments: [oldComment] });
        expect(calls).toContain('delete:IC_new');
    });
    it('reuses one exact existing supersession comment and performs the missing close', () => {
        const { port, calls, authorLogin } = fakePort({ existingCommentCount: 1 });
        expect(supersedePullRequest(2244, head, 2246, authorLogin, port)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('comment:'))).toEqual([]);
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
    });
    it('converges multiple existing supersession comments to the smallest fullDatabaseId before closing', () => {
        const { port, calls, authorLogin } = fakePort({ existingCommentCount: 2 });
        expect(supersedePullRequest(2244, head, 2246, authorLogin, port)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:IC_existing_1']);
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual(['close:2244']);
    });
    it('converges an interleaved concurrent supersession comment before closing', () => {
        const { port, calls, authorLogin, state } = fakePort({ concurrentCommentBeforeConvergence: true });
        expect(supersedePullRequest(2244, head, 2246, authorLogin, port)).toBe('pull-request-superseded:2244:2246');
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:IC_concurrent']);
        expect(state().comments.filter((comment) => comment.body === 'Superseded by #2246.')).toEqual([
            expect.objectContaining({ id: 'IC_new' }),
        ]);
    });
    it("deletes only this invocation's noncanonical comment when another invocation closes first", () => {
        const { port, calls, authorLogin, state } = fakePort({
            foreignLowerCommentBeforeConvergence: true,
            closeBeforeConvergence: true,
        });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(/changed after supersession/i);
        expect(calls.filter((call) => call.startsWith('delete:'))).toEqual(['delete:IC_new']);
        expect(calls.filter((call) => call.startsWith('close:'))).toEqual([]);
        expect(state().comments.map((comment) => comment.id)).toEqual(['IC_old', 'IC_foreign']);
    });
    it('returns completed supersession success without mutation only for one exact Bot marker', () => {
        const { port, calls, authorLogin } = fakePort({ initialState: 'CLOSED', existingCommentCount: 1 });
        expect(supersedePullRequest(2244, head, 2246, authorLogin, port)).toBe('pull-request-superseded:2244:2246');
        expect(calls).toEqual(['inspect:2244', 'inspect:2246', 'log:pull-request-superseded:2244:2246']);
    });
    it('fails closed for a completed supersession with multiple markers', () => {
        const { port, calls, authorLogin } = fakePort({ initialState: 'CLOSED', existingCommentCount: 2 });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(/exactly one/i);
        expect(calls.filter((call) => !call.startsWith('inspect:'))).toEqual([]);
    });
    it('rejects a User-typed existing supersession comment before any mutation', () => {
        const { port, calls, authorLogin } = fakePort({ existingCommentCount: 1, existingCommentAuthorType: 'User' });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(/exact author-bot/i);
        expect(calls.filter((call) => !call.startsWith('inspect:'))).toEqual([]);
    });
    it('surfaces compensation failure', () => {
        const { port, authorLogin } = fakePort({ throwAfterComment: true, failDelete: true });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(
            /comment transport lost[\s\S]*compensation failed/i
        );
    });
});
