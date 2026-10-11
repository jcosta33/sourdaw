import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    AUTHOR_BOT_NODE_ID,
    ORCHESTRATOR_USER_NODE_ID,
    REVIEWER_BOT_NODE_ID,
    type GhSession,
} from '../githubAppIdentity.ts';
import { composeReviewCommentBody } from '../prContract.ts';
import {
    parseAcceptanceDocument,
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
import { readPullRequestReviewState } from '../pullRequestReviewState.ts';
import { runRecoverPublishReviewLockCli } from '../recoverPublishReviewLock.ts';
import { appendReviewDossierEvents, parseReviewDossier, serializeReviewDossier } from '../reviewDossier.ts';
import { buildReviewDossier } from '../reviewDossierPublication.ts';
import { deliveryAuthorization, publishedFindings, publishedReviewId } from '../reviewDossierViews.ts';
import { recordedPublicationReplay } from '../reviewPublicationBinding.ts';
import { inspectReviewPublicationRemote } from '../reviewPublicationRemoteInspection.ts';
import {
    REASSESSMENT_FILE_NAME,
    REVIEW_REASSESSMENT_FORMAT,
    REVIEW_ROUND_ESCALATION_THRESHOLD,
} from '../reviewRoundEscalation.ts';

import type { ReviewRiskPlan } from '../reviewRiskPolicy.ts';

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
const movedHead = '94f0976eafcfd74aeb914c94fdc3ee7f7b118a34';
const base = '45a017c4d1212f710ddf5e6fbde77519066d9c98';
const landedReviewId = 5433781938;
const landedCommentIds = [4199756097, 4199756111];

type Landing = 'request-changes' | 'approve';

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

const approvalDocumentJson = {
    event: 'APPROVE',
    reviewerModel: 'claude-opus-5-5',
    body: 'Attacked the amended stacking rule against the stack procedure; it held.',
    comments: [],
};

const documentJson: Record<Landing, unknown> = {
    'request-changes': reviewDocumentJson,
    approve: approvalDocumentJson,
};
const document = parseReviewDocument(reviewDocumentJson);
const renderedBody = renderReviewDocumentBody(document);
const approvalBody = renderReviewDocumentBody(parseReviewDocument(approvalDocumentJson));
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

function landedReview(landing: Landing): RestReview {
    if (landing === 'approve') {
        return restReview(landedReviewId, 'APPROVED', approvalBody, REVIEWER_BOT_NODE_ID);
    }
    return restReview(landedReviewId, 'CHANGES_REQUESTED', renderedBody, REVIEWER_BOT_NODE_ID);
}

function landedComments(landing: Landing): RestComment[] {
    if (landing === 'approve') {
        return [];
    }
    return [
        restComment(landedReviewId, landedCommentIds[0]!, 670, landedCommentBodies[0]!),
        restComment(landedReviewId, landedCommentIds[1]!, 64, landedCommentBodies[1]!, { originalPosition: 5 }),
    ];
}

function incidentReviews(landing: Landing = 'request-changes'): RestReview[] {
    return [...prePublicationReviews(), landedReview(landing)];
}

function incidentComments(landing: Landing = 'request-changes'): RestComment[] {
    return [...prePublicationComments(), ...landedComments(landing)];
}

/** The GraphQL review-state page `readPullRequestReviewState` reads, for the given live head. */
function reviewStatePage(liveHead: string, reviews: RestReview[]): string {
    return JSON.stringify({
        data: {
            repository: {
                pullRequest: {
                    id: 'PR_kwDOfixture',
                    headRefOid: liveHead,
                    reviews: {
                        nodes: reviews.map((review) => ({
                            id: `PRR_${review.id}`,
                            databaseId: review.id,
                            state: review.state,
                            submittedAt: '2026-10-06T19:46:57Z',
                            author: { login: 'app[bot]', __typename: 'Bot', id: review.user.node_id },
                            commit: { oid: review.commit_id },
                        })),
                        pageInfo: { hasPreviousPage: false, startCursor: null },
                    },
                    reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
                },
            },
        },
    });
}

/**
 * A fake GitHub for one pull request. Before the review POST it holds the pre-publication reviews
 * and comments (plus any `priorReviews`); the POST lands the incident review and its comments.
 * `failCommentReadsAfterPost` fails that many comment listings after the POST, the way the
 * incident run died after posting. `liveHead` is the pull request's current head.
 */
function fakeGitHub(input: {
    posted: boolean;
    landing?: Landing;
    reviews?: RestReview[];
    comments?: RestComment[];
    priorReviews?: RestReview[];
    liveHead?: string;
}) {
    const landing = input.landing ?? 'request-changes';
    const state = { posted: input.posted, posts: 0, failCommentReadsAfterPost: 0 };
    const liveHead = input.liveHead ?? head;
    const priorReviews = input.priorReviews ?? [];
    const currentReviews = () => {
        if (input.reviews !== undefined) {
            return input.reviews;
        }
        return state.posted ? incidentReviews(landing) : prePublicationReviews();
    };
    const reviews = () => [...priorReviews, ...currentReviews()];
    const comments = () => input.comments ?? (state.posted ? incidentComments(landing) : prePublicationComments());
    const gh = (args: string[]): string => {
        if (args[0] === 'pr') {
            return JSON.stringify({ state: 'OPEN', headRefOid: liveHead, labels: [] });
        }
        if (args[0] === 'api' && args[1] === 'graphql') {
            return reviewStatePage(liveHead, reviews());
        }
        if (args.includes('--method')) {
            state.posts += 1;
            state.posted = true;
            const posted = landedReview(landing);
            return JSON.stringify({
                ...posted,
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

const riskPlan: ReviewRiskPlan = {
    format: 'risk-plan-v1',
    pr: number,
    headSha: head,
    baseSha: base,
    riskClasses: ['small'],
    requiredStances: ['correctness', 'test-validity'],
    triggers: ['small:handwritten-lines<=200'],
};

function dossierInput(landing: Landing): Record<string, unknown> {
    return {
        format: 'dossier-input-v1',
        pr: number,
        headSha: head,
        baseSha: base,
        stances: [
            {
                stance: 'correctness',
                reviewerModel: 'review-model',
                modelTier: 'strongest',
                outcome: landing === 'approve' ? 'clean' : 'blocker-found',
            },
            { stance: 'test-validity', reviewerModel: 'review-model', modelTier: 'standard', outcome: 'clean' },
        ],
        evidence: [
            {
                observable: 'the stacking rule against the stack procedure',
                verification: 'read AGENTS.md against the delivery skill',
                observed: 'the two sentences compared',
            },
        ],
        limitations: [],
        assessmentImpact: 'none',
    };
}

/**
 * The plan-carrying files review:prepare writes, and the dossier: the caller's input for a
 * request-changes round (the publish run persists the canonical record), or the canonical record
 * an approval's publish run persists before its POST.
 */
function writePlanCarryingBundleFiles(bundle: string, landing: Landing): void {
    writeFileSync(
        join(bundle, 'manifest.json'),
        JSON.stringify({ pr: number, baseRefName: 'main', baseSha: base, headSha: head })
    );
    writeFileSync(join(bundle, 'risk-plan.json'), JSON.stringify(riskPlan));
    if (landing === 'request-changes') {
        writeFileSync(join(bundle, 'dossier.json'), JSON.stringify(dossierInput(landing)));
        return;
    }
    const { canonical } = buildReviewDossier({
        plan: riskPlan,
        raw: dossierInput(landing),
        discarded: [],
        comments: [],
        recommendation: 'approve',
    });
    writeFileSync(join(bundle, 'dossier.json'), canonical);
}

function writeOwner(
    root: string,
    payloadDigest: string,
    phase: 'prepared' | 'remote-mutation-attempted',
    token = '11111111-1111-4111-8111-111111111111',
    actorNodeId = REVIEWER_BOT_NODE_ID
): string {
    const ownerOid = writePullRequestMutationLockOwner(
        root,
        {
            version: 3,
            pid: 999_999,
            token,
            operation: 'review-publication',
            number,
            expectedHead: head,
            payloadDigest,
            reviewerActorNodeId: actorNodeId,
            ownerFence: { kind: 'pgid', pgid: 999_999, leaderStartedAt: 'Tue Oct  6 19:46:37 2026' },
            mutation: { phase, epoch: 1 },
        },
        number
    );
    runGit(root, ['update-ref', pullRequestMutationLockRef(number), ownerOid]);
    return ownerOid;
}

function createIncidentFixture(
    input: { phase?: 'prepared' | 'remote-mutation-attempted'; planCarrying?: boolean; landing?: Landing } = {}
) {
    const landing = input.landing ?? 'request-changes';
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-publication-recovery-5008-'));
    runGit(root, ['init']);
    const bundle = bundlePath(root);
    mkdirSync(bundle, { recursive: true });
    writeFileSync(join(bundle, 'review.json'), JSON.stringify(documentJson[landing]));
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
    if (input.planCarrying === true) {
        writePlanCarryingBundleFiles(bundle, landing);
    }
    const parsed = parseReviewDocument(documentJson[landing]);
    const payloadDigest = reviewPublicationPayloadDigest(
        reviewPublicationPayload({
            commitId: head,
            event: parsed.event,
            body: renderReviewDocumentBody(parsed),
            comments: parsed.comments,
        })
    );
    const ownerOid = writeOwner(root, payloadDigest, input.phase ?? 'remote-mutation-attempted');
    return { root, ownerOid, payloadDigest };
}

type Gh = (args: string[]) => string;

/** Recovers through the real inspection; `inspectionGh` may answer each inspection differently. */
function recoverWith(root: string, ownerOid: string, gh: Gh, inspectionGh?: (inspection: number) => Gh) {
    let inspections = 0;
    return runRecoverPublishReviewLockCli([String(number), '--owner', ownerOid], {
        primaryRoot: () => root,
        authenticateReviewer: async () => ({ minted: { actorNodeId: REVIEWER_BOT_NODE_ID }, session }),
        authenticateOrchestrator: async () => ({ minted: { actorNodeId: ORCHESTRATOR_USER_NODE_ID }, session }),
        repositoryName: () => 'jcosta33/sourdaw',
        inspect: (pr, actorNodeId, expectedHead) => {
            inspections += 1;
            return inspectReviewPublicationRemote(pr, actorNodeId, expectedHead, inspectionGh?.(inspections) ?? gh);
        },
        publicationPort: (_session, primaryRoot) => publicationPort(primaryRoot, gh),
        isOwnerLive: () => false,
        currentOwnerFence: () => ({ kind: 'pid' as const, pid: process.pid, startedAt: 'test-process' }),
    });
}

function lockOid(root: string): string | undefined {
    return readPullRequestMutationLockOid(root, pullRequestMutationLockRef(number), number);
}

function dossierText(root: string): string {
    return readFileSync(join(bundlePath(root), 'dossier.json'), 'utf8');
}

function readDossier(root: string) {
    return parseReviewDossier(JSON.parse(dossierText(root)) as unknown);
}

/** Runs the real publish against the fake until its POST lands and the comment read then fails. */
function crashAfterPost(root: string, remote: ReturnType<typeof fakeGitHub>): void {
    const draws = [
        {
            stance: 'reply review mistaken for the landed review',
            admittedBy: 'reply-only COMMENTED reviews precede the landed CHANGES_REQUESTED review',
            mutation: 'treat a reply-only COMMENTED review as the landed review',
            modelTier: 'strongest',
            outcome: 'blocker-found',
        },
        {
            stance: 'landed comment binding drifts',
            admittedBy: 'a posted comment changes body or line before binding',
            mutation: 'skip the exact landed comment comparison',
            modelTier: 'standard',
            outcome: 'clean',
        },
        {
            stance: 'landed review identity changes',
            admittedBy: 'the landed review id changes between the two recovery inspections',
            mutation: 'skip the second-inspection review id comparison',
            modelTier: 'standard',
            outcome: 'clean',
        },
    ] as const;
    const bundle = bundlePath(root);
    writeFileSync(
        join(bundle, 'dossier.json'),
        JSON.stringify({
            ...dossierInput('request-changes'),
            stances: draws.map(({ stance, modelTier, outcome }) => ({
                stance,
                reviewerModel: 'review-model',
                modelTier,
                outcome,
            })),
        })
    );
    writeFileSync(
        join(bundle, 'stances.json'),
        JSON.stringify({
            format: 'stances-admission-v1',
            pr: number,
            headSha: head,
            baseSha: base,
            stances: draws.map(({ stance, admittedBy, mutation }) => ({
                stance,
                admittedBy,
                draws: [
                    {
                        reviewerModel: 'review-model',
                        baselineProbe: {
                            spec: 'scripts/__tests__/recoverPublishReviewLock5008.spec.ts',
                            mutation,
                            observed: 'the named recovery spec failed on the targeted mutation',
                            result: 'mutation-detected',
                        },
                    },
                ],
            })),
        })
    );
    remote.state.failCommentReadsAfterPost = 1;
    expect(() => publishReview(number, publicationPort(root, remote.gh))).toThrow(/transient comment listing failure/);
    expect(remote.state.posts).toBe(1);
    expect(publishedReviewId(readDossier(root))).toBeUndefined();
}

describe('review-publication recovery of a landed review among thread-reply reviews (#5008)', () => {
    const roots: string[] = [];

    function fixtureFor(input?: Parameters<typeof createIncidentFixture>[0]) {
        const fixture = createIncidentFixture(input);
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
        const fixture = fixtureFor({ phase: 'prepared' });

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
            shape: 'a COMMENTED state and a non-empty body over reply-only comments',
            review: restReview(5433790002, 'COMMENTED', 'A reply note.', REVIEWER_BOT_NODE_ID),
            comments: [restComment(5433790002, 4199790010, 670, 'Replying.', { inReplyTo: landedCommentIds[0]! })],
        },
        {
            shape: 'a CHANGES_REQUESTED state over an empty body and reply-only comments',
            review: restReview(5433790004, 'CHANGES_REQUESTED', '', REVIEWER_BOT_NODE_ID),
            comments: [restComment(5433790004, 4199790013, 670, 'Replying.', { inReplyTo: landedCommentIds[0]! })],
        },
        {
            shape: 'a COMMENTED state, an empty body and no comments',
            review: restReview(5433790005, 'COMMENTED', '', REVIEWER_BOT_NODE_ID),
            comments: [],
        },
        {
            shape: 'a COMMENTED state and an empty body over one reply and one top-level comment',
            review: restReview(5433790003, 'COMMENTED', '', REVIEWER_BOT_NODE_ID),
            comments: [
                restComment(5433790003, 4199790011, 670, 'Replying.', { inReplyTo: landedCommentIds[0]! }),
                restComment(5433790003, 4199790012, 64, 'A new top-level note.'),
            ],
        },
    ])('retains the owner beside a reviewer review with $shape', async ({ review, comments }) => {
        const fixture = fixtureFor();
        const remote = fakeGitHub({
            posted: true,
            reviews: [...incidentReviews(), review],
            comments: [...incidentComments(), ...comments],
        });

        await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).rejects.toThrow(
            /ambiguous or non-exact remote review evidence/
        );
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
        const fixture = fixtureFor({ planCarrying: true });
        const remote = fakeGitHub({ posted: false });
        crashAfterPost(fixture.root, remote);

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

    it('refuses and leaves the dossier unbound when the landed review drifts between the two inspections', async () => {
        const fixture = fixtureFor({ planCarrying: true });
        const remote = fakeGitHub({ posted: false });
        crashAfterPost(fixture.root, remote);
        const drifted = fakeGitHub({
            posted: true,
            comments: incidentComments().map((comment) => {
                if (comment.id !== landedCommentIds[0]) {
                    return comment;
                }
                return { ...comment, body: `${String(comment.body)} edited` };
            }),
        });

        await expect(
            recoverWith(fixture.root, fixture.ownerOid, remote.gh, (inspection) =>
                inspection === 1 ? remote.gh : drifted.gh
            )
        ).rejects.toThrow(/remote state changed during reconciliation/);
        expect(publishedReviewId(readDossier(fixture.root))).toBeUndefined();
        expect(lockOid(fixture.root)).not.toBeUndefined();
    });

    it('refuses and leaves the dossier unbound when the exact review carries another id by the second inspection', async () => {
        const fixture = fixtureFor({ planCarrying: true });
        const remote = fakeGitHub({ posted: false });
        crashAfterPost(fixture.root, remote);
        const reissuedReviewId = landedReviewId + 1;
        const reissued = fakeGitHub({
            posted: true,
            reviews: [...prePublicationReviews(), { ...landedReview('request-changes'), id: reissuedReviewId }],
            comments: [
                ...prePublicationComments(),
                ...landedComments('request-changes').map((comment) => ({
                    ...comment,
                    pull_request_review_id: reissuedReviewId,
                })),
            ],
        });

        await expect(
            recoverWith(fixture.root, fixture.ownerOid, remote.gh, (inspection) =>
                inspection === 1 ? remote.gh : reissued.gh
            )
        ).rejects.toThrow(/remote state changed during reconciliation/);
        expect(publishedReviewId(readDossier(fixture.root))).toBeUndefined();
        expect(lockOid(fixture.root)).not.toBeUndefined();
    });

    it('refuses and leaves the dossier unbound when a third actor posts an exact copy only by the second inspection', async () => {
        const fixture = fixtureFor({ planCarrying: true });
        const remote = fakeGitHub({ posted: false });
        crashAfterPost(fixture.root, remote);
        const thirdReviewId = 5433790100;
        const withThird = fakeGitHub({
            posted: true,
            reviews: [
                ...incidentReviews(),
                restReview(thirdReviewId, 'CHANGES_REQUESTED', renderedBody, AUTHOR_BOT_NODE_ID),
            ],
            comments: [
                ...incidentComments(),
                restComment(thirdReviewId, 4199790101, 670, landedCommentBodies[0]!, { actor: AUTHOR_BOT_NODE_ID }),
                restComment(thirdReviewId, 4199790102, 64, landedCommentBodies[1]!, {
                    actor: AUTHOR_BOT_NODE_ID,
                    originalPosition: 5,
                }),
            ],
        });

        await expect(
            recoverWith(fixture.root, fixture.ownerOid, remote.gh, (inspection) =>
                inspection === 1 ? remote.gh : withThird.gh
            )
        ).rejects.toThrow(/unauthorized landed review evidence/);
        expect(publishedReviewId(readDossier(fixture.root))).toBeUndefined();
        expect(lockOid(fixture.root)).not.toBeUndefined();
    });

    it('releases again over a dossier already bound to the landed review and leaves it byte-unchanged', async () => {
        const fixture = fixtureFor({ planCarrying: true });
        const remote = fakeGitHub({ posted: false });
        crashAfterPost(fixture.root, remote);
        await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).resolves.toBe(0);
        const bound = dossierText(fixture.root);
        expect(publishedReviewId(readDossier(fixture.root))).toBe(landedReviewId);
        const nextOwnerOid = writeOwner(
            fixture.root,
            fixture.payloadDigest,
            'remote-mutation-attempted',
            '22222222-2222-4222-8222-222222222222'
        );

        await expect(recoverWith(fixture.root, nextOwnerOid, remote.gh)).resolves.toBe(0);

        expect(dossierText(fixture.root)).toBe(bound);
        expect(lockOid(fixture.root)).toBeUndefined();
    });

    it('refuses a dossier already bound to a different review than the landed one', async () => {
        const fixture = fixtureFor({ planCarrying: true });
        const remote = fakeGitHub({ posted: false });
        crashAfterPost(fixture.root, remote);
        const otherReviewId = 5433700000;
        const foreignBound = appendReviewDossierEvents(readDossier(fixture.root), [
            { kind: 'review-published', reviewId: otherReviewId },
            { kind: 'finding-published', findingId: 'comment-0', reviewId: otherReviewId, commentId: 4199700001 },
            { kind: 'finding-published', findingId: 'comment-1', reviewId: otherReviewId, commentId: 4199700002 },
        ]);
        writeFileSync(join(bundlePath(fixture.root), 'dossier.json'), serializeReviewDossier(foreignBound));

        await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).rejects.toThrow(
            `review dossier binds publication ${otherReviewId}, not the recovered landed review ${landedReviewId}`
        );
        expect(publishedReviewId(readDossier(fixture.root))).toBe(otherReviewId);
        expect(lockOid(fixture.root)).not.toBeUndefined();
    });

    it('recounts the escalation rounds without the landed review and records no reassessment', async () => {
        const fixture = fixtureFor({ planCarrying: true });
        const remote = fakeGitHub({
            posted: false,
            priorReviews: [restReview(5433500000, 'CHANGES_REQUESTED', 'An older round.', REVIEWER_BOT_NODE_ID, base)],
        });
        crashAfterPost(fixture.root, remote);

        await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).resolves.toBe(0);

        const dossier = readDossier(fixture.root);
        expect(publishedReviewId(dossier)).toBe(landedReviewId);
        expect(dossier.events.some((event) => event.kind === 'review-reassessed')).toBe(false);
    });

    it('hands the consumed reassessment to the recovered binding when the prior rounds met the threshold', async () => {
        const fixture = fixtureFor({ planCarrying: true });
        const reassessment = {
            format: REVIEW_REASSESSMENT_FORMAT,
            pr: number,
            headSha: head,
            baseSha: base,
            roundsObserved: 3,
            threshold: REVIEW_ROUND_ESCALATION_THRESHOLD,
            action: 'continue',
            reason: 'The remaining findings are narrow wording repairs inside one rule.',
        };
        writeFileSync(join(bundlePath(fixture.root), REASSESSMENT_FILE_NAME), JSON.stringify(reassessment));
        const remote = fakeGitHub({
            posted: false,
            priorReviews: [
                restReview(5433500000, 'CHANGES_REQUESTED', 'An older round.', REVIEWER_BOT_NODE_ID, base),
                restReview(5433500001, 'CHANGES_REQUESTED', 'Another older round.', REVIEWER_BOT_NODE_ID, base),
            ],
        });
        crashAfterPost(fixture.root, remote);
        expect(readDossier(fixture.root).events.some((event) => event.kind === 'review-reassessed')).toBe(false);

        await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).resolves.toBe(0);

        const reassessed = readDossier(fixture.root).events.filter((event) => event.kind === 'review-reassessed');
        expect(reassessed).toHaveLength(1);
        expect(reassessed[0]).toMatchObject({
            kind: 'review-reassessed',
            roundsObserved: 3,
            threshold: REVIEW_ROUND_ESCALATION_THRESHOLD,
            action: 'continue',
            reason: reassessment.reason,
        });
        expect(lockOid(fixture.root)).toBeUndefined();
    });

    it('binds nothing into the dossier when the recovered publication is an orchestrator acceptance', async () => {
        const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
        const bundle = bundlePath(fixture.root);
        const acceptance = parseAcceptanceDocument({
            format: 'compact-v1',
            event: 'APPROVE',
            body: 'Accepted after the independent approval; delivery may proceed.',
            evidence: {
                headSha: head,
                claims: [
                    {
                        observable: 'the stacking rule matches the stack procedure',
                        verification: 'read AGENTS.md against the delivery skill',
                        observed: 'one consistent rule',
                    },
                ],
            },
        });
        writeFileSync(join(bundle, 'acceptance.json'), JSON.stringify(acceptance));
        const acceptanceBody = renderReviewDocumentBody(acceptance);
        const ownerOid = writeOwner(
            fixture.root,
            reviewPublicationPayloadDigest(
                reviewPublicationPayload({
                    commitId: head,
                    event: acceptance.event,
                    body: acceptanceBody,
                    comments: [],
                })
            ),
            'remote-mutation-attempted',
            '33333333-3333-4333-8333-333333333333',
            ORCHESTRATOR_USER_NODE_ID
        );
        const remote = fakeGitHub({
            posted: true,
            reviews: [
                ...incidentReviews('approve'),
                restReview(5433800000, 'APPROVED', acceptanceBody, ORCHESTRATOR_USER_NODE_ID),
            ],
            comments: prePublicationComments(),
        });
        const before = dossierText(fixture.root);

        await expect(recoverWith(fixture.root, ownerOid, remote.gh)).resolves.toBe(0);

        const dossier = readDossier(fixture.root);
        expect(publishedReviewId(dossier)).toBeUndefined();
        expect(publishedFindings(dossier)).toEqual([]);
        expect(dossierText(fixture.root)).toBe(before);
        expect(lockOid(fixture.root)).toBeUndefined();
        expect(readPullRequestMutationLockReceipt(fixture.root, number, ownerOid)).toMatchObject({ outcome: 'landed' });
    });

    it('releases a recovered approval on a moved head as landed and binds no delivery authorization', async () => {
        const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
        const remote = fakeGitHub({ posted: true, landing: 'approve', liveHead: movedHead });
        expect(() => readPullRequestReviewState(number, head, 'jcosta33/sourdaw', remote.gh)).toThrow(
            /cannot prove complete review state/
        );

        await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).resolves.toBe(0);

        const dossier = readDossier(fixture.root);
        expect(publishedReviewId(dossier)).toBe(landedReviewId);
        expect(deliveryAuthorization(dossier)).toBeUndefined();
        expect(dossier.events.some((event) => event.kind === 'delivery-authorized')).toBe(false);
        expect(lockOid(fixture.root)).toBeUndefined();
        expect(readPullRequestMutationLockReceipt(fixture.root, number, fixture.ownerOid)).toMatchObject({
            outcome: 'landed',
        });
    });

    it('binds the delivery authorization of a recovered approval whose head has not moved', async () => {
        const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
        const remote = fakeGitHub({ posted: true, landing: 'approve' });

        await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).resolves.toBe(0);

        const dossier = readDossier(fixture.root);
        expect(publishedReviewId(dossier)).toBe(landedReviewId);
        expect(deliveryAuthorization(dossier)).toMatchObject({
            reviewId: landedReviewId,
            approvalReviewId: landedReviewId,
            unresolvedThreads: 0,
        });
        expect(lockOid(fixture.root)).toBeUndefined();
    });

    describe('a landed approval that a later push dismissed (#5046)', () => {
        function dismissedApprovalReviews(overrides: Partial<RestReview> = {}): RestReview[] {
            return [...prePublicationReviews(), { ...landedReview('approve'), state: 'DISMISSED', ...overrides }];
        }

        function dismissedApprovalRemote(input: { liveHead?: string; reviews?: RestReview[]; landing?: Landing } = {}) {
            return fakeGitHub({
                posted: true,
                landing: input.landing ?? 'approve',
                liveHead: input.liveHead ?? movedHead,
                reviews: input.reviews ?? dismissedApprovalReviews(),
                comments: prePublicationComments(),
            });
        }

        it('binds the publication without a delivery authorization and releases the lock on a moved head', async () => {
            const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
            const remote = dismissedApprovalRemote();

            await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).resolves.toBe(0);

            const dossier = readDossier(fixture.root);
            expect(publishedReviewId(dossier)).toBe(landedReviewId);
            expect(deliveryAuthorization(dossier)).toBeUndefined();
            expect(dossier.events.some((event) => event.kind === 'delivery-authorized')).toBe(false);
            expect(lockOid(fixture.root)).toBeUndefined();
            expect(readPullRequestMutationLockReceipt(fixture.root, number, fixture.ownerOid)).toMatchObject({
                outcome: 'landed',
            });
            expect(remote.state.posts).toBe(0);
        });

        it('releases again over the dossier it already bound and leaves it byte-unchanged', async () => {
            const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
            const remote = dismissedApprovalRemote();
            await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).resolves.toBe(0);
            const bound = dossierText(fixture.root);
            const nextOwnerOid = writeOwner(
                fixture.root,
                fixture.payloadDigest,
                'remote-mutation-attempted',
                '44444444-4444-4444-8444-444444444444'
            );

            await expect(recoverWith(fixture.root, nextOwnerOid, remote.gh)).resolves.toBe(0);

            expect(dossierText(fixture.root)).toBe(bound);
            expect(lockOid(fixture.root)).toBeUndefined();
        });

        it('refuses the same dismissed approval while the head has not moved', async () => {
            const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
            const remote = dismissedApprovalRemote({ liveHead: head });

            await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).rejects.toThrow(
                /ambiguous or non-exact remote review evidence/
            );
            expect(publishedReviewId(readDossier(fixture.root))).toBeUndefined();
            expect(lockOid(fixture.root)).toBe(fixture.ownerOid);
        });

        it('refuses a dismissed approval whose body differs from the retained document', async () => {
            const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
            const remote = dismissedApprovalRemote({
                reviews: dismissedApprovalReviews({ body: `${approvalBody} edited` }),
            });

            await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).rejects.toThrow(
                /ambiguous or non-exact remote review evidence/
            );
            expect(publishedReviewId(readDossier(fixture.root))).toBeUndefined();
            expect(lockOid(fixture.root)).toBe(fixture.ownerOid);
        });

        it('refuses a dismissed approval that carries a comment the retained document lacks', async () => {
            const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
            const remote = fakeGitHub({
                posted: true,
                landing: 'approve',
                liveHead: movedHead,
                reviews: dismissedApprovalReviews(),
                comments: [
                    ...prePublicationComments(),
                    restComment(landedReviewId, landedCommentIds[0]!, 670, landedCommentBodies[0]!),
                ],
            });

            await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).rejects.toThrow(
                /ambiguous or non-exact remote review evidence/
            );
            expect(lockOid(fixture.root)).toBe(fixture.ownerOid);
        });

        it('refuses a dismissed approval posted by the author App', async () => {
            const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
            const remote = dismissedApprovalRemote({
                reviews: dismissedApprovalReviews({ user: { node_id: AUTHOR_BOT_NODE_ID } }),
            });

            await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).rejects.toThrow(
                /unauthorized landed review evidence/
            );
            expect(publishedReviewId(readDossier(fixture.root))).toBeUndefined();
            expect(lockOid(fixture.root)).not.toBeUndefined();
        });

        it('refuses the reviewer dismissed approval when the author App holds a dismissed exact copy', async () => {
            const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
            const remote = dismissedApprovalRemote({
                reviews: [
                    ...dismissedApprovalReviews(),
                    restReview(5433790200, 'DISMISSED', approvalBody, AUTHOR_BOT_NODE_ID),
                ],
            });

            await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).rejects.toThrow(
                /unauthorized landed review evidence/
            );
            expect(publishedReviewId(readDossier(fixture.root))).toBeUndefined();
            expect(lockOid(fixture.root)).toBe(fixture.ownerOid);
        });

        it('refuses an author App dismissed exact copy that appears only by the second inspection', async () => {
            const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
            const first = dismissedApprovalRemote();
            const second = dismissedApprovalRemote({
                reviews: [
                    ...dismissedApprovalReviews(),
                    restReview(5433790200, 'DISMISSED', approvalBody, AUTHOR_BOT_NODE_ID),
                ],
            });

            await expect(
                recoverWith(fixture.root, fixture.ownerOid, first.gh, (inspection) =>
                    inspection === 1 ? first.gh : second.gh
                )
            ).rejects.toThrow(/unauthorized landed review evidence/);
            expect(publishedReviewId(readDossier(fixture.root))).toBeUndefined();
            expect(lockOid(fixture.root)).not.toBeUndefined();
        });

        it('refuses the reviewer live approval when the author App holds a dismissed exact copy on an unmoved head', async () => {
            const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
            const remote = fakeGitHub({
                posted: true,
                landing: 'approve',
                liveHead: head,
                reviews: [
                    ...prePublicationReviews(),
                    landedReview('approve'),
                    restReview(5433790200, 'DISMISSED', approvalBody, AUTHOR_BOT_NODE_ID),
                ],
                comments: prePublicationComments(),
            });

            await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).rejects.toThrow(
                /unauthorized landed review evidence/
            );
            expect(publishedReviewId(readDossier(fixture.root))).toBeUndefined();
            expect(deliveryAuthorization(readDossier(fixture.root))).toBeUndefined();
            expect(lockOid(fixture.root)).toBe(fixture.ownerOid);
        });

        it('refuses a prepared owner as unauthorized evidence, not absent, beside a dismissed exact copy on an unmoved head', async () => {
            const fixture = fixtureFor({ phase: 'prepared', planCarrying: true, landing: 'approve' });
            const remote = fakeGitHub({
                posted: true,
                landing: 'approve',
                liveHead: head,
                reviews: [
                    ...prePublicationReviews(),
                    restReview(5433790200, 'DISMISSED', approvalBody, AUTHOR_BOT_NODE_ID),
                ],
                comments: prePublicationComments(),
            });

            await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).rejects.toThrow(
                /unauthorized landed review evidence/
            );
            expect(publishedReviewId(readDossier(fixture.root))).toBeUndefined();
            expect(lockOid(fixture.root)).toBe(fixture.ownerOid);
            expect(readPullRequestMutationLockReceipt(fixture.root, number, fixture.ownerOid)).toBeUndefined();
        });

        it.each([
            { headState: 'unmoved', liveHead: head },
            { headState: 'moved', liveHead: movedHead },
        ])(
            'refuses a dismissed REQUEST_CHANGES exact copy with its comments from the author App on an $headState head',
            async ({ liveHead }) => {
                const fixture = fixtureFor({ planCarrying: true });
                const copyReviewId = 5433790200;
                const before = dossierText(fixture.root);
                const remote = fakeGitHub({
                    posted: true,
                    liveHead,
                    reviews: [
                        ...incidentReviews(),
                        restReview(copyReviewId, 'DISMISSED', renderedBody, AUTHOR_BOT_NODE_ID),
                    ],
                    comments: [
                        ...incidentComments(),
                        restComment(copyReviewId, 4199790200, 670, landedCommentBodies[0]!, {
                            actor: AUTHOR_BOT_NODE_ID,
                        }),
                        restComment(copyReviewId, 4199790201, 64, landedCommentBodies[1]!, {
                            actor: AUTHOR_BOT_NODE_ID,
                            originalPosition: 5,
                        }),
                    ],
                });

                await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).rejects.toThrow(
                    /unauthorized landed review evidence/
                );
                expect(dossierText(fixture.root)).toBe(before);
                expect(lockOid(fixture.root)).toBe(fixture.ownerOid);
            }
        );

        it.each(['PENDING', 'COMMENTED'])(
            'refuses an otherwise exact approval in state %s on a moved head',
            async (state) => {
                const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
                const remote = dismissedApprovalRemote({
                    reviews: dismissedApprovalReviews({ state }),
                });

                await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).rejects.toThrow(
                    /ambiguous or non-exact remote review evidence/
                );
                expect(publishedReviewId(readDossier(fixture.root))).toBeUndefined();
                expect(lockOid(fixture.root)).toBe(fixture.ownerOid);
            }
        );

        it('refuses a dismissed orchestrator acceptance even on a moved head', async () => {
            const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
            const bundle = bundlePath(fixture.root);
            const acceptance = parseAcceptanceDocument({
                format: 'compact-v1',
                event: 'APPROVE',
                body: 'Accepted after the independent approval; delivery may proceed.',
                evidence: {
                    headSha: head,
                    claims: [
                        {
                            observable: 'the stacking rule matches the stack procedure',
                            verification: 'read AGENTS.md against the delivery skill',
                            observed: 'one consistent rule',
                        },
                    ],
                },
            });
            writeFileSync(join(bundle, 'acceptance.json'), JSON.stringify(acceptance));
            const acceptanceBody = renderReviewDocumentBody(acceptance);
            const ownerOid = writeOwner(
                fixture.root,
                reviewPublicationPayloadDigest(
                    reviewPublicationPayload({
                        commitId: head,
                        event: acceptance.event,
                        body: acceptanceBody,
                        comments: [],
                    })
                ),
                'remote-mutation-attempted',
                '33333333-3333-4333-8333-333333333333',
                ORCHESTRATOR_USER_NODE_ID
            );
            const remote = fakeGitHub({
                posted: true,
                liveHead: movedHead,
                reviews: [
                    ...incidentReviews('approve'),
                    restReview(5433800000, 'DISMISSED', acceptanceBody, ORCHESTRATOR_USER_NODE_ID),
                ],
                comments: prePublicationComments(),
            });
            const before = dossierText(fixture.root);

            await expect(recoverWith(fixture.root, ownerOid, remote.gh)).rejects.toThrow(
                /ambiguous or non-exact remote review evidence/
            );
            expect(dossierText(fixture.root)).toBe(before);
            expect(lockOid(fixture.root)).toBe(ownerOid);
        });

        it('refuses a dismissed REQUEST_CHANGES review even on a moved head', async () => {
            const fixture = fixtureFor({ planCarrying: true });
            const remote = fakeGitHub({
                posted: true,
                liveHead: movedHead,
                reviews: [...prePublicationReviews(), { ...landedReview('request-changes'), state: 'DISMISSED' }],
            });

            await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).rejects.toThrow(
                /ambiguous or non-exact remote review evidence/
            );
            expect(lockOid(fixture.root)).toBe(fixture.ownerOid);
        });

        it('refuses when the approval stands live at the first inspection and is dismissed at the second', async () => {
            const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
            const live = fakeGitHub({ posted: true, landing: 'approve' });
            const dismissed = dismissedApprovalRemote();

            await expect(
                recoverWith(fixture.root, fixture.ownerOid, live.gh, (inspection) =>
                    inspection === 1 ? live.gh : dismissed.gh
                )
            ).rejects.toThrow(/remote state changed during reconciliation/);
            expect(publishedReviewId(readDossier(fixture.root))).toBeUndefined();
            expect(lockOid(fixture.root)).not.toBeUndefined();
        });

        it('refuses when the approval stands live at the first inspection and is dismissed at the second on an unmoved head', async () => {
            const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
            const live = fakeGitHub({ posted: true, landing: 'approve' });
            const dismissed = dismissedApprovalRemote({ liveHead: head });

            await expect(
                recoverWith(fixture.root, fixture.ownerOid, dismissed.gh, (inspection) =>
                    inspection === 1 ? live.gh : dismissed.gh
                )
            ).rejects.toThrow(/remote state changed during reconciliation/);
            expect(publishedReviewId(readDossier(fixture.root))).toBeUndefined();
            expect(deliveryAuthorization(readDossier(fixture.root))).toBeUndefined();
            expect(lockOid(fixture.root)).not.toBeUndefined();
        });

        it('refuses when the approval is dismissed between the two inspections on a head that moved before both', async () => {
            const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
            const live = fakeGitHub({ posted: true, landing: 'approve', liveHead: movedHead });
            const dismissed = dismissedApprovalRemote();
            const before = dossierText(fixture.root);

            await expect(
                recoverWith(fixture.root, fixture.ownerOid, live.gh, (inspection) =>
                    inspection === 1 ? live.gh : dismissed.gh
                )
            ).rejects.toThrow(/remote state changed during reconciliation/);
            expect(publishedReviewId(readDossier(fixture.root))).toBeUndefined();
            expect(dossierText(fixture.root)).toBe(before);
            expect(lockOid(fixture.root)).not.toBeUndefined();
        });

        it('releases a dismissed approval beside another actor dismissed review whose body differs from the document', async () => {
            const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
            const remote = dismissedApprovalRemote({
                reviews: [
                    ...dismissedApprovalReviews(),
                    restReview(5433790200, 'DISMISSED', `${approvalBody} edited`, AUTHOR_BOT_NODE_ID),
                ],
            });

            await expect(recoverWith(fixture.root, fixture.ownerOid, remote.gh)).resolves.toBe(0);

            expect(publishedReviewId(readDossier(fixture.root))).toBe(landedReviewId);
            expect(lockOid(fixture.root)).toBeUndefined();
            expect(readPullRequestMutationLockReceipt(fixture.root, number, fixture.ownerOid)).toMatchObject({
                outcome: 'landed',
            });
        });

        it('keeps a dismissed approval from standing as the live publication of a normal publish replay', async () => {
            const fixture = fixtureFor({ planCarrying: true, landing: 'approve' });
            const live = fakeGitHub({ posted: true, landing: 'approve' });
            await expect(recoverWith(fixture.root, fixture.ownerOid, live.gh)).resolves.toBe(0);
            const approval = parseReviewDocument(approvalDocumentJson);
            const dismissed = dismissedApprovalRemote({ liveHead: head });

            expect(
                recordedPublicationReplay(
                    number,
                    head,
                    approval,
                    REVIEWER_BOT_NODE_ID,
                    publicationPort(fixture.root, live.gh)
                )
            ).toBe(landedReviewId);
            expect(() =>
                recordedPublicationReplay(
                    number,
                    head,
                    approval,
                    REVIEWER_BOT_NODE_ID,
                    publicationPort(fixture.root, dismissed.gh)
                )
            ).toThrow(/recorded review publication \d+ does not stand live and exact/);
        });
    });
});
