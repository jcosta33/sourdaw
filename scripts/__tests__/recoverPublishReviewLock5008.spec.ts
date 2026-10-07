import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID, type GhSession } from '../githubAppIdentity.ts';
import { composeReviewCommentBody } from '../prContract.ts';
import {
    parseReviewDocument,
    publishReview,
    renderReviewDocumentBody,
    reviewPublicationPayload,
    reviewPublicationPayloadDigest,
    shellPort,
    type PublishReviewPort,
} from '../publishReview.ts';
import {
    pullRequestMutationLockRef,
    readPullRequestMutationLockOid,
    readPullRequestMutationLockReceipt,
    writePullRequestMutationLockOwner,
} from '../pullRequestMutationLock.ts';
import { runRecoverPublishReviewLockCli } from '../recoverPublishReviewLock.ts';
import { parseReviewDossier } from '../reviewDossier.ts';
import { publishedFindings, publishedReviewId } from '../reviewDossierViews.ts';
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
const base = '45a017c4d1212f710ddf5e6fbde77519066d9c98';
const landedReviewId = 5433781938;
const landedCommentIds = [4199756097, 4199756111];

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

/** Everything the head held before the incident POST: the prior round and its thread replies. */
function prePublicationReviews(): RestReview[] {
    return [
        restReview(5433609669, 'CHANGES_REQUESTED', 'The previous round.', REVIEWER_BOT_NODE_ID, previousHead),
        restReview(5433661554, 'COMMENTED', '', AUTHOR_BOT_NODE_ID),
        restReview(5433663679, 'COMMENTED', '', AUTHOR_BOT_NODE_ID),
        restReview(5433667811, 'COMMENTED', '', REVIEWER_BOT_NODE_ID),
        restReview(5433668256, 'COMMENTED', '', REVIEWER_BOT_NODE_ID),
    ];
}

function prePublicationComments(): RestComment[] {
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
    ];
}

function incidentReviews(): RestReview[] {
    return [
        ...prePublicationReviews(),
        restReview(landedReviewId, 'CHANGES_REQUESTED', renderedBody, REVIEWER_BOT_NODE_ID),
    ];
}

function incidentComments(): RestComment[] {
    return [
        ...prePublicationComments(),
        restComment(landedReviewId, landedCommentIds[0]!, 670, landedCommentBodies[0]!),
        restComment(landedReviewId, landedCommentIds[1]!, 64, landedCommentBodies[1]!, { originalPosition: 5 }),
    ];
}

/**
 * A fake GitHub for one pull request. Before the review POST it holds the pre-publication reviews
 * and comments; the POST lands the incident review and its comments. `failCommentReadsAfterPost`
 * fails that many comment listings after the POST, the way the incident run died after posting.
 */
function fakeGitHub(input: { posted: boolean; reviews?: RestReview[]; comments?: RestComment[] }) {
    const state = { posted: input.posted, posts: 0, failCommentReadsAfterPost: 0 };
    const reviews = () => input.reviews ?? (state.posted ? incidentReviews() : prePublicationReviews());
    const comments = () => input.comments ?? (state.posted ? incidentComments() : prePublicationComments());
    const gh = (args: string[]): string => {
        if (args[0] === 'pr') {
            return JSON.stringify({ state: 'OPEN', headRefOid: head, labels: [] });
        }
        if (args.includes('--method')) {
            state.posts += 1;
            state.posted = true;
            return JSON.stringify({
                id: landedReviewId,
                state: 'CHANGES_REQUESTED',
                commit_id: head,
                user: { node_id: REVIEWER_BOT_NODE_ID, login: 'reviewer[bot]', type: 'Bot' },
            });
        }
        const endpoint = args.at(-1) ?? '';
        if (endpoint.endsWith(`/pulls/${number}/reviews?per_page=100`)) {
            return JSON.stringify([reviews()]);
        }
        if (endpoint.endsWith(`/pulls/${number}/comments?per_page=100`)) {
            if (state.posted && state.failCommentReadsAfterPost > 0) {
                state.failCommentReadsAfterPost -= 1;
                throw new Error('HTTP 502: transient comment listing failure');
            }
            return JSON.stringify([comments()]);
        }
        const single = reviews().find((review) => endpoint.endsWith(`/pulls/${number}/reviews/${review.id}`));
        if (single !== undefined) {
            return JSON.stringify(single);
        }
        throw new Error(`unexpected gh request: ${args.join(' ')}`);
    };
    return { state, gh };
}

const session: GhSession = { configDir: '/tmp/reviewer', env: {}, dispose: () => undefined };

function publicationPort(root: string, gh: (args: string[]) => string): PublishReviewPort {
    const port = shellPort(session, root, (command, args) => {
        if (command === 'git' && args[0] === 'rev-parse') {
            return join(root, '.git');
        }
        if (command === 'gh') {
            return gh(args);
        }
        throw new Error(`unexpected command in test: ${command} ${args.join(' ')}`);
    });
    return { ...port, primaryRoot: () => root };
}

function runGit(root: string, args: string[]): void {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
    if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
}

function bundlePath(root: string): string {
    return join(root, '.agents', 'review-bundles', `${number}-${head}`);
}

/** The plan-carrying files review:prepare writes and the caller's dossier input beside them. */
function writePlanCarryingBundleFiles(bundle: string): void {
    writeFileSync(
        join(bundle, 'manifest.json'),
        JSON.stringify({ pr: number, baseRefName: 'main', baseSha: base, headSha: head })
    );
    writeFileSync(
        join(bundle, 'risk-plan.json'),
        JSON.stringify({
            format: 'risk-plan-v1',
            pr: number,
            headSha: head,
            baseSha: base,
            riskClasses: ['small'],
            requiredStances: ['correctness', 'test-validity'],
            triggers: ['small:handwritten-lines<=200'],
        })
    );
    writeFileSync(
        join(bundle, 'dossier.json'),
        JSON.stringify({
            format: 'dossier-input-v1',
            pr: number,
            headSha: head,
            baseSha: base,
            stances: [
                {
                    stance: 'correctness',
                    reviewerModel: 'review-model',
                    modelTier: 'strongest',
                    outcome: 'blocker-found',
                },
                { stance: 'test-validity', reviewerModel: 'review-model', modelTier: 'standard', outcome: 'clean' },
            ],
            evidence: [
                {
                    observable: 'the stacking rule conflicts with the stack procedure',
                    verification: 'read AGENTS.md against the delivery skill',
                    observed: 'two conflicting sentences',
                },
            ],
            limitations: [],
            assessmentImpact: 'none',
        })
    );
}

function createIncidentFixture(
    phase: 'prepared' | 'remote-mutation-attempted' = 'remote-mutation-attempted',
    planCarrying = false
) {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-publication-recovery-5008-'));
    runGit(root, ['init']);
    const bundle = bundlePath(root);
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
    if (planCarrying) {
        writePlanCarryingBundleFiles(bundle);
    }
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
            mutation: { phase, epoch: 1 },
        },
        number
    );
    runGit(root, ['update-ref', pullRequestMutationLockRef(number), ownerOid]);
    return { root, ownerOid, payloadDigest };
}

function recoverWith(root: string, ownerOid: string, gh: (args: string[]) => string) {
    return runRecoverPublishReviewLockCli([String(number), '--owner', ownerOid], {
        primaryRoot: () => root,
        authenticateReviewer: async () => ({ minted: { actorNodeId: REVIEWER_BOT_NODE_ID }, session }),
        repositoryName: () => 'jcosta33/sourdaw',
        inspect: (pr, actorNodeId, expectedHead) => inspectReviewPublicationRemote(pr, actorNodeId, expectedHead, gh),
        publicationPort: (_session, primaryRoot) => publicationPort(primaryRoot, gh),
        isOwnerLive: () => false,
        currentOwnerFence: () => ({ kind: 'pid' as const, pid: process.pid, startedAt: 'test-process' }),
    });
}

function lockOid(root: string): string | undefined {
    return readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number);
}

function readDossier(root: string) {
    return parseReviewDossier(JSON.parse(readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8')) as unknown);
}

describe('review-publication recovery of a landed review among thread-reply reviews (#5008)', () => {
    const roots: string[] = [];

    function fixtureFor(...args: Parameters<typeof createIncidentFixture>) {
        const fixture = createIncidentFixture(...args);
        roots.push(fixture.root);
        return fixture;
    }

    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        for (const root of roots.splice(0)) {
            rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        }
    });

    it('releases the dead owner as landed when the one exact review stands beside reviewer reply reviews', async () => {
        const fixture = fixtureFor();
        const remote = fakeGitHub({ posted: true });

        await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).resolves.toBe(0);

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
        expect(remote.state.posts).toBe(0);
    });

    it('releases a prepared owner as absent when the head holds only reviewer reply reviews', async () => {
        const fixture = fixtureFor('prepared');

        await expect(recoverWith(fixture.root, fixture.ownerOid, fakeGitHub({ posted: false }).gh)).resolves.toBe(0);

        expect(lockOid(fixture.root)).toBeUndefined();
        expect(readPullRequestMutationLockReceipt(fixture.root, number, fixture.ownerOid)).toMatchObject({
            version: 2,
            ownerOid: fixture.ownerOid,
            head,
            outcome: 'absent',
        });
    });

    it('keeps an attempted-mutation owner behind the absent-path refusal when the head holds only reply reviews', async () => {
        const fixture = fixtureFor();

        await expect(recoverWith(fixture.root, fixture.ownerOid, fakeGitHub({ posted: false }).gh)).rejects.toThrow(
            /cannot release an owner that attempted a remote mutation without landed evidence/
        );
        expect(lockOid(fixture.root)).not.toBeUndefined();
        expect(readPullRequestMutationLockReceipt(fixture.root, number, fixture.ownerOid)).toBeUndefined();
    });

    it('retains the owner when a non-reply reviewer COMMENTED review stands beside the exact one', async () => {
        const fixture = fixtureFor();
        const reviews = [
            ...incidentReviews(),
            restReview(5433790000, 'COMMENTED', 'An unrelated reviewer note.', REVIEWER_BOT_NODE_ID),
        ];

        await expect(
            recoverWith(fixture.root, fixture.ownerOid, fakeGitHub({ posted: true, reviews }).gh)
        ).rejects.toThrow(/ambiguous or non-exact remote review evidence/);
        expect(lockOid(fixture.root)).toBe(fixture.ownerOid);
    });

    it.each([
        {
            drift: 'one landed comment body',
            comments: () =>
                incidentComments().map((comment) => {
                    if (comment.id !== landedCommentIds[1]) {
                        return comment;
                    }
                    return { ...comment, body: `${String(comment.body)} edited` };
                }),
            reviews: incidentReviews,
        },
        {
            drift: 'one landed comment line',
            comments: () =>
                incidentComments().map((comment) =>
                    comment.id === landedCommentIds[0] ? { ...comment, original_line: 671 } : comment
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
        const fixture = fixtureFor();
        const remote = fakeGitHub({ posted: true, reviews: reviews(), comments: comments() });

        await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).rejects.toThrow(
            /ambiguous or non-exact remote review evidence/
        );
        expect(lockOid(fixture.root)).toBe(fixture.ownerOid);
        expect(readPullRequestMutationLockReceipt(fixture.root, number, fixture.ownerOid)).toBeUndefined();
    });

    it('retains the owner when two reviewer reviews at the head both match the document exactly', async () => {
        const fixture = fixtureFor();
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

        await expect(
            recoverWith(fixture.root, fixture.ownerOid, fakeGitHub({ posted: true, reviews, comments }).gh)
        ).rejects.toThrow(/ambiguous or non-exact remote review evidence/);
        expect(lockOid(fixture.root)).toBe(fixture.ownerOid);
    });

    it('records the recovered publication in the dossier so a later publish replays it without posting', async () => {
        const fixture = fixtureFor('remote-mutation-attempted', true);
        const remote = fakeGitHub({ posted: false });
        remote.state.failCommentReadsAfterPost = 1;

        expect(() => publishReview(number, publicationPort(fixture.root, remote.gh))).toThrow(
            /transient comment listing failure/
        );
        expect(remote.state.posts).toBe(1);
        expect(publishedReviewId(readDossier(fixture.root))).toBeUndefined();

        await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).resolves.toBe(0);

        const dossier = readDossier(fixture.root);
        expect(publishedReviewId(dossier)).toBe(landedReviewId);
        expect(
            publishedFindings(dossier).map((finding) => [finding.findingId, finding.reviewId, finding.commentId])
        ).toEqual([
            ['comment-0', landedReviewId, landedCommentIds[0]],
            ['comment-1', landedReviewId, landedCommentIds[1]],
        ]);
        expect(lockOid(fixture.root)).toBeUndefined();

        expect(publishReview(number, publicationPort(fixture.root, remote.gh))).toBe(landedReviewId);
        expect(remote.state.posts).toBe(1);
    });
});
