import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_LOGIN } from '../githubAppIdentity.ts';
import {
    parseSupersedePullRequestArgs,
    supersedePullRequest,
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
    throwAfterClose?: boolean;
    failDelete?: boolean;
};
function fakePort(input: Input = {}) {
    const calls: string[] = [];
    let index = 0;
    let state = 'OPEN';
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
            return snapshot(number);
        },
        comment: (number, body) => {
            calls.push(`comment:${number}:${body}`);
            const created = {
                id: 'IC_new',
                fullDatabaseId: '9223372036854775808',
                body,
                authorLogin: AUTHOR_BOT_LOGIN,
            };
            comments = [...comments, created];
            if (input.throwAfterComment) {
                throw new Error('comment transport lost');
            }
            return created;
        },
        close: (number) => {
            calls.push(`close:${number}`);
            state = 'CLOSED';
            if (input.throwAfterClose) {
                throw new Error('close transport lost');
            }
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
    it('compensates a comment that committed before its mutation threw', () => {
        const { port, authorLogin, state } = fakePort({ throwAfterComment: true });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(/comment transport lost$/);
        expect(state()).toMatchObject({ state: 'OPEN', comments: [oldComment] });
    });
    it('compensates a close that committed before its mutation threw', () => {
        const { port, authorLogin, state } = fakePort({ throwAfterClose: true });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(/close transport lost$/);
        expect(state()).toMatchObject({ state: 'OPEN', comments: [oldComment] });
    });
    it('rolls back after a post-comment head move', () => {
        const { port, authorLogin, state } = fakePort({ heads: [head, movedHead, movedHead, movedHead] });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(/head moved/i);
        expect(state()).toMatchObject({ state: 'OPEN', comments: [oldComment] });
    });
    it('surfaces compensation failure', () => {
        const { port, authorLogin } = fakePort({ throwAfterComment: true, failDelete: true });
        expect(() => supersedePullRequest(2244, head, 2246, authorLogin, port)).toThrow(
            /comment transport lost[\s\S]*compensation failed/i
        );
    });
});
