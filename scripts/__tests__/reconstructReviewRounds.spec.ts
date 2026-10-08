import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_NODE_ID, ORCHESTRATOR_USER_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import {
    readPublicReviewComments,
    reconstructReviewRounds,
    runReviewReconstruction,
    runReconstructReviewRoundsCli,
    shadowCompareDossier,
    type PublicReview,
    type PublicReviewComment,
    type ReconstructReviewRoundsPort,
} from '../reconstructReviewRounds.ts';
import { appendReviewDossierEvents, parseReviewDossier } from '../reviewDossier.ts';
import { buildDossier } from '../reviewDossierChain.ts';
import { buildReviewDossier, type ReviewDossierInput } from '../reviewDossierPublication.ts';
import {
    renderReviewRepairConfirmationMarker,
    renderReviewRepairReply,
    reviewRepairRecordDigest,
    type ReviewRepairRecord,
} from '../reviewRepair.ts';

import type { ReviewRiskPlan } from '../reviewRiskPolicy.ts';

const head = 'c'.repeat(40);
const olderHead = 'b'.repeat(40);
const base = 'd'.repeat(40);

const plan: ReviewRiskPlan = {
    format: 'risk-plan-v1',
    pr: 42,
    headSha: head,
    baseSha: base,
    riskClasses: ['small'],
    requiredStances: ['correctness', 'test-validity'],
    triggers: [],
};

const dossierInput: ReviewDossierInput = {
    format: 'dossier-input-v1',
    pr: 42,
    headSha: head,
    baseSha: base,
    stances: [
        { stance: 'correctness', reviewerModel: 'review-model', modelTier: 'strongest', outcome: 'clean' },
        { stance: 'test-validity', reviewerModel: 'review-model', modelTier: 'standard', outcome: 'clean' },
    ],
    evidence: [],
    limitations: [],
    assessmentImpact: 'none',
};

function repairRecord(rootCommentId: number, commit: string): ReviewRepairRecord {
    return {
        format: 'repair-v1',
        pr: 42,
        thread: 'thread-1',
        finding: { commentId: rootCommentId, path: 'scripts/target.ts', line: 5, side: 'RIGHT' },
        commit,
        summary: 'fixed the gate',
        evidence: [
            {
                observable: 'the repair is confirmed once',
                verification: 'pnpm review:reconstruct 42',
                observed: 'the public repair and confirmation are distinct records',
            },
        ],
        head,
    };
}

function reviewerReview(id: number, commitId: string, state: string): PublicReview {
    return { id, state, commitId, actorNodeId: REVIEWER_BOT_NODE_ID, body: 'round' };
}

function rootComment(id: number, reviewId: number): PublicReviewComment {
    return {
        id,
        reviewId,
        actorNodeId: REVIEWER_BOT_NODE_ID,
        path: 'scripts/target.ts',
        line: 5,
        side: 'RIGHT',
        body: 'blocking',
    };
}

describe('reconstruct review rounds', () => {
    it('rebuilds governed rounds with findings and repairs from public channels alone', () => {
        const reviews: PublicReview[] = [
            reviewerReview(20, head, 'APPROVED'),
            { id: 19, state: 'APPROVED', commitId: head, actorNodeId: ORCHESTRATOR_USER_NODE_ID, body: 'accepted' },
            reviewerReview(11, head, 'CHANGES_REQUESTED'),
            reviewerReview(10, olderHead, 'CHANGES_REQUESTED'),
            { id: 9, state: 'COMMENTED', commitId: olderHead, actorNodeId: REVIEWER_BOT_NODE_ID, body: 'note' },
            { id: 8, state: 'APPROVED', commitId: olderHead, actorNodeId: 'MDQ6VXNlcjEyMzQ=', body: 'human' },
        ];
        const comments: PublicReviewComment[] = [
            rootComment(100, 10),
            rootComment(101, 11),
            {
                ...rootComment(102, 11),
                id: 102,
                actorNodeId: AUTHOR_BOT_NODE_ID,
                inReplyToId: 101,
                body: renderReviewRepairReply(repairRecord(101, head)),
            },
            {
                ...rootComment(104, 11),
                inReplyToId: 101,
                body: renderReviewRepairReply(repairRecord(101, head)),
            },
            { ...rootComment(103, 11), id: 103, inReplyToId: 101, body: 'plain prose reply' },
        ];
        const reconstruction = reconstructReviewRounds(42, { state: 'OPEN', head }, reviews, comments);
        expect(reconstruction.rounds.map((round) => round.reviewId)).toEqual([10, 11, 19, 20]);
        const [first, second, acceptance, approval] = reconstruction.rounds;
        expect(first).toMatchObject({ headSha: olderHead, role: 'reviewer', verdict: 'changes-requested' });
        expect(first?.findings.map((finding) => finding.commentId)).toEqual([100]);
        expect(second?.findings).toHaveLength(1);
        expect(second?.findings[0]?.repairs).toEqual([repairRecord(101, head)]);
        expect(second?.findings[0]?.confirmations).toEqual([
            {
                format: 'legacy-repair-v1',
                recordDigest: reviewRepairRecordDigest(repairRecord(101, head)),
                confirmationHead: head,
            },
        ]);
        expect(acceptance).toMatchObject({ role: 'orchestrator', verdict: 'approved' });
        expect(approval).toMatchObject({ role: 'reviewer', verdict: 'approved' });
    });

    it('fails closed when a repair reply answers an unknown root comment', () => {
        const comments: PublicReviewComment[] = [
            { ...rootComment(200, 10), inReplyToId: 999, body: renderReviewRepairReply(repairRecord(999, head)) },
        ];
        expect(() =>
            reconstructReviewRounds(
                42,
                { state: 'OPEN', head },
                [reviewerReview(10, head, 'CHANGES_REQUESTED')],
                comments
            )
        ).toThrow(/answers an unknown root comment/u);
    });

    it('reconstructs a modern compact confirmation only when its whole-record digest binds the author repair and root', () => {
        const record = repairRecord(100, head);
        const comments: PublicReviewComment[] = [
            rootComment(100, 10),
            {
                ...rootComment(101, 10),
                actorNodeId: AUTHOR_BOT_NODE_ID,
                inReplyToId: 100,
                body: renderReviewRepairReply(record),
            },
            {
                ...rootComment(102, 10),
                inReplyToId: 100,
                body: renderReviewRepairConfirmationMarker(record, head),
            },
        ];
        const reconstruction = reconstructReviewRounds(
            42,
            { state: 'OPEN', head },
            [reviewerReview(10, head, 'CHANGES_REQUESTED')],
            comments
        );
        expect(reconstruction.rounds[0]?.findings[0]).toMatchObject({
            repairs: [record],
            confirmations: [
                {
                    format: 'repair-confirmation-v1',
                    recordDigest: expect.any(String),
                    confirmationHead: head,
                },
            ],
        });
    });

    it('keeps empty-evidence V1 author records and legacy reviewer confirmations readable', () => {
        const record = { ...repairRecord(100, head), evidence: [] };
        const comments: PublicReviewComment[] = [
            rootComment(100, 10),
            {
                ...rootComment(101, 10),
                actorNodeId: AUTHOR_BOT_NODE_ID,
                inReplyToId: 100,
                body: renderReviewRepairReply(record),
            },
            { ...rootComment(102, 10), inReplyToId: 100, body: renderReviewRepairReply(record) },
        ];
        const reconstruction = reconstructReviewRounds(
            42,
            { state: 'OPEN', head },
            [reviewerReview(10, head, 'CHANGES_REQUESTED')],
            comments
        );
        expect(reconstruction.rounds[0]?.findings[0]).toMatchObject({
            repairs: [record],
            confirmations: [
                {
                    format: 'legacy-repair-v1',
                    recordDigest: reviewRepairRecordDigest(record),
                    confirmationHead: head,
                },
            ],
        });
    });

    it.each([
        { label: 'wrong pull request', confirmation: (record: ReviewRepairRecord) => ({ ...record, pr: 43 }) },
        {
            label: 'wrong thread',
            confirmation: (record: ReviewRepairRecord) => ({ ...record, thread: 'thread-other' }),
        },
        {
            label: 'different author record digest',
            confirmation: (record: ReviewRepairRecord) => ({ ...record, summary: 'a changed source record' }),
        },
        {
            label: 'wrong root finding',
            confirmation: (record: ReviewRepairRecord) => ({
                ...record,
                finding: { ...record.finding, commentId: 999 },
            }),
        },
    ])('refuses a compact confirmation with $label', ({ confirmation }) => {
        const source = repairRecord(100, head);
        const comments: PublicReviewComment[] = [
            rootComment(100, 10),
            {
                ...rootComment(101, 10),
                actorNodeId: AUTHOR_BOT_NODE_ID,
                inReplyToId: 100,
                body: renderReviewRepairReply(source),
            },
            {
                ...rootComment(102, 10),
                inReplyToId: 100,
                body: renderReviewRepairConfirmationMarker(confirmation(source), head),
            },
        ];
        expect(() =>
            reconstructReviewRounds(
                42,
                { state: 'OPEN', head },
                [reviewerReview(10, head, 'CHANGES_REQUESTED')],
                comments
            )
        ).toThrow(/confirmation/u);
    });

    it.each([AUTHOR_BOT_NODE_ID, REVIEWER_BOT_NODE_ID])(
        'fails closed on a malformed repair marker from authorized actor %s',
        (actorNodeId) => {
            const comments: PublicReviewComment[] = [
                rootComment(100, 10),
                { ...rootComment(101, 10), actorNodeId, inReplyToId: 100, body: 'sourdaw-repair-v1 {not json' },
                {
                    ...rootComment(105, 10),
                    actorNodeId,
                    inReplyToId: 100,
                    body: 'sourdaw-repair-confirmation-v1 {not json',
                },
            ];
            expect(() =>
                reconstructReviewRounds(
                    42,
                    { state: 'OPEN', head },
                    [reviewerReview(10, head, 'CHANGES_REQUESTED')],
                    comments
                )
            ).toThrow(/repair/u);
        }
    );

    it.each(['BOT_foreign', ORCHESTRATOR_USER_NODE_ID, null])(
        'ignores malformed and well-formed repair markers from untrusted actor %s before parsing or root lookup',
        (actorNodeId) => {
            const comments: PublicReviewComment[] = [
                rootComment(100, 10),
                { ...rootComment(101, 10), actorNodeId, inReplyToId: 100, body: 'sourdaw-repair-v1 {not json' },
                { ...rootComment(102, 10), actorNodeId, inReplyToId: 999, body: 'sourdaw-repair-v1 {not json' },
                {
                    ...rootComment(103, 10),
                    actorNodeId,
                    inReplyToId: 100,
                    body: renderReviewRepairReply(repairRecord(100, head)),
                },
                {
                    ...rootComment(104, 10),
                    actorNodeId,
                    inReplyToId: 999,
                    body: renderReviewRepairReply(repairRecord(999, head)),
                },
            ];
            const reconstruction = reconstructReviewRounds(
                42,
                { state: 'OPEN', head },
                [reviewerReview(10, head, 'CHANGES_REQUESTED')],
                comments
            );
            expect(reconstruction.rounds).toEqual([
                {
                    headSha: head,
                    reviewId: 10,
                    role: 'reviewer',
                    verdict: 'changes-requested',
                    findings: [
                        {
                            commentId: 100,
                            path: 'scripts/target.ts',
                            line: 5,
                            side: 'RIGHT',
                            repairs: [],
                            confirmations: [],
                        },
                    ],
                },
            ]);
        }
    );
});

describe('readPublicReviewComments', () => {
    it('retains immutable actors across all REST pages and represents absent or unreadable actors as null', () => {
        const users = [
            { node_id: AUTHOR_BOT_NODE_ID, login: 'renamed-author[bot]' },
            { node_id: REVIEWER_BOT_NODE_ID, login: 'renamed-reviewer[bot]' },
            { node_id: 'BOT_foreign', login: 'hplovecraft208[bot]' },
            { login: 'hplovecraft208[bot]' },
            null,
            undefined,
            { node_id: 42 },
        ];
        const entries = users.map((user, index) => ({
            id: index + 100,
            pull_request_review_id: 10,
            path: 'scripts/target.ts',
            original_line: 5,
            side: 'RIGHT',
            body: 'sourdaw-repair-v1 {not json',
            in_reply_to_id: 99,
            user,
        }));
        const requests: string[][] = [];
        const comments = readPublicReviewComments((args) => {
            requests.push(args);
            return JSON.stringify([entries.slice(0, 2), entries.slice(2, 5), entries.slice(5)]);
        }, 42);

        expect(requests).toEqual([
            ['api', '--paginate', '--slurp', 'repos/jcosta33/sourdaw/pulls/42/comments?per_page=100'],
        ]);
        expect(comments.map((comment) => [comment.id, comment.actorNodeId, comment.inReplyToId])).toEqual([
            [100, AUTHOR_BOT_NODE_ID, 99],
            [101, REVIEWER_BOT_NODE_ID, 99],
            [102, 'BOT_foreign', 99],
            [103, null, 99],
            [104, null, 99],
            [105, null, 99],
            [106, null, 99],
        ]);
    });
});

describe('shadow comparison', () => {
    function dossierWithPublication(
        comments: readonly { path: string; line: number; side: 'RIGHT' }[],
        reviewId: number
    ) {
        const { canonical } = buildReviewDossier({
            plan,
            raw: dossierInput,
            discarded: [],
            comments,
            recommendation: comments.length === 0 ? 'approve' : 'request-changes',
        });
        const bound = appendReviewDossierEvents(parseReviewDossier(JSON.parse(canonical)), [
            { kind: 'review-published', reviewId },
            ...comments.map((_comment, index) => ({
                kind: 'finding-published' as const,
                findingId: `comment-${index}`,
                reviewId,
                commentId: 100 + index,
            })),
        ]);
        return structuredClone(bound) as unknown;
    }

    it('records zero mismatches when the dossier and the public record agree exactly', () => {
        const reconstruction = reconstructReviewRounds(
            42,
            { state: 'OPEN', head },
            [reviewerReview(99, head, 'CHANGES_REQUESTED')],
            [rootComment(100, 99)]
        );
        const dossier = dossierWithPublication([{ path: 'scripts/target.ts', line: 5, side: 'RIGHT' }], 99);
        expect(shadowCompareDossier(reconstruction, head, dossier).mismatches).toEqual([]);
    });

    it('records a mismatch when the recorded publication stands in no public round', () => {
        const reconstruction = reconstructReviewRounds(
            42,
            { state: 'OPEN', head },
            [reviewerReview(98, head, 'APPROVED')],
            []
        );
        const dossier = dossierWithPublication([], 99);
        const { mismatches } = shadowCompareDossier(reconstruction, head, dossier);
        expect(mismatches).toEqual([`recorded publication 99 stands in no public round on head ${head}`]);
    });

    it('records a mismatch when a bound comment id disagrees with the public order', () => {
        const reconstruction = reconstructReviewRounds(
            42,
            { state: 'OPEN', head },
            [reviewerReview(99, head, 'CHANGES_REQUESTED')],
            [rootComment(555, 99)]
        );
        const dossier = dossierWithPublication([{ path: 'scripts/target.ts', line: 5, side: 'RIGHT' }], 99);
        const { mismatches } = shadowCompareDossier(reconstruction, head, dossier);
        expect(mismatches.some((line) => line.includes('binds comment 100'))).toBe(true);
        expect(mismatches.some((line) => line.includes('555'))).toBe(true);
    });

    it('records a mismatch when an accepted finding binds no public comment', () => {
        const { canonical } = buildReviewDossier({
            plan,
            raw: dossierInput,
            discarded: [],
            comments: [{ path: 'scripts/target.ts', line: 5, side: 'RIGHT' }],
            recommendation: 'request-changes',
        });
        const bound = appendReviewDossierEvents(parseReviewDossier(JSON.parse(canonical)), [
            { kind: 'review-published', reviewId: 99 },
        ]);
        const reconstruction = reconstructReviewRounds(
            42,
            { state: 'OPEN', head },
            [reviewerReview(99, head, 'CHANGES_REQUESTED')],
            [rootComment(100, 99)]
        );
        const { mismatches } = shadowCompareDossier(reconstruction, head, structuredClone(bound));
        expect(mismatches).toEqual(['accepted finding comment-0 binds no public comment']);
    });

    it('records a mismatch when the dossier recommendation disagrees with the public verdict', () => {
        const reconstruction = reconstructReviewRounds(
            42,
            { state: 'OPEN', head },
            [reviewerReview(99, head, 'APPROVED')],
            []
        );
        const dossier = dossierWithPublication([{ path: 'scripts/target.ts', line: 5, side: 'RIGHT' }], 99);
        const { mismatches } = shadowCompareDossier(reconstruction, head, dossier);
        expect(mismatches.some((line) => line.includes('recommendation request-changes'))).toBe(true);
        expect(mismatches.some((line) => line.includes('accepts 1 findings'))).toBe(true);
    });

    it('refuses a dossier whose chain does not validate instead of comparing it', () => {
        const dossier = dossierWithPublication([], 99) as { events: Record<string, unknown>[] };
        const last = dossier.events[dossier.events.length - 1];
        if (last === undefined) {
            throw new Error('fixture dossier carries no events');
        }
        last.digest = 'y'.repeat(64);
        const reconstruction = reconstructReviewRounds(
            42,
            { state: 'OPEN', head },
            [reviewerReview(99, head, 'APPROVED')],
            []
        );
        expect(() => shadowCompareDossier(reconstruction, head, dossier)).toThrow(/digest does not match/u);
    });
});

describe('reconstruction run', () => {
    function port(input: {
        reviews: PublicReview[];
        comments: PublicReviewComment[];
        dossiers?: Record<string, unknown>;
    }): { port: ReconstructReviewRoundsPort; logged: string[] } {
        const logged: string[] = [];
        return {
            logged,
            port: {
                pullRequest: () => ({ state: 'OPEN', head }),
                reviews: () => input.reviews,
                reviewComments: () => input.comments,
                localDossier: (_number, dossierHead) => input.dossiers?.[dossierHead],
                log: (message) => logged.push(message),
            },
        };
    }

    it('shadow-compares only heads whose local bundle carries a dossier and never gates on a mismatch', () => {
        const { canonical } = buildReviewDossier({
            plan: { ...plan, headSha: olderHead },
            raw: { ...dossierInput, headSha: olderHead },
            discarded: [],
            comments: [],
            recommendation: 'approve',
        });
        const bound = appendReviewDossierEvents(parseReviewDossier(JSON.parse(canonical)), [
            { kind: 'review-published', reviewId: 10 },
        ]);
        const { port: reconstructed, logged } = port({
            reviews: [reviewerReview(10, olderHead, 'APPROVED'), reviewerReview(11, head, 'APPROVED')],
            comments: [],
            dossiers: { [olderHead]: structuredClone(bound) },
        });
        const run = runReviewReconstruction(42, reconstructed);
        expect(run.reconstruction.rounds).toHaveLength(2);
        expect(run.comparisons).toHaveLength(1);
        expect(run.mismatches).toBe(0);
        expect(logged.at(-1)).toBe('review-reconstruction:42:rounds=2:compared=1:mismatches=0');
    });

    it('reports mismatches without failing the run', () => {
        const { canonical } = buildReviewDossier({
            plan,
            raw: dossierInput,
            discarded: [],
            comments: [],
            recommendation: 'approve',
        });
        const bound = appendReviewDossierEvents(parseReviewDossier(JSON.parse(canonical)), [
            { kind: 'review-published', reviewId: 77 },
        ]);
        const { port: reconstructed, logged } = port({
            reviews: [reviewerReview(10, head, 'APPROVED')],
            comments: [],
            dossiers: { [head]: structuredClone(bound) },
        });
        const run = runReviewReconstruction(42, reconstructed);
        expect(run.mismatches).toBe(1);
        expect(logged.some((line) => line.startsWith('shadow mismatch'))).toBe(true);
        expect(logged.at(-1)).toBe('review-reconstruction:42:rounds=1:compared=1:mismatches=1');
    });

    it('prints repair and confirmation counts separately for a cold public reconstruction', () => {
        const record = repairRecord(100, head);
        const { port: reconstructed, logged } = port({
            reviews: [reviewerReview(10, head, 'CHANGES_REQUESTED')],
            comments: [
                rootComment(100, 10),
                {
                    ...rootComment(101, 10),
                    actorNodeId: AUTHOR_BOT_NODE_ID,
                    inReplyToId: 100,
                    body: renderReviewRepairReply(record),
                },
                {
                    ...rootComment(102, 10),
                    inReplyToId: 100,
                    body: renderReviewRepairConfirmationMarker(record, head),
                },
            ],
        });
        runReviewReconstruction(42, reconstructed);
        expect(logged[0]).toBe(
            `round: head ${head} review 10 reviewer changes-requested findings 1 repairs 1 confirmations 1`
        );
    });

    it('completes for a bundle holding an unpublished historical dossier with no assessment impact', () => {
        // The shape most persisted dossiers on disk have: no review-published event, no impact. The
        // read path tolerates the absent field, so the run compares the head instead of aborting.
        const unpublished = buildDossier({
            pr: 42,
            headSha: head,
            baseSha: base,
            riskClasses: ['small'],
            requiredStances: ['correctness'],
            events: [
                {
                    kind: 'stance-completed',
                    stance: 'correctness',
                    reviewerModel: 'model-correctness',
                    modelTier: 'strongest',
                    outcome: 'clean',
                },
            ],
            evidence: [],
            limitations: [],
            recommendation: 'approve',
        });
        const { port: reconstructed, logged } = port({
            reviews: [reviewerReview(10, head, 'APPROVED')],
            comments: [],
            dossiers: { [head]: structuredClone(unpublished) },
        });
        const run = runReviewReconstruction(42, reconstructed);

        expect(run.comparisons).toHaveLength(1);
        expect(run.mismatches).toBe(1);
        expect(logged.some((line) => line.includes('dossier records no publication'))).toBe(true);
        expect(logged.at(-1)).toBe('review-reconstruction:42:rounds=1:compared=1:mismatches=1');
    });
});

describe('reconstruct CLI', () => {
    const idlePort: ReconstructReviewRoundsPort = {
        pullRequest: () => ({ state: 'OPEN', head }),
        reviews: () => [],
        reviewComments: () => [],
        localDossier: () => undefined,
        log: () => undefined,
    };

    it('refuses bad arguments with usage', () => {
        expect(() => runReconstructReviewRoundsCli([], idlePort)).toThrow(/review:reconstruct/u);
        expect(() => runReconstructReviewRoundsCli(['42', 'extra'], idlePort)).toThrow(/review:reconstruct/u);
        expect(() => runReconstructReviewRoundsCli(['-1'], idlePort)).toThrow(/review:reconstruct/u);
    });

    it('runs a clean reconstruction to exit zero', () => {
        expect(runReconstructReviewRoundsCli(['42'], idlePort)).toBe(0);
    });
});
