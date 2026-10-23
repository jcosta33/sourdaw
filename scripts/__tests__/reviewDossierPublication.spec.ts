import { describe, expect, it } from 'vitest';

import {
    appendReviewDossierEvents,
    assembleReviewDossier,
    authorizedEvidenceDigest,
    parseReviewDossier,
    serializeReviewDossier,
} from '../reviewDossier.ts';
import { buildDossier } from '../reviewDossierChain.ts';
import { buildReviewDossier, persistedReviewDossier } from '../reviewDossierPublication.ts';
import {
    acceptedFindings,
    completedStances,
    deliveryAuthorization,
    discardedDispositions,
    publishedReviewId,
} from '../reviewDossierViews.ts';

import type { ReviewDraw } from '../reviewDocumentParser.ts';
import type { ReviewDossier, ReviewDossierEvent } from '../reviewDossier.ts';
import type { ReviewRiskPlan } from '../reviewRiskPolicy.ts';

const PLAN: ReviewRiskPlan = {
    format: 'risk-plan-v1',
    pr: 2999,
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    riskClasses: ['small'],
    requiredStances: ['correctness', 'test-validity'],
    triggers: ['small:handwritten-lines<=200'],
};

const EVIDENCE = [
    {
        observable: 'the publication spec fails when an agreement check is skipped',
        verification: 'pnpm test:run scripts/__tests__/reviewDossierPublication.spec.ts',
        observed: 'one failing assertion on the agreement rule',
    },
];

const LIMITATION = 'the native audio path is not exercised on this head';

const DRAWS: readonly ReviewDraw[] = [
    { stance: 'stale replay binding', reviewerModel: 'model-one', tier: 'strongest', outcome: 'findings' },
    { stance: 'probe that never fails', reviewerModel: 'model-two', tier: 'standard', outcome: 'clean' },
];

const COMMENT = { path: 'scripts/reviewDossierPublication.ts', line: 42, side: 'RIGHT' } as const;

const COMPLETED_STANCES: readonly ReviewDossierEvent[] = [
    {
        kind: 'stance-completed',
        stance: 'correctness',
        reviewerModel: 'model-one',
        modelTier: 'strongest',
        outcome: 'clean',
    },
    {
        kind: 'stance-completed',
        stance: 'test-validity',
        reviewerModel: 'model-two',
        modelTier: 'standard',
        outcome: 'clean',
    },
];

type BuildInput = Parameters<typeof buildReviewDossier>[0];

function build(overrides: Partial<BuildInput> = {}): ReturnType<typeof buildReviewDossier> {
    return buildReviewDossier({
        plan: PLAN,
        persisted: undefined,
        draws: DRAWS,
        evidence: EVIDENCE,
        comments: [COMMENT],
        recommendation: 'request-changes',
        ...overrides,
    });
}

/**
 * A record persisted under the retired caller-input contract, carrying every historical field it
 * could: an assessment impact, an ignored reason, typed signal dispositions, a discard, a draw
 * exhaustion, and — once published — a review-reassessed event.
 */
function historicalRecord(published: boolean): unknown {
    const events: ReviewDossierEvent[] = [
        { ...COMPLETED_STANCES[0]!, exhaustion: 'every other harness was down' } as ReviewDossierEvent,
        COMPLETED_STANCES[1]!,
        { kind: 'finding-accepted', findingId: 'comment-0', ...COMMENT },
        { kind: 'finding-discarded', findingId: 'style-nit', stance: 'correctness', reason: 'personal style' },
    ];
    if (published) {
        events.push(
            { kind: 'review-published', reviewId: 5272945685 },
            { kind: 'finding-published', findingId: 'comment-0', reviewId: 5272945685, commentId: 77 },
            { kind: 'review-reassessed', roundsObserved: 3, threshold: 3, action: 'continue', reason: 'rescoped' }
        );
    }
    return JSON.parse(
        serializeReviewDossier(
            buildDossier({
                pr: PLAN.pr,
                headSha: PLAN.headSha,
                baseSha: PLAN.baseSha,
                riskClasses: PLAN.riskClasses,
                requiredStances: ['correctness', 'test-validity'],
                events,
                evidence: EVIDENCE,
                limitations: [LIMITATION],
                recommendation: 'request-changes',
                assessmentImpact: 'none',
                assessmentIgnoredReason: 'the withheld path was generated code',
                signalDispositions: [
                    {
                        ruleId: 'conditional_admission_added',
                        path: 'tests/e2e/a.spec.ts',
                        disposition: 'false-positive',
                    },
                ],
            })
        )
    );
}

describe('buildReviewDossier', () => {
    it('derives the canonical record from the document draws, in draw then comment order', () => {
        const result = build();

        expect(result.fromPersisted).toBe(false);
        expect(completedStances(result.dossier)).toEqual([
            {
                stance: 'stale replay binding',
                reviewerModel: 'model-one',
                modelTier: 'strongest',
                outcome: 'blocker-found',
                exhaustion: undefined,
            },
            {
                stance: 'probe that never fails',
                reviewerModel: 'model-two',
                modelTier: 'standard',
                outcome: 'clean',
                exhaustion: undefined,
            },
        ]);
        expect(acceptedFindings(result.dossier)).toEqual([{ findingId: 'comment-0', ...COMMENT }]);
        expect(result.dossier.requiredStances).toEqual(['probe that never fails', 'stale replay binding']);
        expect(result.dossier.evidence).toEqual(EVIDENCE);
        expect(result.dossier.limitations).toEqual([]);
        expect(result.dossier.recommendation).toBe('request-changes');
    });

    it('writes none of the retired semantic-review fields into a derived record', () => {
        const record = JSON.parse(build().canonical) as Record<string, unknown>;

        expect(Object.keys(record)).not.toEqual(expect.arrayContaining(['assessmentImpact']));
        expect(record).not.toHaveProperty('assessmentImpact');
        expect(record).not.toHaveProperty('assessmentIgnoredReason');
        expect(record).not.toHaveProperty('signalDispositions');
    });

    it('serializes a canonical string that parses back byte-stable', () => {
        const { canonical } = build();

        expect(serializeReviewDossier(parseReviewDossier(JSON.parse(canonical)))).toBe(canonical);
    });

    it('derives an APPROVE record with no comments', () => {
        const result = build({ comments: [], recommendation: 'approve' });

        expect(acceptedFindings(result.dossier)).toEqual([]);
        expect(result.dossier.recommendation).toBe('approve');
    });

    it('replaces a retired caller input in dossier.json with the derived record', () => {
        const result = build({ persisted: { format: 'dossier-input-v1', stances: [] } });

        expect(result.fromPersisted).toBe(false);
        expect(result.dossier.format).toBe('dossier-v1');
    });

    it('re-derives over an unpublished persisted record when the document carries draws', () => {
        const stale = JSON.parse(build({ comments: [], recommendation: 'approve' }).canonical) as unknown;
        const result = build({ persisted: stale });

        expect(result.fromPersisted).toBe(false);
        expect(acceptedFindings(result.dossier)).toHaveLength(1);
    });

    it('replays a published historical record unchanged, whatever draws the document carries', () => {
        const persisted = historicalRecord(true);
        const result = build({ persisted, draws: [DRAWS[1]!] });

        expect(result.fromPersisted).toBe(true);
        expect(result.canonical).toBe(serializeReviewDossier(parseReviewDossier(persisted)));
        expect(`${JSON.stringify(persisted, null, 4)}\n`).toBe(result.canonical);
        expect(publishedReviewId(result.dossier)).toBe(5272945685);
        expect(result.dossier.assessmentImpact).toBe('none');
        expect(discardedDispositions(result.dossier)).toHaveLength(1);
    });

    it('falls back to an unpublished historical record when the document carries no draws', () => {
        const persisted = historicalRecord(false);
        const result = build({ persisted, draws: undefined });

        expect(result.fromPersisted).toBe(true);
        expect(completedStances(result.dossier).map((draw) => draw.stance)).toEqual(['correctness', 'test-validity']);
    });

    it('refuses a fresh document without draws when no persisted record exists', () => {
        expect(() => build({ draws: undefined })).toThrow(
            `review.json must carry draws for head ${PLAN.headSha}: one { stance, reviewerModel, tier, outcome } entry per completed blind draw`
        );
    });

    it('refuses a tampered record claiming the canonical format instead of replacing it', () => {
        const persisted = historicalRecord(true) as { limitations: string[] };
        persisted.limitations = ['edited after publication'];

        expect(() => build({ persisted })).toThrow(/dossierDigest does not match its payload/u);
    });

    it.each([
        ['pr', { ...PLAN, pr: 3000 }, /publication pr mismatch/u],
        ['headSha', { ...PLAN, headSha: 'c'.repeat(40) }, /publication headSha mismatch/u],
        ['baseSha', { ...PLAN, baseSha: 'c'.repeat(40) }, /publication baseSha mismatch/u],
        [
            'riskClasses',
            { ...PLAN, riskClasses: ['ordinary'] as ReviewRiskPlan['riskClasses'] },
            /publication riskClasses mismatch/u,
        ],
    ])('refuses a persisted record rebound from the plan on %s', (_label, plan, message) => {
        expect(() => build({ plan, persisted: historicalRecord(true) })).toThrow(message);
    });

    it('refuses a replay whose comments drifted from the recorded findings', () => {
        const moved = { ...COMMENT, line: 43 };

        expect(() => build({ persisted: historicalRecord(true), comments: [moved] })).toThrow(
            /accepted finding 0 .* does not match review comment/u
        );
    });

    it('refuses a replay whose event disagrees with the recorded recommendation', () => {
        expect(() =>
            build({ persisted: historicalRecord(true), comments: [COMMENT], recommendation: 'approve' })
        ).toThrow(/publication recommendation mismatch/u);
    });

    it('recognizes only the canonical format as a persisted record', () => {
        expect(persistedReviewDossier(undefined)).toBeUndefined();
        expect(persistedReviewDossier([])).toBeUndefined();
        expect(persistedReviewDossier({ format: 'dossier-input-v1' })).toBeUndefined();
        expect(persistedReviewDossier(historicalRecord(false))?.format).toBe('dossier-v1');
    });
});

describe('delivery authorization binding (#3376, spec #3367 AC-005)', () => {
    const REVIEW_ID = 770;

    function publishedDossier(): ReviewDossier {
        const base = assembleReviewDossier({
            plan: PLAN,
            events: COMPLETED_STANCES,
            evidence: EVIDENCE,
            limitations: [LIMITATION],
            recommendation: 'approve',
        });
        return appendReviewDossierEvents(base, [{ kind: 'review-published', reviewId: REVIEW_ID }]);
    }

    function authorizedDossier(published: ReviewDossier, overrides: Record<string, unknown> = {}): ReviewDossier {
        return appendReviewDossierEvents(published, [
            {
                kind: 'delivery-authorized',
                reviewId: REVIEW_ID,
                approvalReviewId: REVIEW_ID,
                evidenceManifestDigest: published.dossierDigest,
                unresolvedThreads: 0,
                intent: 'deliver',
                ...overrides,
            },
        ]);
    }

    it('round-trips a recorded authorization and recovers the acceptance-time digest', () => {
        const published = publishedDossier();
        const authorized = authorizedDossier(published);
        const parsed = parseReviewDossier(JSON.parse(serializeReviewDossier(authorized)));

        expect(deliveryAuthorization(parsed)).toEqual({
            reviewId: REVIEW_ID,
            approvalReviewId: REVIEW_ID,
            evidenceManifestDigest: published.dossierDigest,
            unresolvedThreads: 0,
            intent: 'deliver',
        });
        expect(authorizedEvidenceDigest(parsed)).toBe(published.dossierDigest);
        expect(parsed.dossierDigest).not.toBe(published.dossierDigest);
    });

    it('returns the record digest unchanged while no authorization is recorded', () => {
        const published = publishedDossier();

        expect(authorizedEvidenceDigest(published)).toBe(published.dossierDigest);
        expect(deliveryAuthorization(published)).toBeUndefined();
    });

    it('refuses a second delivery authorization', () => {
        const published = publishedDossier();
        const authorized = authorizedDossier(published);

        expect(() =>
            appendReviewDossierEvents(authorized, [
                {
                    kind: 'delivery-authorized',
                    reviewId: 771,
                    approvalReviewId: REVIEW_ID,
                    evidenceManifestDigest: published.dossierDigest,
                    unresolvedThreads: 0,
                    intent: 'deliver',
                },
            ])
        ).toThrow(/more than one delivery authorization: 770 and 771/);
    });

    it('refuses a delivery authorization recorded before any publication', () => {
        const base = assembleReviewDossier({
            plan: PLAN,
            events: COMPLETED_STANCES,
            evidence: EVIDENCE,
            limitations: [LIMITATION],
            recommendation: 'approve',
        });

        expect(() => authorizedDossier(base)).toThrow(/without a recorded publication/);
    });

    it('refuses a delivery authorization binding an approval other than the recorded publication', () => {
        const published = publishedDossier();

        expect(() => authorizedDossier(published, { approvalReviewId: 999 })).toThrow(
            /binds approval 999, not the recorded publication 770/
        );
    });

    it.each([
        ['a non-hex evidence manifest digest', { evidenceManifestDigest: 'not-a-digest' }],
        ['a foreign intent', { intent: 'publish' }],
        ['a negative unresolved thread count', { unresolvedThreads: -1 }],
    ])('refuses %s', (_label, override) => {
        const published = publishedDossier();

        expect(() => authorizedDossier(published, override)).toThrow();
    });
});
