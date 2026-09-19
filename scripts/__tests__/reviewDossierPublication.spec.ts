import { describe, expect, it } from 'vitest';

import {
    acceptedFindings,
    assembleReviewDossier,
    completedStances,
    discardedDispositions,
    parseReviewDossier,
    serializeReviewDossier,
} from '../reviewDossier.ts';
import {
    REVIEW_DOSSIER_INPUT_FORMAT,
    buildReviewDossier,
    parseReviewDossierInput,
} from '../reviewDossierPublication.ts';

import type { ReviewDossier, ReviewDossierEvent } from '../reviewDossier.ts';
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
};

/** A canonical, already-persisted record of the shape the publisher could find on disk. */
function persistedRecord(options: {
    plan?: ReviewRiskPlan;
    events?: readonly ReviewDossierEvent[];
    discarded?: unknown;
    recommendation?: 'approve' | 'request-changes';
}): unknown {
    const dossier: ReviewDossier = assembleReviewDossier({
        plan: options.plan ?? PLAN,
        events: options.events ?? COMPLETED_STANCES,
        discarded: options.discarded ?? [],
        evidence: EVIDENCE,
        limitations: [LIMITATION],
        recommendation: options.recommendation ?? 'request-changes',
    });
    return JSON.parse(serializeReviewDossier(dossier));
}

type InputRefusalCase = { label: string; value: unknown; message: RegExp };

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
        label: 'an unknown stance literal',
        value: { ...INPUT, stances: [{ ...CORRECTNESS_STANCE, stance: 'vibes' }] },
        message: /input stances\[0\]\.stance must be a known review stance/,
    },
    {
        label: 'a missing stance field',
        value: { ...INPUT, stances: [{ stance: 'correctness', reviewerModel: 'm', modelTier: 'standard' }] },
        message: /input stances\[0\]\.outcome must be blocker-found or clean/,
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
        message: /input stances\[1\]\.stance duplicates stances\[0\]\.stance: correctness/,
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
];

type BuildRefusalCase = { label: string; run: () => unknown; message: RegExp };

const BUILD_REFUSALS: readonly BuildRefusalCase[] = [
    {
        label: 'a missing required stance',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: { ...INPUT, stances: [CORRECTNESS_STANCE] },
                discarded: [],
                comments: [],
                recommendation: 'approve',
            }),
        message: /review dossier has no completed record for required stance: test-validity/,
    },
    {
        label: 'an extra, unearned stance',
        run: () =>
            buildReviewDossier({
                plan: PLAN,
                raw: { ...INPUT, stances: [CORRECTNESS_STANCE, TEST_VALIDITY_STANCE, CODE_CRAFT_STANCE] },
                discarded: [],
                comments: [],
                recommendation: 'approve',
            }),
        message: /review dossier completes a stance the plan did not require: code-craft/,
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
        message: /input stances\[1\]\.stance duplicates stances\[0\]\.stance/,
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
];

describe('parseReviewDossierInput', () => {
    it('accepts the caller-authored input form', () => {
        expect(parseReviewDossierInput(INPUT)).toEqual(INPUT);
    });

    it.each(INPUT_REFUSALS)('refuses $label', ({ value, message }) => {
        expect(() => parseReviewDossierInput(value)).toThrow(message);
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

    it.each(BUILD_REFUSALS)('refuses $label', ({ run, message }) => {
        expect(run).toThrow(message);
    });
});
