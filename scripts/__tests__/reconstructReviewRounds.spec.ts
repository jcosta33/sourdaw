import { describe, expect, it } from 'vitest';

import { ORCHESTRATOR_USER_NODE_ID, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';
import {
    reconstructReviewRounds,
    runReviewReconstruction,
    runReconstructReviewRoundsCli,
    shadowCompareDossier,
    type PublicReview,
    type PublicReviewComment,
    type ReconstructReviewRoundsPort,
} from '../reconstructReviewRounds.ts';
import { appendReviewDossierEvents, parseReviewDossier } from '../reviewDossier.ts';
import { buildReviewDossier, type ReviewDossierInput } from '../reviewDossierPublication.ts';
import { renderReviewRepairReply, type ReviewRepairRecord } from '../reviewRepair.ts';

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
        evidence: [],
        head,
    };
}

function reviewerReview(id: number, commitId: string, state: string): PublicReview {
    return { id, state, commitId, actorNodeId: REVIEWER_BOT_NODE_ID, body: 'round' };
}

function rootComment(id: number, reviewId: number): PublicReviewComment {
    return { id, reviewId, path: 'scripts/target.ts', line: 5, side: 'RIGHT', body: 'blocking' };
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
        expect(second?.findings[0]?.repairs).toHaveLength(1);
        expect(second?.findings[0]?.repairs[0]?.commit).toBe(head);
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

    it('fails closed on a malformed repair marker rather than reading it as absent', () => {
        const comments: PublicReviewComment[] = [
            rootComment(100, 10),
            { ...rootComment(101, 10), id: 101, inReplyToId: 100, body: 'sourdaw-repair-v1 {not json' },
        ];
        expect(() =>
            reconstructReviewRounds(
                42,
                { state: 'OPEN', head },
                [reviewerReview(10, head, 'CHANGES_REQUESTED')],
                comments
            )
        ).toThrow(/repair/u);
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
