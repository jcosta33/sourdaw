import { describe, expect, it } from 'vitest';

import {
    appendReviewDossierEvents,
    assembleReviewDossier,
    authorizedEvidenceDigest,
    parseReviewDossier,
    serializeReviewDossier,
} from '../reviewDossier.ts';
import { ASSESSMENT_IMPACTS, buildDossier } from '../reviewDossierChain.ts';
import {
    REVIEW_DOSSIER_INPUT_FORMAT,
    buildReviewDossier,
    parseReviewDossierInput,
    parseReviewStancesRecord,
} from '../reviewDossierPublication.ts';
import {
    acceptedFindings,
    assessmentImpact,
    completedStances,
    deliveryAuthorization,
    discardedDispositions,
    publishedReviewId,
} from '../reviewDossierViews.ts';

import type { AssessmentImpact, ReviewDossier, ReviewDossierEvent } from '../reviewDossier.ts';
import type { ReviewDossierInput, ReviewDossierStanceInput } from '../reviewDossierPublication.ts';
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

const CORRECTNESS_STANCE: ReviewDossierStanceInput = {
    stance: 'correctness',
    reviewerModel: 'model-correctness',
    modelTier: 'strongest',
    outcome: 'blocker-found',
};

const TEST_VALIDITY_STANCE: ReviewDossierStanceInput = {
    stance: 'test-validity',
    reviewerModel: 'model-test-validity',
    modelTier: 'standard',
    outcome: 'clean',
};

const CODE_CRAFT_STANCE: ReviewDossierStanceInput = {
    stance: 'code-craft',
    reviewerModel: 'model-code-craft',
    modelTier: 'standard',
    outcome: 'clean',
};

const SECURITY_PLATFORM_STANCE: ReviewDossierStanceInput = {
    stance: 'security-platform',
    reviewerModel: 'model-security-platform',
    modelTier: 'standard',
    outcome: 'clean',
};

const GATE_CORRESPONDENCE_STANCE: ReviewDossierStanceInput = {
    stance: 'gate-correspondence correctness — a dossier entry the record does not carry must never publish',
    reviewerModel: 'model-gate-correspondence',
    modelTier: 'standard',
    outcome: 'clean',
};

function stanceCompleted(stance: ReviewDossierStanceInput): ReviewDossierEvent {
    return {
        kind: 'stance-completed',
        stance: stance.stance,
        reviewerModel: stance.reviewerModel,
        modelTier: stance.modelTier,
        outcome: stance.outcome,
    };
}

function acceptedFinding(finding: {
    findingId: string;
    path: string;
    line: number;
    side: 'LEFT' | 'RIGHT';
}): ReviewDossierEvent {
    return {
        kind: 'finding-accepted',
        findingId: finding.findingId,
        path: finding.path,
        line: finding.line,
        side: finding.side,
    };
}

const COMPLETED_STANCES: readonly ReviewDossierEvent[] = [
    stanceCompleted(CORRECTNESS_STANCE),
    stanceCompleted(TEST_VALIDITY_STANCE),
];

const COMMENT = { path: 'scripts/reviewDossierPublication.ts', line: 42, side: 'RIGHT' } as const;

const MATCHING_COMMENT_FINDING = acceptedFinding({
    findingId: 'comment-0',
    path: COMMENT.path,
    line: COMMENT.line,
    side: COMMENT.side,
});

const INPUT: ReviewDossierInput = {
    format: REVIEW_DOSSIER_INPUT_FORMAT,
    pr: PLAN.pr,
    headSha: PLAN.headSha,
    baseSha: PLAN.baseSha,
    stances: [CORRECTNESS_STANCE, TEST_VALIDITY_STANCE],
    evidence: EVIDENCE,
    limitations: [LIMITATION],
    assessmentImpact: 'none',
};

/** A canonical, already-persisted record of the shape the publisher could find on disk. */
function persistedRecord(options: {
    plan?: ReviewRiskPlan;
    events?: readonly ReviewDossierEvent[];
    discarded?: unknown;
    recommendation?: 'approve' | 'request-changes';
    assessmentImpact?: AssessmentImpact;
}): unknown {
    const dossier: ReviewDossier = assembleReviewDossier({
        plan: options.plan ?? PLAN,
        events: options.events ?? COMPLETED_STANCES,
        discarded: options.discarded ?? [],
        evidence: EVIDENCE,
        limitations: [LIMITATION],
        recommendation: options.recommendation ?? 'request-changes',
        assessmentImpact: options.assessmentImpact ?? 'none',
    });
    return JSON.parse(serializeReviewDossier(dossier));
}

type InputRefusalCase = { label: string; value: unknown; message: RegExp };

/** The caller input with the required assessment impact deleted outright, not merely undefined. */
function inputWithoutAssessmentImpact(): Record<string, unknown> {
    const { assessmentImpact: _omitted, ...rest } = INPUT;
    return rest;
}

/**
 * The bundle's own persisted record for the head, authored directly, omitting the impact: the shape
 * every pre-field dossier on disk has. `reviewId` adds the record's self-asserted publication.
 */
function canonicalPersistedRecordWithImpactOmitted(reviewId?: number): unknown {
    const events: ReviewDossierEvent[] = [...COMPLETED_STANCES];
    if (reviewId !== undefined) {
        events.push({ kind: 'review-published', reviewId });
    }
    return buildDossier({
        pr: PLAN.pr,
        headSha: PLAN.headSha,
        baseSha: PLAN.baseSha,
        riskClasses: PLAN.riskClasses,
        requiredStances: [...PLAN.requiredStances],
        events,
        evidence: EVIDENCE,
        limitations: [LIMITATION],
        recommendation: 'request-changes',
    });
}

const INPUT_REFUSALS: readonly InputRefusalCase[] = [
    { label: 'a non-object', value: 'not an object', message: /input must be an object/ },
    {
        label: 'a missing format',
        value: { ...INPUT, format: undefined },
        message: /input format must be dossier-input-v1/,
    },
    {
        label: 'a foreign format',
        value: { ...INPUT, format: 'dossier-v1' },
        message: /input format must be dossier-input-v1/,
    },
    { label: 'a zero pr', value: { ...INPUT, pr: 0 }, message: /input pr must be a positive safe integer/ },
    { label: 'a fractional pr', value: { ...INPUT, pr: 1.5 }, message: /input pr must be a positive safe integer/ },
    {
        label: 'a blank headSha',
        value: { ...INPUT, headSha: '   ' },
        message: /input headSha must be a non-blank string/,
    },
    { label: 'a blank baseSha', value: { ...INPUT, baseSha: '' }, message: /input baseSha must be a non-blank string/ },
    { label: 'a non-array stances', value: { ...INPUT, stances: {} }, message: /input stances must be an array/ },
    { label: 'a non-array evidence', value: { ...INPUT, evidence: 'x' }, message: /input evidence must be an array/ },
    {
        label: 'a non-array limitations',
        value: { ...INPUT, limitations: null },
        message: /input limitations must be an array/,
    },
    {
        label: 'a non-object stance',
        value: { ...INPUT, stances: ['correctness'] },
        message: /input stances\[0\] must be an object/,
    },
    {
        label: 'a blank stance',
        value: { ...INPUT, stances: [{ ...CORRECTNESS_STANCE, stance: '   ' }] },
        message: /input stances\[0\]\.stance must be a non-blank string/,
    },
    {
        label: 'an edge-untrimmed stance',
        value: { ...INPUT, stances: [{ ...CORRECTNESS_STANCE, stance: ' padded stance name' }] },
        message: /input stances\[0\]\.stance value at index 0 is not edge-trimmed/,
    },
    {
        label: 'a multiline stance',
        value: { ...INPUT, stances: [{ ...CORRECTNESS_STANCE, stance: 'first line\nsecond line' }] },
        message: /input stances\[0\]\.stance value at index 0 contains a line separator/,
    },
    {
        label: 'a missing stance field',
        value: { ...INPUT, stances: [{ stance: 'correctness', reviewerModel: 'm', modelTier: 'standard' }] },
        message: /input stances\[0\]\.outcome must be blocker-found or clean/,
    },
    {
        label: 'a duplicate free-form stance',
        value: { ...INPUT, stances: [GATE_CORRESPONDENCE_STANCE, GATE_CORRESPONDENCE_STANCE] },
        message:
            /input stances\[1\] repeats stances\[0\]'s stance and reviewerModel: gate-correspondence correctness — a dossier entry the record does not carry must never publish on model-gate-correspondence/,
    },
    {
        label: 'an unknown model tier',
        value: { ...INPUT, stances: [{ ...CORRECTNESS_STANCE, modelTier: 'cheap' }] },
        message: /input stances\[0\]\.modelTier must be economy, standard or strongest/,
    },
    {
        label: 'an unknown outcome',
        value: { ...INPUT, stances: [{ ...CORRECTNESS_STANCE, outcome: 'found-nothing' }] },
        message: /input stances\[0\]\.outcome must be blocker-found or clean/,
    },
    {
        label: 'a blank reviewerModel',
        value: { ...INPUT, stances: [{ ...CORRECTNESS_STANCE, reviewerModel: ' ' }] },
        message: /input stances\[0\]\.reviewerModel must be a non-blank string/,
    },
    {
        label: 'a credential-shaped reviewerModel',
        value: { ...INPUT, stances: [{ ...CORRECTNESS_STANCE, reviewerModel: `ghp_${'A'.repeat(24)}` }] },
        message: /input stances\[0\]\.reviewerModel value at index 0 contains a GitHub token/,
    },
    {
        label: 'a duplicate stance',
        value: { ...INPUT, stances: [CORRECTNESS_STANCE, CORRECTNESS_STANCE] },
        message: /input stances\[1\] repeats stances\[0\]'s stance and reviewerModel: correctness on model-correctness/,
    },
    {
        label: 'a blank exhaustion',
        value: { ...INPUT, stances: [{ ...CORRECTNESS_STANCE, exhaustion: '   ' }] },
        message: /input stances\[0\]\.exhaustion must be a non-blank string/,
    },
    {
        label: 'a multiline exhaustion',
        value: { ...INPUT, stances: [{ ...CORRECTNESS_STANCE, exhaustion: 'first\nsecond' }] },
        message: /input stances\[0\]\.exhaustion value at index 0 contains a line separator/,
    },
    {
        label: 'an edge-untrimmed exhaustion',
        value: { ...INPUT, stances: [{ ...CORRECTNESS_STANCE, exhaustion: ' padded reason ' }] },
        message: /input stances\[0\]\.exhaustion value at index 0 is not edge-trimmed/,
    },
    {
        label: 'a malformed evidence entry',
        value: { ...INPUT, evidence: [{ observable: 'x', verification: 'y' }] },
        message: /input evidence\[0\]\.observed must be a non-blank string/,
    },
    {
        label: 'a blank limitation',
        value: { ...INPUT, limitations: [''] },
        message: /input limitations\[0\] must be a non-blank string/,
    },
    {
        label: 'a missing assessment impact',
        value: inputWithoutAssessmentImpact(),
        message: /input assessmentImpact must be none, limitation-only, stance-changed or finding-led, found undefined/,
    },
    {
        label: 'an unknown assessment impact',
        value: { ...INPUT, assessmentImpact: 'ignored' },
        message: /input assessmentImpact must be none, limitation-only, stance-changed or finding-led, found "ignored"/,
    },
    {
        label: 'a non-string assessment impact',
        value: { ...INPUT, assessmentImpact: 7 },
        message: /input assessmentImpact must be none, limitation-only, stance-changed or finding-led, found 7/,
    },
    {
        label: 'a blank assessment ignored reason',
        value: { ...INPUT, assessmentIgnoredReason: '   ' },
        message: /input assessmentIgnoredReason must be a non-blank string/,
    },
    {
        label: 'an edge-untrimmed assessment ignored reason',
        value: { ...INPUT, assessmentIgnoredReason: ' padded reason ' },
        message: /input assessmentIgnoredReason value at index 0 is not edge-trimmed/,
    },
    {
        label: 'a multiline assessment ignored reason',
        value: { ...INPUT, assessmentIgnoredReason: 'first line\nsecond line' },
        message: /input assessmentIgnoredReason value at index 0 contains a line separator/,
    },
    {
        label: 'a credential-shaped assessment ignored reason',
        value: { ...INPUT, assessmentIgnoredReason: `ghp_${'A'.repeat(24)}` },
        message: /input assessmentIgnoredReason value at index 0 contains a GitHub token/,
    },
];

type BuildRefusalCase = { label: string; run: () => unknown; message: RegExp };

const BUILD_REFUSALS: readonly BuildRefusalCase[] = [
    {
        label: 'a dossier omitting a free-form stance the pre-dispatch record carries',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: { ...INPUT, stances: [GATE_CORRESPONDENCE_STANCE] },
                recordedStances: [GATE_CORRESPONDENCE_STANCE.stance, TEST_VALIDITY_STANCE.stance],
                discarded: [],
                comments: [],
                recommendation: 'approve',
            }),
        message: /review dossier publication stances do not match stances\.json: missing \[test-validity\], extra \[\]/,
    },
    {
        label: 'a plan-conforming dossier the differing pre-dispatch record does not carry',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: INPUT,
                recordedStances: ['correctness', 'security-platform'],
                discarded: [],
                comments: [],
                recommendation: 'approve',
            }),
        message:
            /review dossier publication stances do not match stances\.json: missing \[security-platform\], extra \[test-validity\]/,
    },
    {
        label: 'a dossier stance the pre-dispatch record does not carry',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: { ...INPUT, stances: [CORRECTNESS_STANCE, TEST_VALIDITY_STANCE, CODE_CRAFT_STANCE] },
                recordedStances: ['correctness', 'test-validity'],
                discarded: [],
                comments: [],
                recommendation: 'approve',
            }),
        message: /review dossier publication stances do not match stances\.json: missing \[\], extra \[code-craft\]/,
    },
    {
        label: 'a duplicate stance',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: { ...INPUT, stances: [CORRECTNESS_STANCE, CORRECTNESS_STANCE] },
                discarded: [],
                comments: [],
                recommendation: 'approve',
            }),
        message: /input stances\[1\] repeats stances\[0\]'s stance and reviewerModel/,
    },
    {
        label: 'a recommendation the caller did not derive',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: persistedRecord({
                    events: [...COMPLETED_STANCES, MATCHING_COMMENT_FINDING],
                    recommendation: 'approve',
                }),
                discarded: [],
                comments: [COMMENT],
                recommendation: 'request-changes',
            }),
        message: /review dossier publication recommendation mismatch: record has "approve", expected "request-changes"/,
    },
    {
        label: 'a plan rebound on pr',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: persistedRecord({
                    plan: { ...PLAN, pr: 1 },
                    events: [...COMPLETED_STANCES, MATCHING_COMMENT_FINDING],
                }),
                discarded: [],
                comments: [COMMENT],
                recommendation: 'request-changes',
            }),
        message: /review dossier publication pr mismatch: record has 1, expected 2999/,
    },
    {
        label: 'a plan rebound on headSha',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: persistedRecord({
                    plan: { ...PLAN, headSha: 'other-head' },
                    events: [...COMPLETED_STANCES, MATCHING_COMMENT_FINDING],
                }),
                discarded: [],
                comments: [COMMENT],
                recommendation: 'request-changes',
            }),
        message: /review dossier publication headSha mismatch: record has "other-head"/,
    },
    {
        label: 'a plan rebound on baseSha',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: persistedRecord({
                    plan: { ...PLAN, baseSha: 'other-base' },
                    events: [...COMPLETED_STANCES, MATCHING_COMMENT_FINDING],
                }),
                discarded: [],
                comments: [COMMENT],
                recommendation: 'request-changes',
            }),
        message: /review dossier publication baseSha mismatch: record has "other-base"/,
    },
    {
        label: 'a comment the dossier does not record',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: persistedRecord({ events: COMPLETED_STANCES }),
                discarded: [],
                comments: [COMMENT],
                recommendation: 'request-changes',
            }),
        message: /review dossier publication accepted finding count 0 does not match 1 review comments/,
    },
    {
        label: 'a dossier finding the review document does not carry',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: persistedRecord({
                    events: [
                        ...COMPLETED_STANCES,
                        acceptedFinding({
                            findingId: 'comment-0',
                            path: 'scripts/invented.ts',
                            line: 7,
                            side: 'LEFT',
                        }),
                    ],
                }),
                discarded: [],
                comments: [COMMENT],
                recommendation: 'request-changes',
            }),
        message:
            /review dossier publication accepted finding 0 scripts\/invented\.ts:7:LEFT does not match review comment scripts\/reviewDossierPublication\.ts:42:RIGHT/,
    },
    {
        label: 'a dossier finding on the same path and side but a different line',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: persistedRecord({
                    events: [
                        ...COMPLETED_STANCES,
                        acceptedFinding({
                            findingId: 'comment-0',
                            path: COMMENT.path,
                            line: COMMENT.line + 1,
                            side: COMMENT.side,
                        }),
                    ],
                }),
                discarded: [],
                comments: [COMMENT],
                recommendation: 'request-changes',
            }),
        message:
            /review dossier publication accepted finding 0 scripts\/reviewDossierPublication\.ts:43:RIGHT does not match review comment scripts\/reviewDossierPublication\.ts:42:RIGHT/,
    },
    {
        label: 'a dossier finding on the same path and line but a different side',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: persistedRecord({
                    events: [
                        ...COMPLETED_STANCES,
                        acceptedFinding({
                            findingId: 'comment-0',
                            path: COMMENT.path,
                            line: COMMENT.line,
                            side: 'LEFT',
                        }),
                    ],
                }),
                discarded: [],
                comments: [COMMENT],
                recommendation: 'request-changes',
            }),
        message:
            /review dossier publication accepted finding 0 scripts\/reviewDossierPublication\.ts:42:LEFT does not match review comment scripts\/reviewDossierPublication\.ts:42:RIGHT/,
    },
    {
        label: 'a dossier finding on the same line and side but a different path',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: persistedRecord({
                    events: [
                        ...COMPLETED_STANCES,
                        acceptedFinding({
                            findingId: 'comment-0',
                            path: 'scripts/invented.ts',
                            line: COMMENT.line,
                            side: COMMENT.side,
                        }),
                    ],
                }),
                discarded: [],
                comments: [COMMENT],
                recommendation: 'request-changes',
            }),
        message:
            /review dossier publication accepted finding 0 scripts\/invented\.ts:42:RIGHT does not match review comment scripts\/reviewDossierPublication\.ts:42:RIGHT/,
    },
    {
        label: 'a dossier finding whose id is not the positional comment id',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: persistedRecord({
                    events: [
                        ...COMPLETED_STANCES,
                        acceptedFinding({
                            findingId: 'invented-0',
                            path: COMMENT.path,
                            line: COMMENT.line,
                            side: COMMENT.side,
                        }),
                    ],
                }),
                discarded: [],
                comments: [COMMENT],
                recommendation: 'request-changes',
            }),
        message: /review dossier publication accepted finding 0 id invented-0 must be comment-0/,
    },
    {
        label: 'a discarded finding id colliding with a comment-derived id',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: persistedRecord({
                    events: [
                        ...COMPLETED_STANCES,
                        acceptedFinding({
                            findingId: 'finding-1',
                            path: COMMENT.path,
                            line: COMMENT.line,
                            side: COMMENT.side,
                        }),
                    ],
                    discarded: [{ finding: 'comment-0', stance: 'correctness', reason: 'stale diff context' }],
                }),
                discarded: [],
                comments: [COMMENT],
                recommendation: 'request-changes',
            }),
        message: /review dossier publication discarded finding id comment-0 collides with a review comment id/,
    },
    {
        label: 'a discarded payload that is not an array',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: INPUT,
                discarded: { finding: 'discarded-1' },
                comments: [],
                recommendation: 'approve',
            }),
        message: /review dossier discarded must be an array/,
    },
    {
        label: 'a discarded entry with missing fields',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: INPUT,
                discarded: [{ finding: 'discarded-1' }],
                comments: [],
                recommendation: 'approve',
            }),
        message: /review dossier discarded\[0\] fields must be finding,reason,stance/,
    },
    {
        label: 'an input identity with a non-positive pr',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: { ...INPUT, pr: 0 },
                discarded: [],
                comments: [],
                recommendation: 'approve',
            }),
        message: /review dossier input pr must be a positive safe integer/,
    },
    {
        label: 'a fresh input whose pr disagrees with the plan',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: { ...INPUT, pr: 1 },
                discarded: [],
                comments: [],
                recommendation: 'approve',
            }),
        message: /review dossier input pr mismatch: record has 1, expected 2999/,
    },
    {
        label: 'a fresh input whose headSha disagrees with the plan',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: { ...INPUT, headSha: 'other-head' },
                discarded: [],
                comments: [],
                recommendation: 'approve',
            }),
        message: /review dossier input headSha mismatch: record has "other-head", expected "a{40}"/,
    },
    {
        label: 'a fresh input whose baseSha disagrees with the plan',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: { ...INPUT, baseSha: 'other-base' },
                discarded: [],
                comments: [],
                recommendation: 'approve',
            }),
        message: /review dossier input baseSha mismatch: record has "other-base", expected "b{40}"/,
    },
    {
        label: 'an input identity with a blank headSha',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: { ...INPUT, headSha: ' ' },
                discarded: [],
                comments: [],
                recommendation: 'approve',
            }),
        message: /review dossier input headSha must be a non-blank string/,
    },
    {
        label: 'an input whose format is unknown',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: { ...INPUT, format: 'dossier-input-v2' },
                discarded: [],
                comments: [],
                recommendation: 'approve',
            }),
        message: /review dossier input format must be dossier-input-v1/,
    },
    {
        label: 'an input claiming limitation-only with no limited round',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: { ...INPUT, assessmentImpact: 'limitation-only', limitations: [] },
                discarded: [],
                comments: [],
                recommendation: 'request-changes',
            }),
        message: /assessmentImpact limitation-only contradicts limitations: the round discloses none/,
    },
    {
        label: 'an input claiming finding-led with no accepted finding',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: { ...INPUT, assessmentImpact: 'finding-led' },
                discarded: [],
                comments: [],
                recommendation: 'request-changes',
            }),
        message: /assessmentImpact finding-led contradicts accepted findings: the round carries none/,
    },
    {
        label: 'a reason beside a non-none impact',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: {
                    ...INPUT,
                    assessmentImpact: 'stance-changed',
                    assessmentIgnoredReason: 'the assessment surfaced nothing actionable',
                },
                discarded: [],
                comments: [],
                recommendation: 'approve',
            }),
        message: /assessmentIgnoredReason requires assessmentImpact none, found stance-changed/,
    },
];

describe('parseReviewDossierInput', () => {
    it('accepts the caller-authored input form', () => {
        expect(parseReviewDossierInput(INPUT)).toEqual(INPUT);
    });

    /**
     * The documented rule, pinned beside the spec that enforces it: the caller input always carries
     * `assessmentImpact`; only a persisted record replaying an already-published head may omit it.
     */
    it('requires the impact on the caller input unconditionally, even for an already-published head', () => {
        expect(() => parseReviewDossierInput(inputWithoutAssessmentImpact())).toThrow(
            /input assessmentImpact must be none, limitation-only, stance-changed or finding-led, found undefined/
        );
    });

    it.each(INPUT_REFUSALS)('refuses $label', ({ value, message }) => {
        expect(() => parseReviewDossierInput(value)).toThrow(message);
    });
});

describe('persisted record without an assessment impact', () => {
    /**
     * The tolerance is anchored on the bundle's own persisted record, not on the record's
     * self-asserted publication or a live fact: the input form always carries the field (above),
     * while a persisted record may omit it, because that is the shape every pre-field dossier has.
     */
    it.each([undefined, 5272945685])(
        'tolerates the persisted record that omits the impact (publication event: %s)',
        (reviewId) => {
            const result = buildReviewDossier({
                plan: PLAN,
                raw: canonicalPersistedRecordWithImpactOmitted(reviewId),
                discarded: [],
                comments: [],
                recommendation: 'request-changes',
            });

            expect(result.fromPersisted).toBe(true);
            expect(result.dossier.assessmentImpact).toBeUndefined();
            if (reviewId !== undefined) {
                expect(publishedReviewId(result.dossier)).toBe(reviewId);
            }
            expect(serializeReviewDossier(parseReviewDossier(JSON.parse(result.canonical)))).toBe(result.canonical);
        }
    );
});

describe('parseReviewStancesRecord', () => {
    const STANCES_PATH = 'bundles/42-abc/stances.json';

    it('accepts a record whose entries carry free-form admission and probe fields', () => {
        expect(
            parseReviewStancesRecord(
                {
                    stances: [
                        {
                            stance: 'correctness',
                            admission: 'a reordered queue drops a buffered voice frame',
                            baselineProbe: { spec: 'queue.spec.ts', mutation: 'revert the ordering guard' },
                        },
                        { stance: 'test-validity' },
                    ],
                    note: 'floor of three satisfied with a third dispatch below',
                },
                STANCES_PATH
            )
        ).toEqual({ stances: [{ stance: 'correctness' }, { stance: 'test-validity' }] });
    });

    it('refuses a non-object record and names the file', () => {
        expect(() => parseReviewStancesRecord('not a record', STANCES_PATH)).toThrow(
            /review stances record at bundles\/42-abc\/stances\.json must be an object/
        );
    });

    it('refuses a stances field that is not an array and names the file', () => {
        expect(() => parseReviewStancesRecord({ stances: 'correctness' }, STANCES_PATH)).toThrow(
            /review stances record at bundles\/42-abc\/stances\.json stances must be an array/
        );
    });

    it('refuses an entry without a stance string and names the file and index', () => {
        expect(() =>
            parseReviewStancesRecord({ stances: [{ stance: 'correctness' }, { admission: 'x' }] }, STANCES_PATH)
        ).toThrow(/review stances record at bundles\/42-abc\/stances\.json stances\[1\] must carry a stance string/);
    });
});

describe('buildReviewDossier', () => {
    it('assembles the canonical record from the input form, in stance then comment order', () => {
        const result = buildReviewDossier({
            plan: PLAN,
            raw: INPUT,
            discarded: [],
            comments: [COMMENT],
            recommendation: 'request-changes',
        });

        expect(result.fromPersisted).toBe(false);
        const parsed = parseReviewDossier(JSON.parse(result.canonical));
        expect(parsed.format).toBe('dossier-v1');
        expect({ pr: parsed.pr, headSha: parsed.headSha, baseSha: parsed.baseSha }).toEqual({
            pr: PLAN.pr,
            headSha: PLAN.headSha,
            baseSha: PLAN.baseSha,
        });
        expect(parsed.riskClasses).toEqual(PLAN.riskClasses);
        expect(parsed.requiredStances).toEqual(PLAN.requiredStances);
        expect(completedStances(parsed)).toEqual(INPUT.stances);
        expect(acceptedFindings(parsed)).toEqual([
            { findingId: 'comment-0', path: COMMENT.path, line: COMMENT.line, side: COMMENT.side },
        ]);
        expect(parsed.recommendation).toBe('request-changes');
        expect(parsed.evidence).toEqual(EVIDENCE);
        expect(parsed.limitations).toEqual([LIMITATION]);
    });

    it.each(ASSESSMENT_IMPACTS)(
        'carries the %s assessment impact from the input form into the canonical record',
        (token) => {
            const result = buildReviewDossier({
                plan: PLAN,
                raw: { ...INPUT, assessmentImpact: token },
                discarded: [],
                comments: [COMMENT],
                recommendation: 'request-changes',
            });

            expect(assessmentImpact(result.dossier)).toBe(token);
            expect(parseReviewDossier(JSON.parse(result.canonical)).assessmentImpact).toBe(token);
        }
    );

    it('gives dossiers differing only in assessmentImpact different digests and replays each unchanged', () => {
        const build = (assessmentImpact: AssessmentImpact) =>
            buildReviewDossier({
                plan: PLAN,
                raw: { ...INPUT, assessmentImpact },
                discarded: [],
                comments: [COMMENT],
                recommendation: 'request-changes',
            });

        const none = build('none');
        const findingLed = build('finding-led');

        expect(none.dossier.dossierDigest).not.toBe(findingLed.dossier.dossierDigest);
        const replayed = buildReviewDossier({
            plan: PLAN,
            raw: JSON.parse(findingLed.canonical),
            discarded: [],
            comments: [COMMENT],
            recommendation: 'request-changes',
        });
        expect(replayed.fromPersisted).toBe(true);
        expect(replayed.canonical).toBe(findingLed.canonical);
    });

    it('carries the assessmentIgnoredReason beside a none impact and covers it in the digest', () => {
        const REASON = 'the withheld audio module is outside this change’s blast radius';
        const build = (reason?: string) =>
            buildReviewDossier({
                plan: PLAN,
                raw: { ...INPUT, assessmentIgnoredReason: reason },
                discarded: [],
                comments: [COMMENT],
                recommendation: 'request-changes',
            });

        const without = build();
        const withReason = build(REASON);

        expect(without.dossier.assessmentIgnoredReason).toBeUndefined();
        expect(withReason.dossier.assessmentIgnoredReason).toBe(REASON);
        expect(without.dossier.dossierDigest).not.toBe(withReason.dossier.dossierDigest);
        expect(serializeReviewDossier(parseReviewDossier(JSON.parse(withReason.canonical)))).toBe(withReason.canonical);
        expect(parseReviewDossier(JSON.parse(withReason.canonical)).assessmentIgnoredReason).toBe(REASON);
    });

    it('keeps the accepted-finding ids positional, matching the comments array', () => {
        const comments = [
            { path: 'scripts/a.ts', line: 1, side: 'LEFT' as const },
            { path: 'scripts/b.ts', line: 2, side: 'RIGHT' as const },
        ];
        const result = buildReviewDossier({
            plan: PLAN,
            raw: INPUT,
            discarded: [],
            comments,
            recommendation: 'request-changes',
        });

        expect(acceptedFindings(result.dossier)).toEqual([
            { findingId: 'comment-0', path: 'scripts/a.ts', line: 1, side: 'LEFT' },
            { findingId: 'comment-1', path: 'scripts/b.ts', line: 2, side: 'RIGHT' },
        ]);
    });

    it('carries the caller discarded findings into the record', () => {
        const result = buildReviewDossier({
            plan: PLAN,
            raw: INPUT,
            discarded: [{ finding: 'discarded-1', stance: 'correctness', reason: 'stale diff context' }],
            comments: [COMMENT],
            recommendation: 'request-changes',
        });

        expect(discardedDispositions(result.dossier)).toEqual([
            { findingId: 'discarded-1', stance: 'correctness', reason: 'stale diff context' },
        ]);
    });

    it('accepts a persisted record with no comments as an APPROVE publication', () => {
        const cleanStances: readonly ReviewDossierStanceInput[] = [
            { ...CORRECTNESS_STANCE, outcome: 'clean' },
            { ...TEST_VALIDITY_STANCE, outcome: 'clean' },
        ];

        const result = buildReviewDossier({
            plan: PLAN,
            raw: persistedRecord({ events: cleanStances.map(stanceCompleted), recommendation: 'approve' }),
            discarded: [],
            comments: [],
            recommendation: 'approve',
        });

        expect(result.fromPersisted).toBe(true);
        expect(acceptedFindings(result.dossier)).toEqual([]);
        expect(result.dossier.recommendation).toBe('approve');
    });

    it('accepts the input form with no comments as an APPROVE publication', () => {
        const result = buildReviewDossier({
            plan: PLAN,
            raw: INPUT,
            discarded: [],
            comments: [],
            recommendation: 'approve',
        });

        expect(result.fromPersisted).toBe(false);
        expect(acceptedFindings(result.dossier)).toEqual([]);
        expect(result.canonical).toBe(serializeReviewDossier(result.dossier));
    });

    it('serializes a canonical string that parses back byte-stable', () => {
        const result = buildReviewDossier({
            plan: PLAN,
            raw: INPUT,
            discarded: [],
            comments: [COMMENT],
            recommendation: 'request-changes',
        });

        expect(serializeReviewDossier(parseReviewDossier(JSON.parse(result.canonical)))).toBe(result.canonical);
        expect(result.canonical.endsWith('\n')).toBe(true);
    });

    it('replays a persisted record unchanged on a second call', () => {
        const first = buildReviewDossier({
            plan: PLAN,
            raw: INPUT,
            discarded: [],
            comments: [COMMENT],
            recommendation: 'request-changes',
        });

        const second = buildReviewDossier({
            plan: PLAN,
            raw: JSON.parse(first.canonical),
            discarded: [],
            comments: [COMMENT],
            recommendation: 'request-changes',
        });

        expect(second.fromPersisted).toBe(true);
        expect(second.canonical).toBe(first.canonical);
    });

    it('recognizes an independently persisted record without rebuilding it', () => {
        const persisted = persistedRecord({ events: [...COMPLETED_STANCES, MATCHING_COMMENT_FINDING] });
        const result = buildReviewDossier({
            plan: PLAN,
            raw: persisted,
            discarded: [],
            comments: [COMMENT],
            recommendation: 'request-changes',
        });

        expect(result.fromPersisted).toBe(true);
        expect(result.canonical).toBe(serializeReviewDossier(parseReviewDossier(persisted)));
    });

    it('publishes a dossier matching the pre-dispatch stance record one-to-one', () => {
        const result = buildReviewDossier({
            plan: PLAN,
            raw: INPUT,
            recordedStances: ['test-validity', 'correctness'],
            discarded: [],
            comments: [COMMENT],
            recommendation: 'request-changes',
        });

        expect(result.fromPersisted).toBe(false);
        expect(completedStances(result.dossier).map((entry) => entry.stance)).toEqual(['correctness', 'test-validity']);
    });

    it('publishes a dossier whose free-form stances match a free-form pre-dispatch record one-to-one', () => {
        // The real caller record's shape: free-form risk names, failure-mode admissions and
        // baseline-probe results the gate never reads, and extra fields beside `stances`.
        const stancesRecord = {
            stances: [
                {
                    stance: GATE_CORRESPONDENCE_STANCE.stance,
                    admission: 'a dossier entry the pre-dispatch record does not carry publishes',
                    baselineProbe: {
                        spec: 'reviewDossierPublication.spec.ts',
                        mutation: 'answer the correspondence gate to the plan instead of the record',
                    },
                },
                { stance: TEST_VALIDITY_STANCE.stance, admission: 'a weakened assertion can no longer fail' },
            ],
            note: 'failure-mode admissions and probe results are caller evidence the gate never reads',
        };
        const recordedStances = parseReviewStancesRecord(stancesRecord, 'bundles/2999-head/stances.json').stances.map(
            (entry) => entry.stance
        );
        const result = buildReviewDossier({
            plan: PLAN,
            raw: { ...INPUT, stances: [GATE_CORRESPONDENCE_STANCE, TEST_VALIDITY_STANCE] },
            recordedStances,
            discarded: [
                {
                    finding: 'discarded-free-form',
                    stance: GATE_CORRESPONDENCE_STANCE.stance,
                    reason: 'not reproducible on this head',
                },
            ],
            comments: [COMMENT],
            recommendation: 'request-changes',
        });

        expect(result.fromPersisted).toBe(false);
        expect(result.dossier.requiredStances).toEqual([GATE_CORRESPONDENCE_STANCE.stance, 'test-validity']);
        expect(discardedDispositions(result.dossier)).toEqual([
            {
                findingId: 'discarded-free-form',
                stance: GATE_CORRESPONDENCE_STANCE.stance,
                reason: 'not reproducible on this head',
            },
        ]);
        const persisted = parseReviewDossier(JSON.parse(result.canonical));
        expect(persisted.requiredStances).toEqual([GATE_CORRESPONDENCE_STANCE.stance, 'test-validity']);
    });

    it('assembles several draws on one stance and round-trips through the persisted record', () => {
        const secondCorrectnessDraw: ReviewDossierStanceInput = {
            stance: 'correctness',
            reviewerModel: 'model-correctness-second',
            modelTier: 'strongest',
            outcome: 'clean',
        };
        const result = buildReviewDossier({
            plan: PLAN,
            raw: { ...INPUT, stances: [CORRECTNESS_STANCE, secondCorrectnessDraw, TEST_VALIDITY_STANCE] },
            discarded: [],
            comments: [],
            recommendation: 'approve',
        });

        expect(result.fromPersisted).toBe(false);
        const persisted = parseReviewDossier(JSON.parse(result.canonical));
        expect(persisted.requiredStances).toEqual(['correctness', 'test-validity']);
        expect(completedStances(persisted)).toEqual([CORRECTNESS_STANCE, secondCorrectnessDraw, TEST_VALIDITY_STANCE]);

        const replay = buildReviewDossier({
            plan: PLAN,
            raw: JSON.parse(result.canonical),
            discarded: [],
            comments: [],
            recommendation: 'approve',
        });
        expect(replay.fromPersisted).toBe(true);
        expect(replay.canonical).toBe(result.canonical);
    });

    it('does not trip the stances.json correspondence gate on a second draw of one stance', () => {
        const secondCorrectnessDraw: ReviewDossierStanceInput = {
            ...CORRECTNESS_STANCE,
            reviewerModel: 'model-correctness-second',
        };
        const result = buildReviewDossier({
            plan: PLAN,
            raw: { ...INPUT, stances: [CORRECTNESS_STANCE, secondCorrectnessDraw, TEST_VALIDITY_STANCE] },
            recordedStances: ['correctness', 'test-validity'],
            discarded: [],
            comments: [],
            recommendation: 'approve',
        });

        expect(result.fromPersisted).toBe(false);
        expect(completedStances(result.dossier).map((entry) => entry.stance)).toEqual([
            'correctness',
            'correctness',
            'test-validity',
        ]);
    });

    it('carries a draw exhaustion into the record and verifies it on reparse', () => {
        const exhaustedDraw: ReviewDossierStanceInput = {
            ...TEST_VALIDITY_STANCE,
            exhaustion: 'every other harness on this machine was committed to another lane',
        };
        const result = buildReviewDossier({
            plan: PLAN,
            raw: { ...INPUT, stances: [CORRECTNESS_STANCE, exhaustedDraw] },
            discarded: [],
            comments: [],
            recommendation: 'approve',
        });

        expect(result.fromPersisted).toBe(false);
        const persisted = parseReviewDossier(JSON.parse(result.canonical));
        expect(completedStances(persisted).at(-1)).toEqual(exhaustedDraw);
        expect(serializeReviewDossier(persisted)).toBe(result.canonical);
    });

    it('carries exhaustion only on the input draws that declare it', () => {
        const parsed = parseReviewDossierInput({
            ...INPUT,
            stances: [
                { ...CORRECTNESS_STANCE, exhaustion: 'every other harness was logged out' },
                TEST_VALIDITY_STANCE,
            ],
        });

        expect(parsed.stances[0]?.exhaustion).toBe('every other harness was logged out');
        expect(parsed.stances[1]?.exhaustion).toBeUndefined();
    });

    it('publishes a dossier whose recorded stances differ from the plan menu, answering to the record', () => {
        const result = buildReviewDossier({
            plan: PLAN,
            raw: { ...INPUT, stances: [CORRECTNESS_STANCE, SECURITY_PLATFORM_STANCE] },
            recordedStances: ['correctness', 'security-platform'],
            discarded: [],
            comments: [],
            recommendation: 'approve',
        });

        expect(result.fromPersisted).toBe(false);
        expect(completedStances(result.dossier).map((entry) => entry.stance)).toEqual([
            'correctness',
            'security-platform',
        ]);
        expect(result.dossier.requiredStances).not.toEqual(PLAN.requiredStances);
    });

    it('accepts a dispatched stance the plan menu does not list when the bundle carries no stances.json', () => {
        const result = buildReviewDossier({
            plan: PLAN,
            raw: { ...INPUT, stances: [CORRECTNESS_STANCE, TEST_VALIDITY_STANCE, CODE_CRAFT_STANCE] },
            discarded: [],
            comments: [],
            recommendation: 'approve',
        });

        expect(result.fromPersisted).toBe(false);
        expect(result.dossier.requiredStances).toEqual(['code-craft', 'correctness', 'test-validity']);
    });

    it.each(BUILD_REFUSALS)('refuses $label', ({ run, message }) => {
        expect(run).toThrow(message);
    });
});

describe('delivery authorization binding (#3376, spec #3367 AC-005)', () => {
    const REVIEW_ID = 770;

    function publishedDossier(): ReviewDossier {
        const base = assembleReviewDossier({
            plan: PLAN,
            events: COMPLETED_STANCES,
            discarded: [],
            evidence: EVIDENCE,
            limitations: [LIMITATION],
            recommendation: 'approve',
            assessmentImpact: 'none',
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
            discarded: [],
            evidence: EVIDENCE,
            limitations: [LIMITATION],
            recommendation: 'approve',
            assessmentImpact: 'none',
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
