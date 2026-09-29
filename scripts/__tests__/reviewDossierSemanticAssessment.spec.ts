import { describe, expect, it } from 'vitest';

import { SIGNAL_DISPOSITIONS, assembleReviewDossier } from '../reviewDossier.ts';
import {
    assertSemanticAssessmentAcknowledged,
    firedSignalCitationToken,
    parseSemanticAssessmentCoverage,
} from '../reviewDossierSemanticAssessment.ts';
import { SEMANTIC_CI_FORMAT, UNRECOGNIZED_SIGNAL_VALUE } from '../semanticReviewContext.ts';

import type {
    AssessmentImpact,
    ReviewDossier,
    ReviewDossierEvent,
    ReviewDossierSignalDisposition,
} from '../reviewDossier.ts';
import type { ReviewRiskPlan } from '../reviewRiskPolicy.ts';

const PLAN: ReviewRiskPlan = {
    format: 'risk-plan-v1',
    pr: 42,
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    riskClasses: ['small'],
    requiredStances: ['correctness'],
    triggers: ['small:handwritten-lines<=200'],
};

const EXPECTED = { pr: PLAN.pr, headSha: PLAN.headSha };

const STANCE: ReviewDossierEvent = {
    kind: 'stance-completed',
    stance: 'correctness',
    reviewerModel: 'model-correctness',
    modelTier: 'standard',
    outcome: 'clean',
};

/** Satisfies `finding-led`'s own construction-time requirement for at least one accepted finding. */
const FINDING_ACCEPTED: ReviewDossierEvent = {
    kind: 'finding-accepted',
    findingId: 'finding-1',
    path: 'scripts/reviewDossierSemanticAssessment.ts',
    line: 1,
    side: 'RIGHT',
};

/** The repository's own measured standing escape: the conditional-admission rule firing on a spec. */
const FIRED_SIGNAL = {
    ruleId: 'admission_branch_completes_without_asserting',
    path: 'src/modules/audio/take.test.ts',
    probability: 0.82,
};

const FIRED_TOKEN = firedSignalCitationToken(FIRED_SIGNAL);

function dossierWith(
    impact: AssessmentImpact,
    options: {
        reason?: string;
        limitations?: string[];
        events?: ReviewDossierEvent[];
        discarded?: { finding: string; stance: string; reason: string }[];
        dispositions?: ReviewDossierSignalDisposition[];
    } = {}
): ReviewDossier {
    return assembleReviewDossier({
        plan: PLAN,
        events: options.events ?? [STANCE],
        discarded: options.discarded ?? [],
        evidence: [],
        limitations: options.limitations ?? [],
        recommendation: 'approve',
        assessmentImpact: impact,
        assessmentIgnoredReason: options.reason,
        signalDispositions: options.dispositions,
    });
}

/** A delivered assessment whose scope withheld two entries and left two questions unresolved. */
const DELIVERED_WITHHELD = {
    format: SEMANTIC_CI_FORMAT,
    pr: 42,
    headSha: 'a'.repeat(40),
    state: 'assessed',
    assessedHeadSha: 'a'.repeat(40),
    execution: 'partial',
    scope: {
        discovered: 5,
        eligible: 4,
        assessed: 3,
        excluded: [{ path: 'scripts/a.ts', reason: 'binary' }],
        unassessed: [{ path: 'scripts/b.ts', reason: 'evidence-withheld' }],
        truncated: [],
    },
    unresolvedQuestions: 2,
    artifact: { id: 1, name: 'semantic-review-42-1', expiresAt: '2030-01-01T00:00:00Z', digest: 'f'.repeat(64) },
};

const DELIVERED_COMPLETE = {
    ...DELIVERED_WITHHELD,
    scope: { discovered: 3, eligible: 3, assessed: 3, excluded: [], unassessed: [], truncated: [] },
    unresolvedQuestions: 0,
};

const NO_ASSESSMENT = {
    format: SEMANTIC_CI_FORMAT,
    pr: 42,
    headSha: 'a'.repeat(40),
    state: 'no-assessment',
    reason: 'absent',
};

describe('parseSemanticAssessmentCoverage', () => {
    it('projects a delivered assessment to its binding identity, withheld counts and citation tokens', () => {
        expect(parseSemanticAssessmentCoverage(DELIVERED_WITHHELD)).toEqual({
            state: 'assessed',
            pr: 42,
            headSha: 'a'.repeat(40),
            withheld: 2,
            unresolved: 2,
            artifactName: 'semantic-review-42-1',
            withheldPaths: ['scripts/a.ts', 'scripts/b.ts'],
            firedSignals: [],
        });
    });

    it('projects a complete delivered assessment to zero withheld and unresolved', () => {
        expect(parseSemanticAssessmentCoverage(DELIVERED_COMPLETE)).toEqual({
            state: 'assessed',
            pr: 42,
            headSha: 'a'.repeat(40),
            withheld: 0,
            unresolved: 0,
            artifactName: 'semantic-review-42-1',
            withheldPaths: [],
            firedSignals: [],
        });
    });

    it('projects the fired signals a record carries, with their rule, path and probability', () => {
        const record = { ...DELIVERED_WITHHELD, firedSignals: [FIRED_SIGNAL] };
        expect(parseSemanticAssessmentCoverage(record)).toMatchObject({ firedSignals: [FIRED_SIGNAL] });
    });

    it('parses a record written before fired signals were projected as zero of them', () => {
        // DELIVERED_WITHHELD is the pre-field shape: no firedSignals key at all.
        expect('firedSignals' in DELIVERED_WITHHELD).toBe(false);
        expect(parseSemanticAssessmentCoverage(DELIVERED_WITHHELD)).toMatchObject({ firedSignals: [] });
    });

    it.each([
        ['a non-array', 'none'],
        ['a non-object entry', [{ ruleId: 'r', path: 'p', probability: 0.9 }, 'broken']],
        ['an entry with no ruleId', [{ path: 'src/a.ts', probability: 0.9 }]],
        ['an entry with a blank path', [{ ruleId: 'r', path: '  ', probability: 0.9 }]],
        ['an entry with a non-number probability', [{ ruleId: 'r', path: 'src/a.ts', probability: 'high' }]],
        ['an entry with an out-of-range probability', [{ ruleId: 'r', path: 'src/a.ts', probability: 1.5 }]],
    ])('refuses %s', (_label, firedSignals: unknown) => {
        expect(() => parseSemanticAssessmentCoverage({ ...DELIVERED_WITHHELD, firedSignals })).toThrow(
            /semantic-ci record firedSignals/u
        );
    });

    it('projects a no-assessment record to not delivered, carrying its reason', () => {
        expect(parseSemanticAssessmentCoverage(NO_ASSESSMENT)).toEqual({
            state: 'no-assessment',
            pr: 42,
            headSha: 'a'.repeat(40),
            reason: 'absent',
        });
    });

    it('refuses a record whose state is neither assessed nor no-assessment', () => {
        expect(() => parseSemanticAssessmentCoverage({ ...DELIVERED_WITHHELD, state: 'partial' })).toThrow(
            /semantic-ci record state must be assessed or no-assessment, found "partial"/
        );
    });

    it('refuses a delivered record whose scope is not an object', () => {
        expect(() => parseSemanticAssessmentCoverage({ ...DELIVERED_WITHHELD, scope: 'none' })).toThrow(
            /semantic-ci record scope must be an object/
        );
    });

    it('refuses a record with a foreign format', () => {
        expect(() => parseSemanticAssessmentCoverage({ ...DELIVERED_WITHHELD, format: 'semantic-ci-v2' })).toThrow(
            /semantic-ci record format must be semantic-ci-v1, found "semantic-ci-v2"/
        );
    });
});

describe('assertSemanticAssessmentAcknowledged', () => {
    it('refuses a delivered assessment with withheld entries when the impact is none and no reason', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none'),
                parseSemanticAssessmentCoverage(DELIVERED_WITHHELD),
                EXPECTED
            )
        ).toThrow(
            /review dossier assessmentImpact none with no assessmentIgnoredReason ignores the delivered semantic assessment, which withheld 2 scope entries and left 2 questions unresolved/
        );
    });

    it('accepts the same dossier with an assessmentIgnoredReason', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', { reason: 'the withheld audio module is outside this change’s blast radius' }),
                parseSemanticAssessmentCoverage(DELIVERED_WITHHELD),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('accepts a limitation naming the assessment’s artifact identity', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: ['the assessment run semantic-review-42-1 withheld the audio module'],
                }),
                parseSemanticAssessmentCoverage(DELIVERED_WITHHELD),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('accepts a limitation naming a path the assessment withheld', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', { limitations: ['the assessment withheld scripts/b.ts'] }),
                parseSemanticAssessmentCoverage(DELIVERED_WITHHELD),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('refuses an unrelated limitation that never names the assessment', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: ['the native audio path is not exercised on this head'],
                }),
                parseSemanticAssessmentCoverage(DELIVERED_WITHHELD),
                EXPECTED
            )
        ).toThrow(
            /review dossier assessmentImpact limitation-only does not cite the delivered semantic assessment, which withheld 2 scope entries and left 2 questions unresolved: name its artifact or a withheld path in a limitation/
        );
    });

    it('refuses a coverage record bound to another publication', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none'),
                parseSemanticAssessmentCoverage({ ...DELIVERED_WITHHELD, pr: 99, headSha: 'f'.repeat(40) }),
                EXPECTED
            )
        ).toThrow(/semantic-ci record pr 99 headSha f{40} does not match the publication pr 42 headSha a{40}/);
    });

    it('passes a bundle with no semantic-ci record', () => {
        expect(() => assertSemanticAssessmentAcknowledged(dossierWith('none'), undefined, EXPECTED)).not.toThrow();
    });

    it('passes a delivered assessment that withheld nothing and left nothing unresolved', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none'),
                parseSemanticAssessmentCoverage(DELIVERED_COMPLETE),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('refuses a no-assessment record when the impact is none, even with a citing limitation', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', { limitations: ['semantic-ci absent: CI delivered no assessment for this head'] }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).toThrow(/assessmentImpact none/);
    });

    it('refuses a no-assessment record when the impact is none plus an assessmentIgnoredReason', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', { reason: 'ci ran red on this head' }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).toThrow(/assessmentImpact none/);
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', { reason: 'ci ran red on this head' }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).toThrow(/no semantic assessment/);
    });

    it('refuses a limitation-only round whose limitation never cites the no-assessment record', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: ['the native audio path is not exercised on this head'],
                }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).toThrow(/semantic-ci absent/);
    });

    it('refuses a stance-changed round whose limitation never cites the no-assessment record', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('stance-changed', {
                    limitations: ['draw r1s2 fell back to the authoring model'],
                }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).toThrow(/semantic-ci absent/);
    });

    it('refuses a limitation-only round whose limitation cites the wrong reason for the no-assessment record', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: ['semantic-ci red-check: CI delivered no assessment for this head'],
                }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).toThrow(/semantic-ci absent/);
    });

    it('passes a no-assessment record when the impact is limitation-only with a citing limitation', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: ['semantic-ci absent: CI delivered no assessment for this head'],
                }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('refuses a no-assessment record with no limitations though the impact is finding-led', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('finding-led', { events: [STANCE, FINDING_ACCEPTED] }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).toThrow(/semantic-ci absent/);
    });

    it('refuses a no-assessment record bound to another publication before the impact is checked', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none'),
                parseSemanticAssessmentCoverage({ ...NO_ASSESSMENT, pr: 99, headSha: 'f'.repeat(40) }),
                EXPECTED
            )
        ).toThrow(/semantic-ci record pr 99 headSha f{40} does not match the publication pr 42 headSha a{40}/);
    });
});

describe('fired-signal disposal at publication', () => {
    function coverageWithFired(
        overrides: Record<string, unknown> = {}
    ): ReturnType<typeof parseSemanticAssessmentCoverage> {
        return parseSemanticAssessmentCoverage({ ...DELIVERED_WITHHELD, firedSignals: [FIRED_SIGNAL], ...overrides });
    }

    it('refuses an undisposed fired signal even with an assessmentIgnoredReason, naming rule and path', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', { reason: 'the assessment surfaced nothing actionable' }),
                coverageWithFired(),
                EXPECTED
            )
        ).toThrow(
            /does not dispose of 1 of the delivered assessment's 1 fired signal\(s\) \(admission_branch_completes_without_asserting at src\/modules\/audio\/take\.test\.ts\): name each as semantic-signal <ruleId> <path> in a stance admittedBy, a discarded finding, or a limitation/u
        );
    });

    it('refuses an undisposed fired signal even when a limitation cites the assessment itself', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: ['the assessment run semantic-review-42-1 withheld the audio module'],
                }),
                coverageWithFired(),
                EXPECTED
            )
        ).toThrow(/does not dispose of 1 of the delivered assessment's 1 fired signal/u);
    });

    it('accepts a limitation naming the fired signal token', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: [
                        `the assessment run semantic-review-42-1 fired ${FIRED_TOKEN}; the branch asserts downstream in the shared harness`,
                    ],
                }),
                coverageWithFired(),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('accepts a discarded finding naming the fired signal token', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', {
                    reason: 'the fired rule is disposed of in a discarded finding',
                    discarded: [
                        {
                            finding: `${FIRED_TOKEN} — the admission is the deliberate #4441 escape, pinned by its own spec`,
                            stance: 'correctness',
                            reason: 'the conditional admission is deliberate and tested',
                        },
                    ],
                }),
                coverageWithFired(),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('accepts a stance admittedBy line naming the fired signal token', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', { reason: 'the fired rule is the stance this round attacked by name' }),
                coverageWithFired(),
                EXPECTED,
                [`a reordered take insert drops a buffered frame, so the stance probed ${FIRED_TOKEN} first`]
            )
        ).not.toThrow();
    });

    it('refuses a fired signal while a stance admission names only some other token', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', { reason: 'the admission lines name other risks' }),
                coverageWithFired(),
                EXPECTED,
                ['a reordered send queue drops a buffered frame']
            )
        ).toThrow(/does not dispose of 1 of the delivered assessment's 1 fired signal/u);
    });

    it('refuses an undisposed fired signal even when nothing was withheld and nothing was unresolved', () => {
        const completeButFiring = {
            ...DELIVERED_COMPLETE,
            firedSignals: [FIRED_SIGNAL],
        };
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', { reason: 'nothing was withheld' }),
                parseSemanticAssessmentCoverage(completeButFiring),
                EXPECTED
            )
        ).toThrow(/does not dispose of 1 of the delivered assessment's 1 fired signal/u);
    });

    it('refuses only the undisposed signals when several fired and one was named', () => {
        const second = {
            ruleId: 'conditional_admission_added',
            path: 'src/components/transport/Bar.test.ts',
            probability: 0.71,
        };
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: [`the assessment fired ${FIRED_TOKEN}; covered by the shared harness`],
                }),
                parseSemanticAssessmentCoverage({ ...DELIVERED_WITHHELD, firedSignals: [FIRED_SIGNAL, second] }),
                EXPECTED
            )
        ).toThrow(
            /does not dispose of 1 of the delivered assessment's 2 fired signal\(s\) \(conditional_admission_added at src\/components\/transport\/Bar\.test\.ts\)/u
        );
    });

    it('refuses an undisposed marker-valued fired signal, naming the marker the record carries', () => {
        // A fired signal whose projected value the publication screen refused is carried redacted;
        // the disposal duty travels with the marker exactly as with a verbatim value.
        const markerSignal = { ...FIRED_SIGNAL, path: UNRECOGNIZED_SIGNAL_VALUE };
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', { reason: 'the assessment surfaced nothing actionable' }),
                parseSemanticAssessmentCoverage({ ...DELIVERED_WITHHELD, firedSignals: [markerSignal] }),
                EXPECTED
            )
        ).toThrow(
            `does not dispose of 1 of the delivered assessment's 1 fired signal(s) (${markerSignal.ruleId} at ${UNRECOGNIZED_SIGNAL_VALUE})`
        );
    });

    it('accepts a limitation naming a marker-valued fired signal by the token its record carries', () => {
        const markerSignal = { ...FIRED_SIGNAL, path: UNRECOGNIZED_SIGNAL_VALUE };
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: [
                        `the assessment run semantic-review-42-1 fired semantic-signal ${markerSignal.ruleId} ${UNRECOGNIZED_SIGNAL_VALUE}; the flagged path was screened out of the record`,
                    ],
                }),
                parseSemanticAssessmentCoverage({ ...DELIVERED_WITHHELD, firedSignals: [markerSignal] }),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('passes a delivered record whose fired signals were all disposed', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: [
                        `the assessment run semantic-review-42-1 fired ${FIRED_TOKEN}: the deliberate #4441 escape`,
                    ],
                }),
                coverageWithFired(),
                EXPECTED
            )
        ).not.toThrow();
    });
});

describe('typed signal dispositions at publication', () => {
    function coverageWithFired(
        overrides: Record<string, unknown> = {}
    ): ReturnType<typeof parseSemanticAssessmentCoverage> {
        return parseSemanticAssessmentCoverage({ ...DELIVERED_WITHHELD, firedSignals: [FIRED_SIGNAL], ...overrides });
    }

    /** The fired signal's own pair with a caller-chosen disposition, so the entry matches it exactly. */
    function disposition(overrides: Partial<ReviewDossierSignalDisposition> = {}): ReviewDossierSignalDisposition {
        return {
            ruleId: FIRED_SIGNAL.ruleId,
            path: FIRED_SIGNAL.path,
            disposition: 'false-positive',
            ...overrides,
        };
    }

    const IGNORED = { reason: 'the fired rule is disposed of by a typed outcome entry' };

    it.each(SIGNAL_DISPOSITIONS)(
        'disposes of the fired signal with a %s entry, with no literal token anywhere',
        (token) => {
            const dossier = dossierWith('none', { ...IGNORED, dispositions: [disposition({ disposition: token })] });

            // The typed entry is the only disposal: no stance admission, discarded finding, or
            // limitation carries the citation token, and the dismissal tokens dispose exactly as the
            // confirming ones do.
            expect(() => assertSemanticAssessmentAcknowledged(dossier, coverageWithFired(), EXPECTED)).not.toThrow();
        }
    );

    it('accepts an entry carrying the bounded artifact reference', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', {
                    ...IGNORED,
                    dispositions: [disposition({ disposition: 'confirmed-and-fixed', artifact: '#4441' })],
                }),
                coverageWithFired(),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('refuses an entry naming a signal the delivered assessment did not fire, listing its rule and path', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', {
                    ...IGNORED,
                    dispositions: [disposition({ ruleId: 'conditional_admission_added' })],
                }),
                coverageWithFired(),
                EXPECTED
            )
        ).toThrow(
            /review dossier signalDispositions names 1 signal\(s\) the delivered assessment did not fire \(conditional_admission_added at src\/modules\/audio\/take\.test\.ts\): record an outcome only for a signal the delivered record carries/u
        );
    });

    it('refuses an entry naming a path the delivered assessment did not fire', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', { ...IGNORED, dispositions: [disposition({ path: 'src/other.test.ts' })] }),
                coverageWithFired(),
                EXPECTED
            )
        ).toThrow(/signalDispositions names 1 signal\(s\) the delivered assessment did not fire/u);
    });

    it('refuses a typed entry when the delivered record fired nothing at all', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', { ...IGNORED, dispositions: [disposition()] }),
                parseSemanticAssessmentCoverage(DELIVERED_WITHHELD),
                EXPECTED
            )
        ).toThrow(/signalDispositions names 1 signal\(s\) the delivered assessment did not fire/u);
    });

    it('accepts an empty typed list beside a delivered record that fired nothing', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', { ...IGNORED, dispositions: [] }),
                parseSemanticAssessmentCoverage(DELIVERED_WITHHELD),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('refuses a typed outcome when the assessment delivered nothing, naming the field and reason', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: ['semantic-ci absent: CI delivered no assessment for this head'],
                    dispositions: [disposition()],
                }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).toThrow(
            /review dossier signalDispositions records 1 outcome\(s\) but no semantic assessment was delivered for this head \(semantic-ci absent\): the field must be empty or absent/u
        );
    });

    it('accepts an empty typed list and an absent one beside a no-assessment record', () => {
        const cited = { limitations: ['semantic-ci absent: CI delivered no assessment for this head'] };

        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', { ...cited, dispositions: [] }),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).not.toThrow();
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', cited),
                parseSemanticAssessmentCoverage(NO_ASSESSMENT),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('leaves a bundle with no semantic-ci record free of any typed-outcome requirement', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', { dispositions: [disposition()] }),
                undefined,
                EXPECTED
            )
        ).not.toThrow();
    });
});

/**
 * The two ways a space-joined citation token loses the identity its fields carry: a longer path whose
 * token contains a shorter one, and two different pairs that join to the identical token. Both
 * disposal paths must match on the identity, never on the text, so neither can dispose, or accept an
 * entry for, a signal the round never named.
 */
describe('signal identity at publication', () => {
    const SHORTER = { ruleId: 'admission_branch_completes_without_asserting', path: 'src/modules/audio/take.ts' };
    const LONGER = { ...SHORTER, path: `${SHORTER.path}/extra` };

    function coverageWith(
        signals: { ruleId: string; path: string }[]
    ): ReturnType<typeof parseSemanticAssessmentCoverage> {
        return parseSemanticAssessmentCoverage({
            ...DELIVERED_WITHHELD,
            firedSignals: signals.map((signal) => ({ ...signal, probability: 0.8 })),
        });
    }

    function entry(
        signal: { ruleId: string; path: string },
        disposition: ReviewDossierSignalDisposition['disposition'] = 'false-positive'
    ): ReviewDossierSignalDisposition {
        return { ...signal, disposition };
    }

    it('disposes only the signal whose path it names exactly when a shorter path also fired', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', {
                    reason: 'the longer path carries a typed outcome',
                    dispositions: [entry(LONGER)],
                }),
                coverageWith([SHORTER, LONGER]),
                EXPECTED
            )
        ).toThrow(
            /does not dispose of 1 of the delivered assessment's 2 fired signal\(s\) \(admission_branch_completes_without_asserting at src\/modules\/audio\/take\.ts\)/u
        );
    });

    it('disposes only the shorter signal when the entry names it exactly', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', {
                    reason: 'the shorter path carries a typed outcome',
                    dispositions: [entry(SHORTER, 'confirmed-and-fixed')],
                }),
                coverageWith([SHORTER, LONGER]),
                EXPECTED
            )
        ).toThrow(
            /does not dispose of 1 of the delivered assessment's 2 fired signal\(s\) \(admission_branch_completes_without_asserting at src\/modules\/audio\/take\.ts\/extra\)/u
        );
    });

    it('passes when both prefix-path signals carry their own typed outcome', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', {
                    reason: 'both prefix-path signals carry typed outcomes',
                    dispositions: [entry(SHORTER, 'confirmed-and-fixed'), entry(LONGER)],
                }),
                coverageWith([SHORTER, LONGER]),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('refuses a free-text citation that is only the prefix of a longer path’s citation', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: [`the assessment run semantic-review-42-1 fired ${firedSignalCitationToken(LONGER)}`],
                }),
                coverageWith([SHORTER, LONGER]),
                EXPECTED
            )
        ).toThrow(
            /does not dispose of 1 of the delivered assessment's 2 fired signal\(s\) \(admission_branch_completes_without_asserting at src\/modules\/audio\/take\.ts\)/u
        );
    });

    it('disposes a shorter path from a whole citation that ends the text or the clause', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('limitation-only', {
                    limitations: [`the assessment run semantic-review-42-1 fired ${firedSignalCitationToken(SHORTER)}`],
                }),
                coverageWith([SHORTER, LONGER]),
                EXPECTED
            )
        ).toThrow(
            /does not dispose of 1 of the delivered assessment's 2 fired signal\(s\) \(admission_branch_completes_without_asserting at src\/modules\/audio\/take\.ts\/extra\)/u
        );
    });

    it('refuses an entry for a pair the record did not fire when two pairs join to one citation token', () => {
        const firedPair = { ruleId: 'rule one', path: 'src/a.ts' };
        const collidingPair = { ruleId: 'rule', path: 'one src/a.ts' };
        // The collision is real: both pairs produce the identical space-joined citation token.
        expect(firedSignalCitationToken(firedPair)).toBe(firedSignalCitationToken(collidingPair));

        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', {
                    reason: 'the entry names the colliding pair',
                    dispositions: [entry(collidingPair)],
                }),
                coverageWith([firedPair]),
                EXPECTED
            )
        ).toThrow(
            /review dossier signalDispositions names 1 signal\(s\) the delivered assessment did not fire \(rule at one src\/a\.ts\): record an outcome only for a signal the delivered record carries/u
        );
    });

    it('disposes the fired pair of a token collision from its own identity', () => {
        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', {
                    reason: 'the entry names the fired pair',
                    dispositions: [entry({ ruleId: 'rule one', path: 'src/a.ts' })],
                }),
                coverageWith([{ ruleId: 'rule one', path: 'src/a.ts' }]),
                EXPECTED
            )
        ).not.toThrow();
    });

    it('disposes only its own pair when two fired pairs join to one citation token', () => {
        const collidingPair = { ruleId: 'rule', path: 'one src/a.ts' };

        expect(() =>
            assertSemanticAssessmentAcknowledged(
                dossierWith('none', {
                    reason: 'the entry names one of the two colliding fired pairs',
                    dispositions: [entry({ ruleId: 'rule one', path: 'src/a.ts' })],
                }),
                coverageWith([{ ruleId: 'rule one', path: 'src/a.ts' }, collidingPair]),
                EXPECTED
            )
        ).toThrow(
            /does not dispose of 1 of the delivered assessment's 2 fired signal\(s\) \(rule at one src\/a\.ts\): name each as semantic-signal <ruleId> <path>/u
        );
    });
});
