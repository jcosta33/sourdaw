import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import { composeReviewCommentBody } from '../prContract.ts';
import {
    parseReviewDocument,
    renderReviewDocumentBody,
    reviewPublicationPayload,
    reviewPublicationPayloadDigest,
} from '../publishReview.ts';
import {
    pullRequestMutationLockRef,
    readPullRequestMutationLockOid,
    readPullRequestMutationLockReceipt,
    writePullRequestMutationLockOwner,
} from '../pullRequestMutationLock.ts';
import { runRecoverPublishReviewLockCli } from '../recoverPublishReviewLock.ts';
import { inspectReviewPublicationRemote } from '../reviewPublicationRemoteInspection.ts';

/*
 * The #5008 incident on PR 4997: review:publish posted review 5433781938 at head 090d3d5 and died
 * before recording it, and recovery refused the dead owner. The reviews and comments below keep
 * the shape the REST GETs return for that head — two earlier COMMENTED reviews the reviewer App
 * minted by replying to the previous round's threads, author-App replies, the landed
 * CHANGES_REQUESTED review, and comments whose current `line` and `original_side` read back null.
 */
const number = 4997;
const head = '090d3d5b983dadef55d6a84c6b231d2afb6642a4';
const previousHead = 'ca0ca85448c868d858d43dd54242c2318b10aa93';
const landedReviewId = 5433781938;

const reviewDocumentJson = {
    event: 'REQUEST_CHANGES',
    reviewerModel: 'claude-opus-5-5',
    body: 'Stacking unrelated lanes to serialize a digest collides with the stack procedure and does not prevent the collision.',
    comments: [
        {
            path: 'AGENTS.md',
            line: 670,
            side: 'RIGHT',
            defect: 'The rule stacks unrelated lanes on a shared digest',
            consequence: 'Stacked unrelated lanes inherit relates and end-to-end duties',
            done: 'Shared files wait or stack only on a real dependency',
        },
        {
            path: 'AGENTS.md',
            line: 64,
            side: 'RIGHT',
            defect: 'The added clause makes stacking a scheduling tool',
            consequence: 'A serialization stack keeps the parent issue open through relates',
            done: 'Restore this sentence to stacking only for a real dependency',
        },
    ],
};

const document = parseReviewDocument(reviewDocumentJson);
const renderedBody = renderReviewDocumentBody(document);
const landedCommentBodies = document.comments.map((comment) => composeReviewCommentBody(comment));

type RestReview = { id: number; state: string; body: string; commit_id: string; user: { node_id: string } };
type RestComment = Record<string, unknown>;

function restReview(id: number, state: string, body: string, actor: string, commit = head): RestReview {
    return { id, state, body, commit_id: commit, user: { node_id: actor } };
}

function restComment(
    reviewId: number,
    id: number,
    originalLine: number,
    body: string,
    overrides: { commit?: string; inReplyTo?: number; actor?: string; originalPosition?: number } = {}
): RestComment {
    const commit = overrides.commit ?? head;
    return {
        id,
        pull_request_review_id: reviewId,
        path: 'AGENTS.md',
        line: null,
        side: 'RIGHT',
        original_line: originalLine,
        original_side: null,
        start_line: null,
        original_start_line: null,
        position: 1,
        original_position: overrides.originalPosition ?? 16,
        subject_type: 'line',
        commit_id: commit,
        original_commit_id: commit,
        in_reply_to_id: overrides.inReplyTo ?? null,
        user: { node_id: overrides.actor ?? REVIEWER_BOT_NODE_ID },
        body,
    };
}

function incidentReviews(): RestReview[] {
    return [
        restReview(5433609669, 'CHANGES_REQUESTED', 'The previous round.', REVIEWER_BOT_NODE_ID, previousHead),
        restReview(5433661554, 'COMMENTED', '', AUTHOR_BOT_NODE_ID),
        restReview(5433663679, 'COMMENTED', '', AUTHOR_BOT_NODE_ID),
        restReview(5433667811, 'COMMENTED', '', REVIEWER_BOT_NODE_ID),
        restReview(5433668256, 'COMMENTED', '', REVIEWER_BOT_NODE_ID),
        restReview(landedReviewId, 'CHANGES_REQUESTED', renderedBody, REVIEWER_BOT_NODE_ID),
    ];
}

function incidentComments(): RestComment[] {
    const previousRound = { commit: previousHead };
    return [
        restComment(5433609669, 4199610444, 672, 'Previous finding one.', { ...previousRound, originalPosition: 9 }),
        restComment(5433609669, 4199610450, 670, 'Previous finding two.', { ...previousRound, originalPosition: 7 }),
        restComment(5433661554, 4199655001, 672, 'Repaired.', {
            ...previousRound,
            inReplyTo: 4199610444,
            actor: AUTHOR_BOT_NODE_ID,
        }),
        restComment(5433663679, 4199655002, 670, 'Repaired.', {
            ...previousRound,
            inReplyTo: 4199610450,
            actor: AUTHOR_BOT_NODE_ID,
        }),
        restComment(5433667811, 4199660036, 672, 'Confirmed repair.', { ...previousRound, inReplyTo: 4199610444 }),
        restComment(5433668256, 4199660430, 670, 'Confirmed repair.', { ...previousRound, inReplyTo: 4199610450 }),
        restComment(landedReviewId, 4199756097, 670, landedCommentBodies[0]!),
        restComment(landedReviewId, 4199756111, 64, landedCommentBodies[1]!, { originalPosition: 5 }),
    ];
}

function fakeGh(reviews: RestReview[], comments: RestComment[]) {
    return (args: string[]): string => {
        if (args[0] === 'pr') {
            return JSON.stringify({ state: 'OPEN', headRefOid: head });
        }
        const endpoint = args.at(-1) ?? '';
        if (endpoint.endsWith(`/pulls/${number}/reviews?per_page=100`)) {
            return JSON.stringify([reviews]);
        }
        if (endpoint.endsWith(`/pulls/${number}/comments?per_page=100`)) {
            return JSON.stringify([comments]);
        }
        throw new Error(`unexpected gh request: ${args.join(' ')}`);
    };
}

function runGit(root: string, args: string[]): void {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
    if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
}

function createIncidentFixture() {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-publication-recovery-5008-'));
    runGit(root, ['init']);
    const bundle = join(root, '.agents', 'review-bundles', `${number}-${head}`);
    mkdirSync(bundle, { recursive: true });
    writeFileSync(join(bundle, 'review.json'), JSON.stringify(reviewDocumentJson));
    writeFileSync(
        join(bundle, 'diff.patch'),
        [
            'diff --git a/AGENTS.md b/AGENTS.md',
            '--- a/AGENTS.md',
            '+++ b/AGENTS.md',
            '@@ -64 +64 @@',
            '+stacking clause',
            '@@ -670 +670 @@',
            '+collision rule',
        ].join('\n')
    );
    const payloadDigest = reviewPublicationPayloadDigest(
        reviewPublicationPayload({
            commitId: head,
            event: document.event,
            body: renderedBody,
            comments: document.comments,
        })
    );
    const ownerOid = writePullRequestMutationLockOwner(
        root,
        {
            version: 3,
            pid: 999_999,
            token: '11111111-1111-4111-8111-111111111111',
            operation: 'review-publication',
            number,
            expectedHead: head,
            payloadDigest,
            reviewerActorNodeId: REVIEWER_BOT_NODE_ID,
            ownerFence: { kind: 'pgid', pgid: 999_999, leaderStartedAt: 'Tue Oct  6 19:46:37 2026' },
            mutation: { phase: 'remote-mutation-attempted', epoch: 1 },
        },
        number
    );
    runGit(root, ['update-ref', pullRequestMutationLockRef(number), ownerOid]);
    return { root, ownerOid, payloadDigest };
}

function recoverWith(root: string, ownerOid: string, gh: (args: string[]) => string) {
    return runRecoverPublishReviewLockCli([String(number), '--owner', ownerOid], {
        primaryRoot: () => root,
        authenticateReviewer: async () => ({
            minted: { actorNodeId: REVIEWER_BOT_NODE_ID },
            session: { configDir: '/tmp/reviewer', env: {}, dispose: () => undefined },
        }),
        repositoryName: () => 'jcosta33/sourdaw',
        inspect: (pr, actorNodeId, expectedHead) => inspectReviewPublicationRemote(pr, actorNodeId, expectedHead, gh),
        isOwnerLive: () => false,
        currentOwnerFence: () => ({ kind: 'pid' as const, pid: process.pid, startedAt: 'test-process' }),
    });
}

function lockOid(root: string): string | undefined {
    return readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number);
}

describe('review-publication recovery of a landed review among thread-reply reviews (#5008)', () => {
    let fixture: ReturnType<typeof createIncidentFixture>;

    beforeEach(() => {
        fixture = createIncidentFixture();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        rmSync(fixture.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    });

    it('releases the dead owner as landed when the one exact review stands beside reviewer reply reviews', async () => {
        await expect(
            recoverWith(fixture.root, fixture.ownerOid, fakeGh(incidentReviews(), incidentComments()))
        ).resolves.toBe(0);

        expect(lockOid(fixture.root)).toBeUndefined();
        expect(readPullRequestMutationLockReceipt(fixture.root, number, fixture.ownerOid)).toEqual({
            version: 2,
            operation: 'review-publication-recovery',
            number,
            ownerOid: fixture.ownerOid,
            adoptedOwnerOid: expect.stringMatching(/^[0-9a-f]{40}$/u),
            head,
            payloadDigest: fixture.payloadDigest,
            outcome: 'landed',
        });
        expect(console.log).toHaveBeenCalledWith(
            `review-publication-lock-recovered:${number}:${fixture.ownerOid}:landed`
        );
    });

    it('releases a single exact review beside a reviewer COMMENTED review that carries a body', async () => {
        const reviews = [
            ...incidentReviews(),
            restReview(5433790000, 'COMMENTED', 'An unrelated reviewer note.', REVIEWER_BOT_NODE_ID),
        ];

        await expect(recoverWith(fixture.root, fixture.ownerOid, fakeGh(reviews, incidentComments()))).resolves.toBe(0);
        expect(lockOid(fixture.root)).toBeUndefined();
    });

    it.each([
        {
            drift: 'one landed comment body',
            comments: () =>
                incidentComments().map((comment) =>
                    comment.id === 4199756111 ? { ...comment, body: `${String(comment.body)} edited` } : comment
                ),
            reviews: incidentReviews,
        },
        {
            drift: 'one landed comment line',
            comments: () =>
                incidentComments().map((comment) =>
                    comment.id === 4199756097 ? { ...comment, original_line: 671 } : comment
                ),
            reviews: incidentReviews,
        },
        {
            drift: 'the landed review body',
            comments: incidentComments,
            reviews: () =>
                incidentReviews().map((review) =>
                    review.id === landedReviewId ? { ...review, body: `${review.body} edited` } : review
                ),
        },
    ])('retains the owner when $drift differs from the retained document', async ({ comments, reviews }) => {
        await expect(recoverWith(fixture.root, fixture.ownerOid, fakeGh(reviews(), comments()))).rejects.toThrow(
            /ambiguous or non-exact remote review evidence/
        );
        expect(lockOid(fixture.root)).toBe(fixture.ownerOid);
        expect(readPullRequestMutationLockReceipt(fixture.root, number, fixture.ownerOid)).toBeUndefined();
    });

    it('retains the owner when two reviewer reviews at the head both match the document exactly', async () => {
        const duplicateId = 5433790001;
        const reviews = [
            ...incidentReviews(),
            restReview(duplicateId, 'CHANGES_REQUESTED', renderedBody, REVIEWER_BOT_NODE_ID),
        ];
        const comments = [
            ...incidentComments(),
            restComment(duplicateId, 4199790001, 670, landedCommentBodies[0]!),
            restComment(duplicateId, 4199790002, 64, landedCommentBodies[1]!, { originalPosition: 5 }),
        ];

        await expect(recoverWith(fixture.root, fixture.ownerOid, fakeGh(reviews, comments))).rejects.toThrow(
            /ambiguous or non-exact remote review evidence/
        );
        expect(lockOid(fixture.root)).toBe(fixture.ownerOid);
    });

    it('retains an attempted-mutation owner when the head holds only reviewer reply reviews and no exact one', async () => {
        const reviews = incidentReviews().filter((review) => review.id !== landedReviewId);
        const comments = incidentComments().filter((comment) => comment.pull_request_review_id !== landedReviewId);

        await expect(recoverWith(fixture.root, fixture.ownerOid, fakeGh(reviews, comments))).rejects.toThrow(
            /ambiguous or non-exact remote review evidence/
        );
        expect(lockOid(fixture.root)).toBe(fixture.ownerOid);
    });
});
