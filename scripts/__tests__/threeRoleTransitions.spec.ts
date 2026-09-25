/**
 * AC-002/AC-003 firmware (#3376, spec #3367; #4584): the three-role permission matrix, updated for
 * the single-approval cutover. The reviewer publication is now the delivery authorization and the
 * author App merges its own pull request, so the orchestrator's second (acceptance) approval is gone
 * from the review-state read entirely: an orchestrator approval no longer moves any gate. What
 * remains pinned here is role non-interchangeability — only the reviewer bot's current-head APPROVED
 * ever reads as the independent approval, and neither an author-App nor an orchestrator-User review
 * substitutes for it. The delivery-authorization binding and stale-head refusals are pinned in
 * deliverPullRequest.spec.ts, which owns the `deliver` enforcement surface.
 */

import { describe, expect, it } from 'vitest';

import { shellPort } from '../deliverPullRequest.ts';
import {
    AUTHOR_BOT_DATABASE_ID,
    AUTHOR_BOT_NODE_ID,
    ORCHESTRATOR_USER_NODE_ID,
    REVIEWER_BOT_NODE_ID,
} from '../githubAppIdentity.ts';

const head = 'a'.repeat(40);

type Actor = 'author' | 'reviewer' | 'orchestrator';

const ACTOR_IDS: Record<Actor, { id: string; typename: string }> = {
    author: { id: AUTHOR_BOT_NODE_ID, typename: 'Bot' },
    reviewer: { id: REVIEWER_BOT_NODE_ID, typename: 'Bot' },
    orchestrator: { id: ORCHESTRATOR_USER_NODE_ID, typename: 'User' },
};

function review(id: string, actor: Actor, commit = head, databaseId = 1) {
    return {
        id,
        databaseId,
        state: 'APPROVED',
        submittedAt: '2026-09-21T00:00:00Z',
        author: { id: ACTOR_IDS[actor].id, login: `${actor}-login`, __typename: ACTOR_IDS[actor].typename },
        commit: { oid: commit },
    };
}

function inspect(reviews: ReturnType<typeof review>[]) {
    const payload = JSON.stringify({
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
    });
    return shellPort('jcosta33/sourdaw', { capture: () => payload, run: () => undefined }).reviewState(42, head);
}

describe('three-role permission matrix (spec #3367 AC-002, #4584)', () => {
    it('pins three pairwise-distinct immutable actor identities', () => {
        const ids = [AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID, ORCHESTRATOR_USER_NODE_ID];
        expect(new Set(ids).size).toBe(3);
        expect(AUTHOR_BOT_DATABASE_ID).toBe(318698904);
    });

    it('reads only the reviewer approval on the current head as the independent approval', () => {
        expect(inspect([review('reviewer-approval', 'reviewer')])).toEqual({
            latestReviewerStateOnHead: 'APPROVED',
            latestReviewerReviewDatabaseId: 1,
            unresolvedThreads: 0,
        });
    });

    it.each([
        ['an author-App approval', [review('author-as-reviewer', 'author')]],
        ['an orchestrator-User approval', [review('orchestrator-as-reviewer', 'orchestrator')]],
        ['an author then reviewer approval on a stale head', [review('stale-reviewer', 'reviewer', 'b'.repeat(40))]],
    ])('never counts %s as the independent reviewer approval', (_label, reviews) => {
        expect(inspect(reviews).latestReviewerStateOnHead).toBeNull();
    });

    it('ignores a later orchestrator approval when judging the reviewer approval on the head', () => {
        // An orchestrator approval no longer unlocks delivery: the review-state read carries no
        // acceptance signal, and the reviewer's on-head verdict is unchanged by it.
        const state = inspect([
            review('reviewer-approval', 'reviewer'),
            review('orchestrator-acceptance', 'orchestrator', head, 777),
        ]);
        expect(state).toEqual({
            latestReviewerStateOnHead: 'APPROVED',
            latestReviewerReviewDatabaseId: 1,
            unresolvedThreads: 0,
        });
    });
});
