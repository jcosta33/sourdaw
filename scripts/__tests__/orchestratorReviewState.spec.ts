import { describe, expect, it } from 'vitest';

import { shellPort } from '../deliverPullRequest';
import { REVIEWER_BOT_NODE_ID } from '../githubAppIdentity';

/**
 * The orchestrator acceptance review is no longer part of the review-state read (#4584): the
 * reviewer publication is the delivery authorization, so this spec pins only the reviewer
 * approval-on-head ordering that remains — the greatest database id is the latest reviewer review
 * whatever order or timestamps GitHub lists them in, a reviewer review without a unique id refuses,
 * a dismissed or wrong-head reviewer approval is never resurrected, and a review mutation between the
 * two complete scans is refused.
 */
const head = 'a'.repeat(40);
const userId = 'MDQ6VXNlcjg5NzgyNzA=';
let nextDatabaseId = 2;
function review(
    id: string,
    actorId: string,
    state = 'APPROVED',
    commit = head,
    actorType = 'User',
    databaseId: number | null = nextDatabaseId++,
    submittedAt = '2026-09-09T00:00:00Z'
) {
    return {
        id,
        databaseId,
        state,
        submittedAt,
        author: { id: actorId, login: 'display-only', __typename: actorType },
        commit: { oid: commit },
    };
}
const reviewer = () => review('reviewer', REVIEWER_BOT_NODE_ID, 'APPROVED', head, 'Bot', 1);
const acceptance = () => review('acceptance', userId);
function state(reviews: ReturnType<typeof review>[]) {
    return {
        data: {
            repository: {
                pullRequest: {
                    id: 'PR_1',
                    headRefOid: head,
                    reviews: { nodes: reviews, pageInfo: { hasPreviousPage: false, startCursor: null } },
                    reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
                },
            },
        },
    };
}
function inspect(reviews: ReturnType<typeof review>[]) {
    return shellPort('jcosta33/sourdaw', {
        capture: () => JSON.stringify(state(reviews)),
        run: () => undefined,
    }).reviewState(1, head);
}

describe('reviewer review ordering', () => {
    it('keeps the reviewer approval on the head regardless of a later orchestrator acceptance', () => {
        expect(inspect([reviewer(), acceptance()])).toEqual({
            latestReviewerStateOnHead: 'APPROVED',
            latestReviewerReviewDatabaseId: 1,
            latestReviewerCommitOid: head,
            unresolvedThreads: 0,
        });
    });

    it.each([
        [reviewer()],
        [reviewer(), review('wrong-user', 'other')],
        [reviewer(), review('wrong-type', userId, 'APPROVED', head, 'Bot')],
        [reviewer(), acceptance(), review('dismissed', userId, 'DISMISSED')],
        [reviewer(), acceptance(), review('rejected', userId, 'CHANGES_REQUESTED')],
        [reviewer(), acceptance(), review('new-stale', userId, 'APPROVED', 'b'.repeat(40))],
    ])('keeps the reviewer approval or refuses a missing one %#', (...reviews) => {
        expect(inspect(reviews).latestReviewerStateOnHead).toBe('APPROVED');
    });

    it('does not resurrect a dismissed or wrong-head reviewer approval', () => {
        expect(
            inspect([reviewer(), acceptance(), review('dismissed', REVIEWER_BOT_NODE_ID, 'DISMISSED', head, 'Bot')])
                .latestReviewerStateOnHead
        ).toBe('DISMISSED');
        const stale = inspect([
            reviewer(),
            acceptance(),
            review('stale', REVIEWER_BOT_NODE_ID, 'APPROVED', 'b'.repeat(40), 'Bot'),
        ]);
        expect(stale.latestReviewerStateOnHead).toBeNull();
        expect(stale.latestReviewerCommitOid).toBe('b'.repeat(40));
        expect(inspect([]).latestReviewerCommitOid).toBeNull();
    });

    it('reads the greatest reviewer id as latest even when GitHub lists it first with an earlier time', () => {
        const prior = (id: string, state: string, databaseId: number, submittedAt: string) =>
            review(id, REVIEWER_BOT_NODE_ID, state, 'b'.repeat(40), 'Bot', databaseId, submittedAt);
        expect(
            inspect([
                review('approve', REVIEWER_BOT_NODE_ID, 'APPROVED', head, 'Bot', 5727308468, '2026-11-01T09:04:05Z'),
                prior('changes', 'CHANGES_REQUESTED', 5727088879, '2026-11-01T09:10:05Z'),
                review('author-note', userId, 'COMMENTED', 'c'.repeat(40), 'User', 5727204846, '2026-11-01T09:30:31Z'),
                prior('note', 'COMMENTED', 5727205309, '2026-11-01T09:30:37Z'),
            ])
        ).toEqual({
            latestReviewerStateOnHead: 'APPROVED',
            latestReviewerReviewDatabaseId: 5727308468,
            latestReviewerCommitOid: head,
            unresolvedThreads: 0,
        });
    });

    it('does not read an older reviewer approval as latest when a newer id requests changes', () => {
        const read = inspect([
            review('rejected', REVIEWER_BOT_NODE_ID, 'CHANGES_REQUESTED', head, 'Bot', 20, '2026-11-01T09:00:00Z'),
            review('approve', REVIEWER_BOT_NODE_ID, 'APPROVED', head, 'Bot', 10, '2026-11-01T10:00:00Z'),
        ]);
        expect(read.latestReviewerStateOnHead).toBe('CHANGES_REQUESTED');
        expect(read.latestReviewerReviewDatabaseId).toBeNull();
    });

    it('compares reviewer ids as numbers', () => {
        const read = inspect([
            review('approve', REVIEWER_BOT_NODE_ID, 'APPROVED', head, 'Bot', 9),
            review('rejected', REVIEWER_BOT_NODE_ID, 'CHANGES_REQUESTED', head, 'Bot', 10),
        ]);
        expect(read.latestReviewerStateOnHead).toBe('CHANGES_REQUESTED');
    });

    it('skips a pending reviewer review, even with a greater or missing id', () => {
        for (const databaseId of [99, null]) {
            const read = inspect([
                reviewer(),
                review('draft', REVIEWER_BOT_NODE_ID, 'PENDING', head, 'Bot', databaseId),
            ]);
            expect(read.latestReviewerStateOnHead).toBe('APPROVED');
            expect(read.latestReviewerReviewDatabaseId).toBe(1);
        }
    });

    it('ignores a non-reviewer review with a greater id', () => {
        const read = inspect([reviewer(), review('later-user', userId, 'CHANGES_REQUESTED', head, 'User', 99)]);
        expect(read.latestReviewerStateOnHead).toBe('APPROVED');
        expect(read.latestReviewerReviewDatabaseId).toBe(1);
    });

    it.each([
        [
            'a missing id',
            [reviewer(), review('no-id', REVIEWER_BOT_NODE_ID, 'COMMENTED', head, 'Bot', null)],
            'PR #1 has incomplete reviewer review identity',
        ],
        [
            'a duplicate id',
            [reviewer(), review('same-id', REVIEWER_BOT_NODE_ID, 'COMMENTED', head, 'Bot', 1)],
            'cannot prove reviewer review order for PR #1',
        ],
    ])('refuses a reviewer review with %s', (_label, reviews, refusal) => {
        expect(() => inspect(reviews)).toThrow(refusal);
    });

    it('refuses review mutation between complete scans', () => {
        let calls = 0;
        const port = shellPort('jcosta33/sourdaw', {
            capture: () => JSON.stringify(state(++calls === 1 ? [reviewer(), acceptance()] : [reviewer()])),
            run: () => undefined,
        });
        expect(() => port.reviewState(1, head)).toThrow('stable review state');
    });
});
