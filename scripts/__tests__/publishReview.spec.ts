import { describe, expect, it } from 'vitest';

import { REVIEWER_BOT_LOGIN } from '../githubAppIdentity.ts';
import {
    parsePublishReviewArgs,
    parseReviewDocument,
    publishReview,
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
