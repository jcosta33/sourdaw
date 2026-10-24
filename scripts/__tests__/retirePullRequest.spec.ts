import { describe, expect, it } from 'vitest';

import { renderConfirmationReply } from '../confirmReviewRepairs.ts';
import { AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import { parseRetirementRecord, renderRetirementMarker, type RetirementRecord } from '../retirementRecord.ts';
import {
    inspectRetirementReviewState,
    parseRetirePullRequestArgs,
    retirePullRequest,
    type RetirePullRequestPort,
    type RetirementReviewState,
} from '../retirePullRequest.ts';
import { renderReviewRepairReply, type ReviewRepairRecord } from '../reviewRepair.ts';
import { commentClientMutationId, type IssueComment, type SupersededPullRequest } from '../supersedePullRequestGh.ts';

const pr = 5361;
const head = 'a'.repeat(40);
const findingId = '1001';
const reviewId = 'PRR_requested';
const threadId = 'PRRT_1';
const repairId = '1002';
const confirmationId = '1003';
const repair: ReviewRepairRecord = {
    format: 'repair-v1',
    pr,
    thread: threadId,
    finding: { commentId: Number(findingId), path: 'scripts/test-health-gate-scripts.sh', line: 237, side: 'RIGHT' },
    commit: head,
    summary: 'Corrected the audit note.',
    evidence: [],
    head,
};
const record: RetirementRecord = {
    format: 'retirement-v1',
    pr,
    head,
    base: 'main',
    rationale: 'The obsolete source branch was retired; the unsuppressed hosted scan now passes.',
    evidence: [
        {
            url: 'https://github.com/jcosta33/sourdaw/actions/runs/39926416970',
            observation: 'Scheduled scan detected its positive control and found no real target leak.',
        },
    ],
    findings: [
        {
            rootCommentId: findingId,
            threadId,
            authorRepairCommentId: repairId,
            reviewerConfirmationCommentId: confirmationId,
        },
    ],
    reviewBodies: [{ reviewId, rootCommentIds: [findingId] }],
};

function comment(id: string, body: string, authorNodeId: string): IssueComment {
    return {
        id: `IC_${id}`,
        fullDatabaseId: id,
        body,
        authorNodeId,
        authorLogin: 'bot[bot]',
        authorType: 'Bot',
    };
}

function reviewState(): RetirementReviewState {
    return {
        threads: [
            {
                threadId,
                rootCommentId: findingId,
                rootReviewId: reviewId,
                resolved: true,
                replies: [
                    { id: repairId, body: renderReviewRepairReply(repair), authorNodeId: AUTHOR_BOT_NODE_ID },
                    {
                        id: confirmationId,
                        body: renderConfirmationReply(repair, head),
                        authorNodeId: REVIEWER_BOT_NODE_ID,
                    },
                ],
            },
        ],
        requestedReviews: [{ reviewId, body: 'One audit fact is wrong.', head }],
    };
}

type FixtureOptions = {
    head?: string;
    headRepository?: string | null;
    base?: string;
    reviewState?: RetirementReviewState;
    afterCommentReviewState?: RetirementReviewState;
    closeError?: boolean;
    closeMovesHead?: boolean;
};

function fixture(options: FixtureOptions = {}) {
    const calls: string[] = [];
    let state = 'OPEN';
    let closedAt: string | null = null;
    let currentHead = options.head ?? head;
    let comments: IssueComment[] = [];
    let commentPosted = false;
    const inspect = (): SupersededPullRequest => ({
        number: pr,
        state,
        head: currentHead,
        headRefName: 'agent/4944/nightly-secret-scan-bacteria-fingerprint',
        headRepository: options.headRepository === undefined ? 'jcosta33/sourdaw' : options.headRepository,
        repository: 'jcosta33/sourdaw',
        base: options.base ?? 'main',
        merged: false,
        closedAt,
        comments: [...comments],
    });
    const port: RetirePullRequestPort = {
        inspect: () => inspect(),
        inspectReviewThreads: () => [],
        inspectRetirementReviewState: () => {
            calls.push('reviews');
            if (commentPosted) {
                return options.afterCommentReviewState ?? options.reviewState ?? reviewState();
            }
            return options.reviewState ?? reviewState();
        },
        comment: (_number, body) => {
            calls.push('comment');
            commentPosted = true;
            const created = comment('2001', body, AUTHOR_BOT_NODE_ID);
            comments.push(created);
            return { ...created, clientMutationId: commentClientMutationId(pr, body) };
        },
        close: () => {
            calls.push('close');
            if (options.closeError) {
                throw new Error('close transport lost');
            }
            state = 'CLOSED';
            closedAt = '2026-10-24T00:00:00Z';
            if (options.closeMovesHead) {
                currentHead = 'b'.repeat(40);
            }
            return { closedAt };
        },
        deleteComment: (id) => {
            calls.push('delete');
            comments = comments.filter((entry) => entry.id !== id);
        },
        log: (message) => calls.push(message),
    };
    return { calls, port, state: () => inspect() };
}

describe('native obsolete pull-request retirement', () => {
    it('reproduces the missing native path by requiring a confirmed-repair record to close exactly once', () => {
        const { calls, port, state } = fixture();

        expect(retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toBe('pull-request-retired:5361');
        expect(state().state).toBe('CLOSED');
        expect(state().comments).toHaveLength(1);
        expect(state().comments[0]?.body).toBe(renderRetirementMarker(record));
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual(['comment', 'close']);

        expect(retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toBe('pull-request-retired:5361');
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual(['comment', 'close']);
    });

    it.each([
        ['wrong actor', REVIEWER_BOT_NODE_ID, record, reviewState(), head, 'main'],
        ['moved head', AUTHOR_BOT_NODE_ID, record, reviewState(), 'b'.repeat(40), 'main'],
        ['moved base', AUTHOR_BOT_NODE_ID, record, reviewState(), head, 'other'],
        [
            'unresolved root',
            AUTHOR_BOT_NODE_ID,
            record,
            { ...reviewState(), threads: [{ ...reviewState().threads[0]!, resolved: false }] },
            head,
            'main',
        ],
        ['missing root', AUTHOR_BOT_NODE_ID, record, { ...reviewState(), threads: [] }, head, 'main'],
        [
            'unmapped body review',
            AUTHOR_BOT_NODE_ID,
            record,
            { ...reviewState(), requestedReviews: [{ reviewId: 'PRR_other', body: 'An additional issue.', head }] },
            head,
            'main',
        ],
    ] as const)('refuses %s before any remote write', (_label, actor, input, reviews, actualHead, base) => {
        const { calls, port } = fixture({ head: actualHead, base, reviewState: reviews });

        expect(() => retirePullRequest(pr, head, input, actor, port)).toThrow();
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual([]);
    });

    it('refuses a reviewer confirmation whose record digest differs from the author repair', () => {
        const changed = { ...repair, summary: 'Different repair.' };
        const reviews = reviewState();
        reviews.threads[0]!.replies[1] = {
            id: confirmationId,
            body: renderConfirmationReply(changed, head),
            authorNodeId: REVIEWER_BOT_NODE_ID,
        };
        const { calls, port } = fixture({ reviewState: reviews });

        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow();
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual([]);
    });

    it.each([null, 'fork-owner/sourdaw'])('refuses a %s source repository before any write', (headRepository) => {
        const { calls, port } = fixture({ headRepository });
        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow();
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual([]);
    });

    it('refuses a retirement with no confirmed finding or requested review', () => {
        const { calls, port } = fixture({ reviewState: { threads: [], requestedReviews: [] } });
        expect(() =>
            retirePullRequest(pr, head, { ...record, findings: [], reviewBodies: [] }, AUTHOR_BOT_NODE_ID, port)
        ).toThrow();
        expect(calls.filter((call) => call === 'comment' || call === 'close')).toEqual([]);
    });

    it('compensates a newly posted marker when the review-root set changes before close', () => {
        const changed = reviewState();
        changed.threads.push({ ...changed.threads[0]!, threadId: 'PRRT_new', rootCommentId: '1004' });
        const { calls, port, state } = fixture({ afterCommentReviewState: changed });

        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow();
        expect(state().state).toBe('OPEN');
        expect(state().comments).toEqual([]);
        expect(calls.filter((call) => call === 'comment' || call === 'close' || call === 'delete')).toEqual([
            'comment',
            'delete',
        ]);
    });

    it('preserves the exact marker and refuses success when close transport is ambiguous', () => {
        const { calls, port, state } = fixture({ closeError: true });

        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow(/close transport lost/u);
        expect(state().comments).toHaveLength(1);
        expect(calls).not.toContain('delete');
    });

    it('refuses post-close head movement and preserves the marker for investigation', () => {
        const { calls, port, state } = fixture({ closeMovesHead: true });
        expect(() => retirePullRequest(pr, head, record, AUTHOR_BOT_NODE_ID, port)).toThrow();
        expect(state().state).toBe('CLOSED');
        expect(state().comments).toHaveLength(1);
        expect(calls).not.toContain('delete');
    });

    it('rejects malformed, duplicate-key and credential-shaped records before publication', () => {
        expect(() => parseRetirementRecord('{"format":"retirement-v1","format":"retirement-v1"}')).toThrow();
        expect(() => parseRetirementRecord(JSON.stringify({ ...record, rationale: 'Bearer abc123' }))).toThrow();
    });

    it('requires exact CLI head and record arguments', () => {
        expect(parseRetirePullRequestArgs(['5361', '--head', head, '--record', '/tmp/retirement.json'])).toMatchObject({
            number: pr,
            head,
            recordPath: '/tmp/retirement.json',
        });
        expect(() => parseRetirePullRequestArgs(['5361', '--record', '/tmp/retirement.json'])).toThrow();
    });

    it.each([
        ['other-owner/sourdaw', pr],
        ['jcosta33/sourdaw', pr + 1],
    ])('refuses review read bound to repository %s and PR %i', (repository, number) => {
        const page = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
        const gh = () =>
            JSON.stringify({
                data: {
                    repository: {
                        nameWithOwner: repository,
                        pullRequest: { number, reviewThreads: page, reviews: page },
                    },
                },
            });
        expect(() => inspectRetirementReviewState(pr, gh)).toThrow();
    });
});
