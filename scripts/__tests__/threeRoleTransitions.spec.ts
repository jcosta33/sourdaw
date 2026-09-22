/**
 * AC-002/AC-003 firmware (#3376, spec #3367): the three-role permission matrix and the ordered
 * transition fixtures, pinned at the enforcement points every surface shares. Each command's own
 * spec covers its interior refusals (authorship gate in publishLane.spec.ts, repair ancestry in
 * reviewRepair.spec.ts, thread identity in repairReviewFinding.spec.ts); this file fails when a
 * cross-role rule itself regresses — a role impersonating another, or a transition firing out of
 * order.
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

describe('three-role permission matrix (spec #3367 AC-002)', () => {
    it('pins three pairwise-distinct immutable actor identities', () => {
        const ids = [AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID, ORCHESTRATOR_USER_NODE_ID];
        expect(new Set(ids).size).toBe(3);
        expect(AUTHOR_BOT_DATABASE_ID).toBe(318698904);
    });

    it('admits only the reviewer approval followed by the orchestrator acceptance on the head', () => {
        const state = inspect([
            review('reviewer-approval', 'reviewer'),
            review('acceptance', 'orchestrator', head, 777),
        ]);
        expect(state).toEqual({
            latestReviewerStateOnHead: 'APPROVED',
            latestReviewerReviewDatabaseId: 1,
            orchestratorAcceptedAfterReviewer: true,
            orchestratorAcceptanceReviewDatabaseId: 777,
            unresolvedThreads: 0,
        });
    });

    it.each([
        [
            'author approving as reviewer',
            [review('author-as-reviewer', 'author'), review('acceptance', 'orchestrator')],
        ],
        [
            'author accepting as orchestrator',
            [review('reviewer-approval', 'reviewer'), review('author-as-orchestrator', 'author')],
        ],
        [
            'reviewer accepting as orchestrator',
            [review('reviewer-approval', 'reviewer'), review('reviewer-as-orchestrator', 'reviewer')],
        ],
        [
            'orchestrator accepting before the reviewer approves',
            [review('early-acceptance', 'orchestrator'), review('reviewer-approval', 'reviewer')],
        ],
        [
            'orchestrator acceptance left behind on a stale head',
            [review('reviewer-approval', 'reviewer'), review('stale-acceptance', 'orchestrator', 'b'.repeat(40))],
        ],
    ])('refuses %s', (_label, reviews) => {
        const state = inspect(reviews);
        expect(state.orchestratorAcceptedAfterReviewer).toBe(false);
        expect(state.orchestratorAcceptanceReviewDatabaseId).toBeNull();
    });

    it('never counts an author review as the independent reviewer approval', () => {
        expect(
            inspect([review('author-as-reviewer', 'author'), review('acceptance', 'orchestrator')])
                .latestReviewerStateOnHead
        ).toBeNull();
    });
});
