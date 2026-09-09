import { describe, expect, it } from 'vitest';

import { shellPort } from '../deliverPullRequest';
import { REVIEWER_BOT_NODE_ID } from '../githubAppIdentity';

const head = 'a'.repeat(40);
const userId = 'MDQ6VXNlcjg5NzgyNzA=';
function review(id: string, actorId: string, state = 'APPROVED', commit = head, actorType = 'User') {
    return {
        id,
        state,
        submittedAt: '2026-09-09T00:00:00Z',
        author: { id: actorId, login: 'display-only', __typename: actorType },
        commit: { oid: commit },
    };
}
const reviewer = () => review('reviewer', REVIEWER_BOT_NODE_ID, 'APPROVED', head, 'Bot');
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

describe('orchestrator review ordering', () => {
    it('requires the pinned user acceptance after the independent bot in connection order', () => {
        expect(inspect([reviewer(), acceptance()])).toMatchObject({
            latestReviewerStateOnHead: 'APPROVED',
            orchestratorAcceptedAfterReviewer: true,
        });
        expect(inspect([acceptance(), reviewer()])).toMatchObject({ orchestratorAcceptedAfterReviewer: false });
    });
    it.each([
        [reviewer()],
        [reviewer(), review('wrong-user', 'other')],
        [reviewer(), review('wrong-type', userId, 'APPROVED', head, 'Bot')],
        [reviewer(), review('stale', userId, 'APPROVED', 'b'.repeat(40))],
        [reviewer(), acceptance(), review('dismissed', userId, 'DISMISSED')],
        [reviewer(), acceptance(), review('rejected', userId, 'CHANGES_REQUESTED')],
        [reviewer(), acceptance(), review('new-stale', userId, 'APPROVED', 'b'.repeat(40))],
    ])('refuses missing, stale, impersonated, or superseded acceptance %#', (...reviews) => {
        expect(inspect(reviews)).toMatchObject({ orchestratorAcceptedAfterReviewer: false });
    });
    it('does not resurrect a dismissed or wrong-head reviewer approval', () => {
        expect(
            inspect([reviewer(), acceptance(), review('dismissed', REVIEWER_BOT_NODE_ID, 'DISMISSED', head, 'Bot')])
                .latestReviewerStateOnHead
        ).toBe('DISMISSED');
        expect(
            inspect([
                reviewer(),
                acceptance(),
                review('stale', REVIEWER_BOT_NODE_ID, 'APPROVED', 'b'.repeat(40), 'Bot'),
            ]).latestReviewerStateOnHead
        ).toBeNull();
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
