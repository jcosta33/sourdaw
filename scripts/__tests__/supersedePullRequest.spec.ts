import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_LOGIN } from '../githubAppIdentity.ts';
import {
    parseSupersedePullRequestArgs,
    supersedePullRequest,
    type SupersedePullRequestPort,
} from '../supersedePullRequest.ts';

const head = 'a'.repeat(40);
const movedHead = 'b'.repeat(40);
type Snapshot = { number: number; state: string; head: string; repository: string; base: string };

function fakePort(
    input: { old?: Partial<Snapshot>; replacement?: Partial<Snapshot>; heads?: string[]; failDelete?: boolean } = {}
) {
    const calls: string[] = [];
    let oldState = input.old?.state ?? 'OPEN';
    let commentExists = false;
    let index = 0;
    const old = (): Snapshot => ({
        number: 2244,
        state: oldState,
        head: input.heads?.[index++] ?? input.old?.head ?? head,
        repository: input.old?.repository ?? 'jcosta33/sourdaw',
        base: input.old?.base ?? 'main',
    });
    const replacement = (): Snapshot => ({
        number: 2246,
        state: input.replacement?.state ?? 'MERGED',
        head: input.replacement?.head ?? 'c'.repeat(40),
        repository: input.replacement?.repository ?? 'jcosta33/sourdaw',
        base: input.replacement?.base ?? 'main',
    });
    const port: SupersedePullRequestPort = {
        inspect: (number) => {
            calls.push(`inspect:${number}`);
            return number === 2244 ? old() : replacement();
        },
        comment: (number, body) => {
            calls.push(`comment:${number}:${body}`);
            commentExists = true;
            return { id: 'IC_comment', fullDatabaseId: '9223372036854775808' };
        },
        close: (number) => {
            calls.push(`close:${number}`);
            oldState = 'CLOSED';
        },
        reopen: (number) => {
            calls.push(`reopen:${number}`);
            oldState = 'OPEN';
        },
        deleteComment: (id) => {
            calls.push(`delete:${id}`);
            if (input.failDelete === true) {
                throw new Error('delete denied');
            }
            commentExists = false;
        },
        inspectComment: () => commentExists,
        log: (message) => calls.push(`log:${message}`),
    };
    return { calls, port };
}

describe('pull-request supersession', () => {
    it('requires strict arguments', () => {
        expect(parseSupersedePullRequestArgs(['2244', '--head', head, '--replacement', '2246'])).toEqual({
            oldNumber: 2244,
            head,
            replacementNumber: 2246,
            help: false,
        });
        for (const args of [
            [],
            ['2244', '--replacement', '2246', '--head', head],
            ['0', '--head', head, '--replacement', '2246'],
        ]) {
            expect(() => parseSupersedePullRequestArgs(args)).toThrow(/usage/i);
        }
    });
    it.each([
        ['wrong identity', 'other[bot]', {}],
        ['replacement not merged', AUTHOR_BOT_LOGIN, { replacement: { state: 'OPEN' } }],
        ['old head mismatch', AUTHOR_BOT_LOGIN, { old: { head: movedHead } }],
    ])('refuses %s without mutations', (_case, login, input) => {
        const { port, calls } = fakePort(input);
        expect(() => supersedePullRequest(2244, head, 2246, login, port)).toThrow();
        expect(calls.filter((call) => /^(comment|close|reopen|delete):/.test(call))).toEqual([]);
    });
    it('comments, reinspects, closes, and verifies in that order', () => {
        const { port, calls } = fakePort();
        expect(supersedePullRequest(2244, head, 2246, AUTHOR_BOT_LOGIN, port)).toBe(
            'pull-request-superseded:2244:2246'
        );
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
    it('deletes its comment when the head moves after commenting', () => {
        const { port, calls } = fakePort({ heads: [head, movedHead, movedHead] });
        expect(() => supersedePullRequest(2244, head, 2246, AUTHOR_BOT_LOGIN, port)).toThrow(/head moved/i);
        expect(calls).toEqual([
            'inspect:2244',
            'inspect:2246',
            'comment:2244:Superseded by #2246.',
            'inspect:2244',
            'delete:IC_comment',
            'inspect:2244',
        ]);
    });
    it('reopens and deletes its comment when the head moves after closing', () => {
        const { port, calls } = fakePort({ heads: [head, head, movedHead, movedHead] });
        expect(() => supersedePullRequest(2244, head, 2246, AUTHOR_BOT_LOGIN, port)).toThrow(/head moved/i);
        expect(calls).toEqual([
            'inspect:2244',
            'inspect:2246',
            'comment:2244:Superseded by #2246.',
            'inspect:2244',
            'close:2244',
            'inspect:2244',
            'reopen:2244',
            'delete:IC_comment',
            'inspect:2244',
        ]);
    });
    it('reports compensation failures', () => {
        const { port } = fakePort({ heads: [head, movedHead], failDelete: true });
        expect(() => supersedePullRequest(2244, head, 2246, AUTHOR_BOT_LOGIN, port)).toThrow(/compensation failed/i);
    });
});
