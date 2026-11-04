import { describe, expect, it } from 'vitest';

import {
    appendReviewDossierEvents,
    assembleReviewDossier,
    authorizedEvidenceDigest,
    parseReviewDossier,
    serializeReviewDossier,
} from '../reviewDossier.ts';
import { buildDossier } from '../reviewDossierChain.ts';
import { buildReviewDossier, persistedReviewDossier, recoverReviewDossier } from '../reviewDossierPublication.ts';
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

const LOCATION = { path: 'scripts/reviewDossierPublication.ts', line: 42, side: 'RIGHT' } as const;
const SOURCE = { stance: DRAWS[0]!.stance, reviewerModel: DRAWS[0]!.reviewerModel };
const COMMENT = { ...LOCATION, sources: [SOURCE] };

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
        { kind: 'finding-accepted', findingId: 'comment-0', ...LOCATION },
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

    it('requires explicit sources for a freshly derived accepted finding', () => {
        expect(() => build({ comments: [LOCATION] })).toThrow(/comment 0 requires sources/u);
    });

    it('binds independent duplicate detections to exact stance and model pairs, regardless of draw order', () => {
        const second = { ...DRAWS[0]!, reviewerModel: 'model-three' };
        const sources = [SOURCE, { stance: second.stance, reviewerModel: second.reviewerModel }];
        const comments = [{ ...LOCATION, sources }];
        const first = build({ draws: [...DRAWS, second], comments });
        const reversed = build({ draws: [second, ...DRAWS].reverse(), comments });

        expect(acceptedFindings(first.dossier)).toEqual([{ findingId: 'comment-0', ...LOCATION, sources }]);
        expect(acceptedFindings(reversed.dossier)).toEqual(acceptedFindings(first.dossier));
        expect(serializeReviewDossier(parseReviewDossier(JSON.parse(first.canonical)))).toBe(first.canonical);
    });

    it.each([
        [
            'unknown stance',
            { ...SOURCE, stance: 'uncompleted stance' },
            /source.*does not name a completed findings draw/u,
        ],
        [
            'unknown model on a completed stance',
            { ...SOURCE, reviewerModel: 'unknown-model' },
            /source.*does not name a completed findings draw/u,
        ],
        [
            'clean draw',
            { stance: DRAWS[1]!.stance, reviewerModel: DRAWS[1]!.reviewerModel },
            /source.*does not name a completed findings draw/u,
        ],
    ])('refuses an accepted finding attributed to %s', (_label, source, message) => {
        expect(() => build({ comments: [{ ...LOCATION, sources: [source] }] })).toThrow(message);
    });

    it('does not credit a clean model draw just because another model found a defect on that stance', () => {
        const clean = { ...DRAWS[0]!, reviewerModel: 'clean-model', outcome: 'clean' as const };
        expect(() =>
            build({
                draws: [...DRAWS, clean],
                comments: [{ ...LOCATION, sources: [{ stance: clean.stance, reviewerModel: clean.reviewerModel }] }],
            })
        ).toThrow(/source.*does not name a completed findings draw/u);
    });

    it('refuses replay with changed or missing same-head attribution', () => {
        const second = { ...DRAWS[0]!, reviewerModel: 'model-three' };
        const draws = [...DRAWS, second];
        const persisted = appendReviewDossierEvents(build({ draws }).dossier, [
            { kind: 'review-published', reviewId: 5272945685 },
        ]);
        const changed = [{ ...LOCATION, sources: [{ stance: second.stance, reviewerModel: second.reviewerModel }] }];

        expect(() => build({ persisted, draws, comments: changed })).toThrow(/accepted finding 0 sources mismatch/u);
        expect(() => build({ persisted, draws, comments: [LOCATION] })).toThrow(/accepted finding 0 sources mismatch/u);
        expect(build({ persisted, draws }).canonical).toBe(serializeReviewDossier(persisted));
    });

    it('does not retrofit sources onto a published historical finding', () => {
        expect(() => build({ persisted: historicalRecord(true) })).toThrow(/accepted finding 0 sources mismatch/u);
        const replay = build({ persisted: historicalRecord(true), comments: [LOCATION] });
        expect(acceptedFindings(replay.dossier)[0]).not.toHaveProperty('sources');
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
        const result = build({ persisted, draws: [DRAWS[1]!], comments: [LOCATION] });

        expect(result.fromPersisted).toBe(true);
        expect(result.canonical).toBe(serializeReviewDossier(parseReviewDossier(persisted)));
        expect(`${JSON.stringify(persisted, null, 4)}\n`).toBe(result.canonical);
        expect(publishedReviewId(result.dossier)).toBe(5272945685);
        expect(result.dossier.assessmentImpact).toBe('none');
        expect(discardedDispositions(result.dossier)).toHaveLength(1);
    });

    it('refuses fresh source-absent findings over an unpublished historical record without draws', () => {
        expect(() => build({ persisted: historicalRecord(false), draws: undefined, comments: [LOCATION] })).toThrow(
            /comment 0 requires sources/u
        );
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
        expect(() => build({ plan, persisted: historicalRecord(true), comments: [LOCATION] })).toThrow(message);
    });

    it('refuses a replay whose comments drifted from the recorded findings', () => {
        const moved = { ...LOCATION, line: 43 };

        expect(() => build({ persisted: historicalRecord(true), comments: [moved] })).toThrow(
            /accepted finding 0 .* does not match review comment/u
        );
    });

    it('refuses a replay whose event disagrees with the recorded recommendation', () => {
        expect(() =>
            build({ persisted: historicalRecord(true), comments: [LOCATION], recommendation: 'approve' })
        ).toThrow(/publication recommendation mismatch/u);
    });

    it('recognizes only the canonical format as a persisted record', () => {
        expect(persistedReviewDossier(undefined)).toBeUndefined();
        expect(persistedReviewDossier([])).toBeUndefined();
        expect(persistedReviewDossier({ format: 'dossier-input-v1' })).toBeUndefined();
        expect(persistedReviewDossier(historicalRecord(false))?.format).toBe('dossier-v1');
    });
});

describe('recovered landed review dossier', () => {
    function recover(overrides: Partial<BuildInput> = {}) {
        return recoverReviewDossier({
            plan: PLAN,
            persisted: historicalRecord(false),
            draws: DRAWS,
            evidence: EVIDENCE,
            comments: [LOCATION],
            recommendation: 'request-changes',
            ...overrides,
        });
    }

    it.each([{ draws: DRAWS }, { draws: undefined }])(
        'reuses an exact unpublished historical record without inferring sources, draws=$draws',
        ({ draws }) => {
            const result = recover({ draws });
            expect(result.fromPersisted).toBe(true);
            expect(result.canonical).toBe(serializeReviewDossier(parseReviewDossier(historicalRecord(false))));
            expect(acceptedFindings(result.dossier)[0]).not.toHaveProperty('sources');
        }
    );

    it('refuses changed source attribution while reusing a historical record', () => {
        expect(() => recover({ comments: [COMMENT] })).toThrow(/accepted finding 0 sources mismatch/u);
    });

    it('still verifies plan and comment correspondence on the recovery route', () => {
        expect(() => recover({ plan: { ...PLAN, headSha: 'c'.repeat(40) } })).toThrow(/publication headSha mismatch/u);
        expect(() => recover({ comments: [{ ...LOCATION, line: 43 }] })).toThrow(/does not match review comment/u);
    });

    it('requires fresh sources when no verified persisted recovery record exists', () => {
        expect(() => recover({ persisted: undefined })).toThrow(/comment 0 requires sources/u);
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
