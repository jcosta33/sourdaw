import { describe, expect, it } from 'vitest';

import { REVIEWER_BOT_LOGIN, type GhSession } from '../githubAppIdentity.ts';
import {
    parsePublishReviewArgs,
    parseReviewDocument,
    publishReview,
    shellPort,
    type PublishReviewPort,
} from '../publishReview.ts';

const validComment = {
    path: 'scripts/deliverPullRequest.ts',
    line: 10,
    side: 'RIGHT' as const,
    body: 'COMMENT still authorizes merge. A stale COMMENT could ship. Require reviewer APPROVED on this head.',
};

function fakePort(
    input: {
        head?: string;
        laterHead?: string;
        json?: unknown;
        missing?: boolean;
        login?: string;
    } = {}
) {
    const calls: string[] = [];
    const logs: string[] = [];
    let head = input.head ?? 'headsha';
    const port: PublishReviewPort = {
        primaryRoot: () => '/repo',
        currentHead: () => {
            const current = head;
            if (input.laterHead !== undefined) {
                head = input.laterHead;
            }
            return current;
        },
        readReviewJson: (path) => {
            calls.push(`read:${path}`);
            if (input.missing === true) {
                throw new Error('ENOENT');
            }
            return input.json ?? { event: 'APPROVE', body: 'ok', comments: [] };
        },
        postReview: (review) => {
            calls.push(`post:${review.commitId}:${review.event}:${review.body}`);
            return { id: 99, login: input.login ?? REVIEWER_BOT_LOGIN };
        },
        log: (message) => logs.push(message),
    };
    return { port, calls, logs };
}

describe('review publish', () => {
    it('posts as the reviewer bot on the bundle head and prints the review id', () => {
        const { port, calls, logs } = fakePort();

        expect(publishReview(42, port)).toBe(99);
        expect(calls[0]).toBe('read:/repo/.agents/review-bundles/42-headsha/review.json');
        expect(calls[1]).toBe('post:headsha:APPROVE:ok');
        expect(logs.at(-1)).toBe('99');
    });

    it('posts REQUEST_CHANGES body and comments when valid', () => {
        const { port, calls } = fakePort({
            json: { event: 'REQUEST_CHANGES', body: 'Please fix the merge gate.', comments: [validComment] },
        });

        publishReview(42, port);

        expect(calls[1]).toContain('REQUEST_CHANGES:Please fix the merge gate.');
    });

    it('refuses a moved head before posting', () => {
        const { port, calls } = fakePort({ laterHead: 'moved' });

        expect(() => publishReview(42, port)).toThrow(/head moved/);
        expect(calls.some((call) => call.startsWith('post:'))).toBe(false);
    });

    it.each([
        ['COMMENT', { event: 'COMMENT', comments: [] }],
        ['missing event', { comments: [] }],
        ['empty REQUEST_CHANGES comments', { event: 'REQUEST_CHANGES', body: 'n', comments: [] }],
        ['blank REQUEST_CHANGES body', { event: 'REQUEST_CHANGES', body: '  ', comments: [validComment] }],
        ['invalid json object', '{'],
    ])('does not post %s', (_case, json) => {
        const { port, calls } = fakePort({ json });

        expect(() => publishReview(42, port)).toThrow();
        expect(calls.some((call) => call.startsWith('post:'))).toBe(false);
    });

    it('does not post when review.json is missing', () => {
        const { port, calls } = fakePort({ missing: true });

        expect(() => publishReview(42, port)).toThrow(/missing review.json/);
        expect(calls.some((call) => call.startsWith('post:'))).toBe(false);
    });

    it('parses argv', () => {
        expect(parsePublishReviewArgs(['7'])).toEqual({ number: 7, help: false });
        expect(parseReviewDocument({ event: 'APPROVE', comments: [] }).event).toBe('APPROVE');
    });
});

/**
 * GitHub can coerce the `event` a review is posted with — observed live when the target PR closed
 * or merged between bundle preparation and posting — and still answer 200 with a review whose
 * recorded `state` disagrees with what was requested. `publishReview.spec.ts` above only exercises
 * `postReview` through a fake port, so it cannot see that coercion: it is `shellPort`'s own
 * `postReview` that reads the raw `gh` response and must compare `state` against `event` itself.
 * These tests drive `shellPort` with a fake `capture` so no real `gh` is ever reached: the sibling
 * `openLane.spec.ts` documents why `vi.mock('node:child_process')` does not intercept a module
 * under `scripts/` and why a prior spec that trusted it filed a live issue on the public tracker.
 */
describe('shellPort postReview state verification', () => {
    const session: GhSession = { configDir: '/tmp/sourdaw-gh', env: {}, dispose: () => undefined };

    function fakeCapture(reviewResponse: unknown) {
        return (command: string, args: string[]): string => {
            if (command === 'git' && args[0] === 'rev-parse') {
                return `${process.cwd()}/.git`;
            }
            if (command === 'gh' && args[0] === 'api') {
                return JSON.stringify(reviewResponse);
            }
            throw new Error(`unexpected command in test: ${command} ${args.join(' ')}`);
        };
    }

    it('fails loudly, naming both the requested event and the recorded state, when GitHub coerces the review', () => {
        const capture = fakeCapture({ id: 4985383093, state: 'APPROVED', user: { login: REVIEWER_BOT_LOGIN } });
        const port = shellPort(session, process.cwd(), capture);

        expect(() =>
            port.postReview({ number: 2353, commitId: 'sha', event: 'REQUEST_CHANGES', body: 'no', comments: [] })
        ).toThrow(/requested REQUEST_CHANGES but GitHub recorded APPROVED/);
    });

    it('posts successfully when the recorded state agrees with the requested event', () => {
        const capture = fakeCapture({ id: 42, state: 'CHANGES_REQUESTED', user: { login: REVIEWER_BOT_LOGIN } });
        const port = shellPort(session, process.cwd(), capture);

        expect(
            port.postReview({ number: 42, commitId: 'sha', event: 'REQUEST_CHANGES', body: 'no', comments: [] })
        ).toEqual({ id: 42, login: REVIEWER_BOT_LOGIN });
    });

    it('posts successfully when APPROVE is recorded as APPROVED', () => {
        const capture = fakeCapture({ id: 43, state: 'APPROVED', user: { login: REVIEWER_BOT_LOGIN } });
        const port = shellPort(session, process.cwd(), capture);

        expect(port.postReview({ number: 42, commitId: 'sha', event: 'APPROVE', body: '', comments: [] })).toEqual({
            id: 43,
            login: REVIEWER_BOT_LOGIN,
        });
    });
});
