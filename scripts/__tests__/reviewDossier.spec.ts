import { describe, expect, it } from 'vitest';

import { REVIEW_EVIDENCE_FIELD_MAX_BYTES, assertPublicationSafeEvidence } from '../evidenceSafety.ts';
import {
    GENESIS_DIGEST,
    REVIEW_DOSSIER_FORMAT,
    REVIEW_DOSSIER_MAX_BYTES,
    appendReviewDossierEvents,
    assembleReviewDossier,
    parseReviewDossier,
    reviewDossierEventDigest,
    serializeReviewDossier,
} from '../reviewDossier.ts';
import { ASSESSMENT_IMPACTS, buildDossier } from '../reviewDossierChain.ts';
import {
    acceptedFindings,
    assessmentImpact,
    completedStances,
    discardedDispositions,
    publishedFindings,
    publishedReviewId,
} from '../reviewDossierViews.ts';

import type {
    AssessmentImpact,
    ReviewDossier,
    ReviewDossierEvent,
    ReviewDossierEventRecord,
} from '../reviewDossier.ts';
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

const EVIDENCE_ENTRY = {
    observable: 'the spec fails when the digest check is reverted',
    verification: 'pnpm test:run scripts/__tests__/reviewDossier.spec.ts',
    observed: 'one failing assertion on the digest rule',
};

const LIMITATION = 'the native audio path is not exercised on this head';

const BASE_EVENTS: readonly ReviewDossierEvent[] = [
    {
        kind: 'stance-completed',
        stance: 'correctness',
        reviewerModel: 'model-correctness',
        modelTier: 'strongest',
        outcome: 'blocker-found',
    },
    { kind: 'finding-accepted', findingId: 'finding-1', path: 'scripts/reviewDossier.ts', line: 42, side: 'RIGHT' },
    { kind: 'finding-discarded', findingId: 'finding-2', stance: 'correctness', reason: 'stale diff context' },
    {
        kind: 'stance-completed',
        stance: 'test-validity',
        reviewerModel: 'model-test-validity',
        modelTier: 'standard',
        outcome: 'clean',
    },
];

const SECOND_CORRECTNESS_STANCE: ReviewDossierEvent = {
    kind: 'stance-completed',
    stance: 'correctness',
    reviewerModel: 'model-correctness-second',
    modelTier: 'economy',
    outcome: 'clean',
};

const EXTRA_DISPATCHED_STANCE: ReviewDossierEvent = {
    kind: 'stance-completed',
    stance: 'code-craft',
    reviewerModel: 'model-craft',
    modelTier: 'economy',
    outcome: 'clean',
};

type AssembleInput = Parameters<typeof assembleReviewDossier>[0];

function assembleWith(overrides: Partial<AssembleInput>): ReviewDossier {
    return assembleReviewDossier({
        plan: PLAN,
        events: BASE_EVENTS,
        discarded: [],
        evidence: [EVIDENCE_ENTRY],
        limitations: [LIMITATION],
        recommendation: 'request-changes',
        assessmentImpact: 'none',
        ...overrides,
    });
}

function validDossier(): ReviewDossier {
    return assembleWith({});
}

function cloneDossier(): ReviewDossier {
    return structuredClone(validDossier());
}

function recordAt(dossier: ReviewDossier, index: number): ReviewDossierEventRecord {
    const record = dossier.events[index];
    if (record === undefined) {
        throw new Error(`no event record at index ${index}`);
    }
    return record;
}

function oversizedEvidence(): { observable: string; verification: string; observed: string }[] {
    return Array.from({ length: 30 }, (_unused, index) => ({
        observable: 'x'.repeat(1_900),
        verification: 'y'.repeat(1_900),
        observed: `entry-${index}`,
    }));
}

describe('review dossier chain', () => {
    it('should start a contiguous zero-based chain at GENESIS_DIGEST', () => {
        const dossier = validDossier();

        expect(dossier.events.map((record) => record.sequence)).toEqual([0, 1, 2, 3]);
        expect(recordAt(dossier, 0).previousDigest).toBe(GENESIS_DIGEST);
        expect(recordAt(dossier, 1).previousDigest).toBe(recordAt(dossier, 0).digest);
        expect(GENESIS_DIGEST).toBe('0'.repeat(64));
    });

    it('should bind headDigest to the last record digest', () => {
        const dossier = validDossier();

        expect(dossier.headDigest).toBe(recordAt(dossier, dossier.events.length - 1).digest);
        expect(dossier.headDigest).not.toBe(GENESIS_DIGEST);
    });

    it('should cover the payload, sequence and predecessor in the event digest', () => {
        const event: ReviewDossierEvent = {
            kind: 'stance-completed',
            stance: 'correctness',
            reviewerModel: 'model-a',
            modelTier: 'standard',
            outcome: 'clean',
        };
        const baseline = reviewDossierEventDigest({ ...event, sequence: 0, previousDigest: GENESIS_DIGEST });

        expect(baseline).toMatch(/^[0-9a-f]{64}$/u);
        expect(reviewDossierEventDigest({ ...event, sequence: 1, previousDigest: GENESIS_DIGEST })).not.toBe(baseline);
        expect(reviewDossierEventDigest({ ...event, sequence: 0, previousDigest: 'f'.repeat(64) })).not.toBe(baseline);
        const rewrittenPayload = reviewDossierEventDigest({
            ...event,
            reviewerModel: 'model-b',
            sequence: 0,
            previousDigest: GENESIS_DIGEST,
        });
        expect(rewrittenPayload).not.toBe(baseline);
    });
});

describe('serializeReviewDossier', () => {
    it('should emit a stable key order, four-space indent and a trailing newline', () => {
        const text = serializeReviewDossier(validDossier());

        expect(text.endsWith('\n')).toBe(true);
        expect(text).toContain('\n    "pr": 2999,');
        expect(text.indexOf('"format"')).toBeLessThan(text.indexOf('"pr"'));
        expect(text.indexOf('"pr"')).toBeLessThan(text.indexOf('"headSha"'));
        expect(text).toContain(`"format": "${REVIEW_DOSSIER_FORMAT}"`);
    });

    it('should round-trip serialize to parse and back byte-identically', () => {
        const text = serializeReviewDossier(validDossier());

        expect(serializeReviewDossier(parseReviewDossier(JSON.parse(text)))).toBe(text);
    });

    it('should preserve event order through serialize and parse', () => {
        const dossier = validDossier();
        const reparsed = parseReviewDossier(JSON.parse(serializeReviewDossier(dossier)));

        expect(reparsed.events.map((record) => record.digest)).toEqual(dossier.events.map((record) => record.digest));
        expect(reparsed.events.map((record) => record.sequence)).toEqual([0, 1, 2, 3]);
    });
});

describe('derived views', () => {
    it('should report completed stances from stance-completed events', () => {
        expect(completedStances(validDossier())).toEqual([
            {
                stance: 'correctness',
                reviewerModel: 'model-correctness',
                modelTier: 'strongest',
                outcome: 'blocker-found',
            },
            {
                stance: 'test-validity',
                reviewerModel: 'model-test-validity',
                modelTier: 'standard',
                outcome: 'clean',
            },
        ]);
    });

    it('should report accepted findings from finding-accepted events', () => {
        expect(acceptedFindings(validDossier())).toEqual([
            { findingId: 'finding-1', path: 'scripts/reviewDossier.ts', line: 42, side: 'RIGHT' },
        ]);
    });

    it('should report discarded dispositions from finding-discarded events', () => {
        expect(discardedDispositions(validDossier())).toEqual([
            { findingId: 'finding-2', stance: 'correctness', reason: 'stale diff context' },
        ]);
    });

    it('should report the recorded assessment impact beside the recommendation', () => {
        expect(assessmentImpact(validDossier())).toBe('none');
        expect(assessmentImpact(assembleWith({ assessmentImpact: 'finding-led' }))).toBe('finding-led');
    });
});

describe('assessment impact', () => {
    it('should pin exactly the four admissible tokens, so widening the vocabulary reddens this test', () => {
        expect([...ASSESSMENT_IMPACTS]).toEqual(['none', 'limitation-only', 'stance-changed', 'finding-led']);
    });

    it.each(ASSESSMENT_IMPACTS)('should round-trip the %s token through assembly, serialize and parse', (token) => {
        const dossier = assembleWith({ assessmentImpact: token });

        expect(dossier.assessmentImpact).toBe(token);
        const reparsed = parseReviewDossier(JSON.parse(serializeReviewDossier(dossier)));
        expect(reparsed.assessmentImpact).toBe(token);
        expect(assessmentImpact(reparsed)).toBe(token);
        expect(serializeReviewDossier(reparsed)).toBe(serializeReviewDossier(dossier));
    });

    it('should give two dossiers differing only in assessmentImpact different digests', () => {
        const none = assembleWith({ assessmentImpact: 'none' });
        const findingLed = assembleWith({ assessmentImpact: 'finding-led' });

        expect(none.dossierDigest).not.toBe(findingLed.dossierDigest);
        // The impact never enters the event chain, so the head digest is unchanged.
        expect(none.headDigest).toBe(findingLed.headDigest);
    });

    it('should refuse an unknown token when assembling and name the field and the four tokens', () => {
        expect(() => assembleWith({ assessmentImpact: 'ignored' as AssessmentImpact })).toThrow(
            /assessmentImpact must be none, limitation-only, stance-changed or finding-led, found "ignored"/
        );
    });

    it('should refuse a non-string token when assembling and name the field', () => {
        expect(() => assembleWith({ assessmentImpact: 7 as unknown as AssessmentImpact })).toThrow(
            /assessmentImpact must be none, limitation-only, stance-changed or finding-led, found 7/
        );
    });

    it('should refuse an unknown token in a persisted record', () => {
        const mutated = cloneDossier();
        mutated.assessmentImpact = 'agreed' as AssessmentImpact;

        expect(() => parseReviewDossier(mutated)).toThrow(
            /assessmentImpact must be none, limitation-only, stance-changed or finding-led, found "agreed"/
        );
    });

    it('should refuse a null impact in a persisted record and name the field', () => {
        const mutated = cloneDossier() as unknown as Record<string, unknown>;
        mutated.assessmentImpact = null;

        expect(() => parseReviewDossier(mutated)).toThrow(/assessmentImpact must be none/);
    });

    it('should refuse a fresh canonical record with no impact and no recorded publication', () => {
        const fresh = buildDossier({
            pr: PLAN.pr,
            headSha: PLAN.headSha,
            baseSha: PLAN.baseSha,
            riskClasses: PLAN.riskClasses,
            requiredStances: ['correctness', 'test-validity'],
            events: [...BASE_EVENTS],
            evidence: [EVIDENCE_ENTRY],
            limitations: [LIMITATION],
            recommendation: 'request-changes',
        });

        expect(() => parseReviewDossier(fresh)).toThrow(
            /assessmentImpact must be none, limitation-only, stance-changed or finding-led, found missing/
        );
    });

    it('should refuse limitation-only when the record discloses no limitation', () => {
        expect(() => assembleWith({ assessmentImpact: 'limitation-only', limitations: [] })).toThrow(
            /assessmentImpact limitation-only contradicts limitations: the round discloses none/
        );
    });

    it('should refuse finding-led when the record accepts no finding', () => {
        const noAcceptedFinding = BASE_EVENTS.filter((event) => event.kind !== 'finding-accepted');

        expect(() => assembleWith({ assessmentImpact: 'finding-led', events: noAcceptedFinding })).toThrow(
            /assessmentImpact finding-led contradicts accepted findings: the round carries none/
        );
    });

    it('should keep none and stance-changed as attestations the record cannot contradict', () => {
        const noAcceptedFinding = BASE_EVENTS.filter((event) => event.kind !== 'finding-accepted');

        expect(
            assessmentImpact(assembleWith({ assessmentImpact: 'none', limitations: [], events: noAcceptedFinding }))
        ).toBe('none');
        expect(
            assessmentImpact(
                assembleWith({ assessmentImpact: 'stance-changed', limitations: [], events: noAcceptedFinding })
            )
        ).toBe('stance-changed');
    });
});

describe('assembleReviewDossier discarded input', () => {
    it('should append valid discarded entries after caller events in array order', () => {
        const dossier = assembleWith({
            discarded: [
                { finding: 'finding-3', stance: 'correctness', reason: 'cannot reproduce on this head' },
                { finding: 'finding-4', stance: 'test-validity', reason: 'already covered by finding-1' },
            ],
        });

        expect(dossier.events).toHaveLength(BASE_EVENTS.length + 2);
        expect(recordAt(dossier, BASE_EVENTS.length).kind).toBe('finding-discarded');
        expect(discardedDispositions(dossier).map((entry) => entry.findingId)).toEqual([
            'finding-2',
            'finding-3',
            'finding-4',
        ]);
    });

    it('should name the offending discarded entry index', () => {
        expect(() =>
            assembleWith({
                discarded: [
                    { finding: 'finding-3', stance: 'correctness', reason: 'valid entry' },
                    { finding: '', stance: 'correctness', reason: 'blank finding id' },
                ],
            })
        ).toThrow(/discarded\[1\] finding/);
    });

    it('should refuse a discarded payload that is not an array', () => {
        expect(() => assembleWith({ discarded: { finding: 'finding-3' } })).toThrow(
            /review dossier discarded must be an array/
        );
    });

    it('should refuse a credential-shaped discard reason and name the reason field', () => {
        expect(() =>
            assembleWith({
                discarded: [
                    { finding: 'finding-3', stance: 'correctness', reason: 'cannot reproduce on this head' },
                    { finding: 'finding-4', stance: 'correctness', reason: `ghp_${'A'.repeat(24)}` },
                ],
            })
        ).toThrow(/discarded\[1\] reason value at index 0 contains a GitHub token/);
    });

    it('should assemble a safe discard reason unchanged', () => {
        const dossier = assembleWith({
            discarded: [{ finding: 'finding-3', stance: 'correctness', reason: 'cannot reproduce on this head' }],
        });

        expect(discardedDispositions(dossier)).toEqual([
            { findingId: 'finding-2', stance: 'correctness', reason: 'stale diff context' },
            { findingId: 'finding-3', stance: 'correctness', reason: 'cannot reproduce on this head' },
        ]);
    });
});

describe('assembleReviewDossier evidence safety', () => {
    const CREDENTIAL = `ghp_${'A'.repeat(24)}`;

    function eventsWith(index: number, replacement: ReviewDossierEvent): ReviewDossierEvent[] {
        return BASE_EVENTS.map((event, eventIndex) => (eventIndex === index ? replacement : event));
    }

    it('should refuse a credential-shaped reviewerModel and name the field', () => {
        expect(() =>
            assembleWith({
                events: eventsWith(0, {
                    kind: 'stance-completed',
                    stance: 'correctness',
                    reviewerModel: CREDENTIAL,
                    modelTier: 'strongest',
                    outcome: 'clean',
                }),
            })
        ).toThrow(/event 0 reviewerModel value at index 0 contains a GitHub token/);
    });

    it('should refuse a credential-shaped accepted finding id and name the field', () => {
        expect(() =>
            assembleWith({
                events: eventsWith(1, {
                    kind: 'finding-accepted',
                    findingId: CREDENTIAL,
                    path: 'scripts/reviewDossier.ts',
                    line: 42,
                    side: 'RIGHT',
                }),
            })
        ).toThrow(/event 1 findingId value at index 0 contains a GitHub token/);
    });

    it('should refuse a credential-shaped accepted path and name the field', () => {
        expect(() =>
            assembleWith({
                events: eventsWith(1, {
                    kind: 'finding-accepted',
                    findingId: 'finding-1',
                    path: `AKIA${'C'.repeat(16)}`,
                    line: 42,
                    side: 'RIGHT',
                }),
            })
        ).toThrow(/event 1 path value at index 0 contains an AWS access key id/);
    });

    it('should refuse a transcript marker in an accepted path and name the field', () => {
        expect(() =>
            assembleWith({
                events: eventsWith(1, {
                    kind: 'finding-accepted',
                    findingId: 'finding-1',
                    path: '⏺ Read scripts/reviewDossier.ts',
                    line: 42,
                    side: 'RIGHT',
                }),
            })
        ).toThrow(/event 1 path value at index 0 contains a session transcript marker/);
    });

    it('should refuse a credential-shaped discarded finding id and name the field', () => {
        expect(() =>
            assembleWith({
                discarded: [{ finding: CREDENTIAL, stance: 'correctness', reason: 'cannot reproduce on this head' }],
            })
        ).toThrow(/discarded\[0\] finding value at index 0 contains a GitHub token/);
    });

    it('should assemble safe reviewer model, finding id, path and finding id unchanged', () => {
        const dossier = assembleWith({
            discarded: [{ finding: 'finding-3', stance: 'correctness', reason: 'cannot reproduce on this head' }],
        });

        expect(completedStances(dossier).map((entry) => entry.reviewerModel)).toEqual([
            'model-correctness',
            'model-test-validity',
        ]);
        expect(acceptedFindings(dossier)).toEqual([
            { findingId: 'finding-1', path: 'scripts/reviewDossier.ts', line: 42, side: 'RIGHT' },
        ]);
        expect(discardedDispositions(dossier)).toEqual([
            { findingId: 'finding-2', stance: 'correctness', reason: 'stale diff context' },
            { findingId: 'finding-3', stance: 'correctness', reason: 'cannot reproduce on this head' },
        ]);
    });

    it('should assemble evidence and limitations whose prose merely mentions a bearer token or a system prompt', () => {
        const dossier = assembleWith({
            evidence: [
                { ...EVIDENCE_ENTRY, observed: 'send the bearer token in the Authorization header' },
                { ...EVIDENCE_ENTRY, observed: 'the system prompt is stable on this head' },
            ],
            limitations: ['the system reports one failing assertion on the digest rule'],
        });

        expect(dossier.evidence.map((entry) => entry.observed)).toEqual([
            'send the bearer token in the Authorization header',
            'the system prompt is stable on this head',
        ]);
        expect(dossier.limitations).toEqual(['the system reports one failing assertion on the digest rule']);
    });
});

describe('assembleReviewDossier refusals', () => {
    it('should refuse a second draw repeating a completed stance and reviewer model', () => {
        expect(() =>
            assembleWith({
                events: [...BASE_EVENTS, { ...SECOND_CORRECTNESS_STANCE, reviewerModel: 'model-correctness' }],
            })
        ).toThrow(/completes stance correctness more than once on model-correctness/);
    });

    it('should assemble and round-trip several draws on one stance with distinct reviewer models', () => {
        const dossier = assembleWith({ events: [...BASE_EVENTS, SECOND_CORRECTNESS_STANCE] });

        expect(dossier.requiredStances).toEqual(['correctness', 'test-validity']);
        const reparsed = parseReviewDossier(JSON.parse(serializeReviewDossier(dossier)));
        expect(completedStances(reparsed).map((entry) => entry.reviewerModel)).toEqual([
            'model-correctness',
            'model-test-validity',
            'model-correctness-second',
        ]);
    });

    it('should carry a draw exhaustion through assemble, serialize and parse with the digest verifying', () => {
        const exhaustedDraw = {
            stance: 'correctness',
            reviewerModel: 'model-correctness-second',
            modelTier: 'economy' as const,
            outcome: 'clean' as const,
            exhaustion: 'every other harness on this machine was committed to another lane',
        };
        const event: ReviewDossierEvent = { kind: 'stance-completed', ...exhaustedDraw };
        const dossier = assembleWith({ events: [...BASE_EVENTS, event] });

        expect(completedStances(dossier).at(-1)).toEqual(exhaustedDraw);
        const reparsed = parseReviewDossier(JSON.parse(serializeReviewDossier(dossier)));
        expect(completedStances(reparsed).at(-1)).toEqual(exhaustedDraw);
        expect(serializeReviewDossier(reparsed)).toBe(serializeReviewDossier(dossier));
    });

    it('should cover exhaustion in the event digest when present', () => {
        const draw = {
            kind: 'stance-completed',
            stance: 'correctness',
            reviewerModel: 'model-a',
            modelTier: 'standard',
            outcome: 'clean',
        } as const;
        const baseline = reviewDossierEventDigest({ ...draw, sequence: 0, previousDigest: GENESIS_DIGEST });

        expect(
            reviewDossierEventDigest({
                ...draw,
                exhaustion: 'every other harness was unavailable',
                sequence: 0,
                previousDigest: GENESIS_DIGEST,
            })
        ).not.toBe(baseline);
    });

    it('should refuse an unsafe draw exhaustion and name the field', () => {
        expect(() =>
            assembleWith({
                events: [
                    ...BASE_EVENTS,
                    {
                        ...SECOND_CORRECTNESS_STANCE,
                        exhaustion: `ghp_${'A'.repeat(24)}`,
                    },
                ],
            })
        ).toThrow(/event 4 exhaustion value at index 0 contains a GitHub token/);
    });

    it('should refuse a persisted required stance with no completed record', () => {
        const mutated = cloneDossier();
        mutated.requiredStances = ['code-craft', 'correctness', 'test-validity'];

        expect(() => parseReviewDossier(mutated)).toThrow(/has no completed record for required stance: code-craft/);
    });

    it('should assemble a dispatched stance the plan does not list, recording it as the record stances', () => {
        const dossier = assembleWith({ events: [...BASE_EVENTS, EXTRA_DISPATCHED_STANCE] });

        expect(dossier.requiredStances).toEqual(['code-craft', 'correctness', 'test-validity']);
    });

    it('should assemble and round-trip a free-form dispatched stance the plan menu does not name', () => {
        const freeFormStance = 'gate-correspondence correctness — a dossier entry the record does not carry refuses';
        const dossier = assembleWith({
            events: [
                {
                    kind: 'stance-completed',
                    stance: freeFormStance,
                    reviewerModel: 'model-gate-correspondence',
                    modelTier: 'standard',
                    outcome: 'clean',
                },
                {
                    kind: 'finding-discarded',
                    findingId: 'finding-7',
                    stance: freeFormStance,
                    reason: 'not reproducible on this head',
                },
            ],
        });

        expect(dossier.requiredStances).toEqual([freeFormStance]);
        const reparsed = parseReviewDossier(JSON.parse(serializeReviewDossier(dossier)));
        expect(completedStances(reparsed).map((entry) => entry.stance)).toEqual([freeFormStance]);
        expect(discardedDispositions(reparsed).map((entry) => entry.stance)).toEqual([freeFormStance]);
    });

    it('should refuse a persisted completed stance its required stances do not carry', () => {
        const mutated = cloneDossier();
        mutated.events.push({
            ...EXTRA_DISPATCHED_STANCE,
            sequence: mutated.events.length,
            previousDigest: 'x',
            digest: 'y',
        });

        expect(() => parseReviewDossier(mutated)).toThrow(
            /completes a stance its required stances do not carry: code-craft/
        );
    });

    it('should refuse a persisted second draw repeating a completed stance and reviewer model', () => {
        const mutated = cloneDossier();
        mutated.events.push({
            kind: 'stance-completed',
            stance: 'correctness',
            reviewerModel: 'model-correctness',
            modelTier: 'economy',
            outcome: 'clean',
            sequence: mutated.events.length,
            previousDigest: 'x',
            digest: 'y',
        });

        // The total-map refusal fires before the chain verifies the appended record's digest.
        expect(() => parseReviewDossier(mutated)).toThrow(
            /completes stance correctness more than once on model-correctness/
        );
    });

    it('should refuse a finding id that is both accepted and discarded', () => {
        expect(() =>
            assembleWith({
                discarded: [{ finding: 'finding-1', stance: 'correctness', reason: 'contradicts acceptance' }],
            })
        ).toThrow(/both accepts and discards finding: finding-1/);
    });

    it('should refuse a duplicate accepted finding id', () => {
        const duplicateAcceptance: ReviewDossierEvent = {
            kind: 'finding-accepted',
            findingId: 'finding-1',
            path: 'scripts/reviewDossier.ts',
            line: 7,
            side: 'LEFT',
        };

        expect(() => assembleWith({ events: [...BASE_EVENTS, duplicateAcceptance] })).toThrow(
            /repeats a finding-accepted finding id: finding-1/
        );
    });

    it('should refuse a discard under a stance the record does not carry', () => {
        expect(() =>
            assembleWith({ discarded: [{ finding: 'finding-8', stance: 'code-craft', reason: 'out of scope' }] })
        ).toThrow(/discards a finding under a stance its required stances do not carry: code-craft/);
    });

    it('should refuse a blank discard reason', () => {
        expect(() =>
            assembleWith({ discarded: [{ finding: 'finding-9', stance: 'correctness', reason: '   ' }] })
        ).toThrow(/discarded\[0\] reason must be a non-blank string/);
    });

    it('should ignore the plan stance menu, deriving the record stances from the dispatch', () => {
        const dossier = assembleWith({ plan: { ...PLAN, requiredStances: ['test-validity', 'correctness'] } });

        expect(dossier.requiredStances).toEqual(['correctness', 'test-validity']);
    });

    it('should refuse unsafe evidence and name the offending field', () => {
        const credential = `AKIA${'C'.repeat(16)}`;

        expect(() => assembleWith({ evidence: [{ ...EVIDENCE_ENTRY, observed: credential }] })).toThrow(
            /evidence\[0\]\.observed/
        );
    });

    it('should refuse an unsafe limitation', () => {
        expect(() => assembleWith({ limitations: ['Assistant: leaked transcript'] })).toThrow(
            /limitations value at index 0 contains a transcript role prefix/
        );
    });

    it('should refuse a dossier larger than the byte bound', () => {
        expect(() => assembleWith({ evidence: oversizedEvidence() })).toThrow(
            new RegExp(`exceeds ${REVIEW_DOSSIER_MAX_BYTES} bytes`)
        );
    });
});

describe('parseReviewDossier refusals', () => {
    it('should refuse a deleted middle record', () => {
        const mutated = cloneDossier();
        mutated.events.splice(1, 1);

        expect(() => parseReviewDossier(mutated)).toThrow(/event 1 sequence must be 1/);
    });

    it('should refuse swapped records', () => {
        const mutated = cloneDossier();
        const first = recordAt(mutated, 1);
        const second = recordAt(mutated, 2);
        mutated.events[1] = second;
        mutated.events[2] = first;

        expect(() => parseReviewDossier(mutated)).toThrow(/sequence must be 1/);
    });

    it('should refuse a rewritten previousDigest', () => {
        const mutated = cloneDossier();
        recordAt(mutated, 1).previousDigest = 'f'.repeat(64);

        expect(() => parseReviewDossier(mutated)).toThrow(/event 1 previousDigest does not chain/);
    });

    it('should refuse a rewritten payload that keeps its old digest', () => {
        const mutated = cloneDossier();
        const record = recordAt(mutated, 0);
        if (record.kind !== 'stance-completed') {
            throw new Error('fixture must start with a stance-completed record');
        }
        record.reviewerModel = 'model-rewritten';

        expect(() => parseReviewDossier(mutated)).toThrow(/event 0 digest does not match its payload/);
    });

    it('should refuse a rebound headSha', () => {
        const mutated = cloneDossier();
        mutated.headSha = 'c'.repeat(40);

        expect(() => parseReviewDossier(mutated)).toThrow(/dossierDigest does not match its payload/);
    });

    it('should refuse a headDigest that is not the last record digest', () => {
        const mutated = cloneDossier();
        mutated.headDigest = GENESIS_DIGEST;

        expect(() => parseReviewDossier(mutated)).toThrow(/headDigest must be/);
    });

    it('should refuse a mismatched dossierDigest', () => {
        const mutated = cloneDossier();
        mutated.dossierDigest = GENESIS_DIGEST;

        expect(() => parseReviewDossier(mutated)).toThrow(/dossierDigest does not match its payload/);
    });

    it.each(['observable', 'verification', 'observed'] as const)(
        'should refuse an edited evidence %s that keeps the recorded digest',
        (field) => {
            const mutated = cloneDossier();
            const entry = mutated.evidence[0];
            if (entry === undefined) {
                throw new Error('fixture must carry one evidence entry');
            }
            entry[field] = `edited ${field} for the digest check`;

            expect(() => parseReviewDossier(mutated)).toThrow(/dossierDigest does not match its payload/);
        }
    );

    it('should refuse an edited limitation that keeps the recorded digest', () => {
        const mutated = cloneDossier();
        mutated.limitations = ['an edited limitation for the digest check'];

        expect(() => parseReviewDossier(mutated)).toThrow(/dossierDigest does not match its payload/);
    });

    it('should refuse a sequence gap', () => {
        const mutated = cloneDossier();
        recordAt(mutated, 1).sequence = 7;

        expect(() => parseReviewDossier(mutated)).toThrow(/event 1 sequence must be 1/);
    });

    it('should refuse a wrong format', () => {
        expect(() => parseReviewDossier({ ...cloneDossier(), format: 'dossier-v2' })).toThrow(
            new RegExp(`format must be ${REVIEW_DOSSIER_FORMAT}`)
        );
    });

    it('should refuse a missing field', () => {
        const { format: _unused, ...withoutFormat } = cloneDossier();

        expect(() => parseReviewDossier(withoutFormat)).toThrow(/fields must be/);
    });

    it('should refuse a non-positive pr', () => {
        expect(() => parseReviewDossier({ ...cloneDossier(), pr: 0 })).toThrow(/pr must be a positive safe integer/);
    });

    it('should refuse a blank headSha', () => {
        expect(() => parseReviewDossier({ ...cloneDossier(), headSha: '   ' })).toThrow(
            /headSha must be a non-blank string/
        );
    });

    it('should refuse unsorted required stances', () => {
        expect(() =>
            parseReviewDossier({ ...cloneDossier(), requiredStances: ['test-validity', 'correctness'] })
        ).toThrow(/requiredStances must be sorted/);
    });

    it('should refuse a dossier larger than the byte bound', () => {
        const mutated = cloneDossier();
        mutated.evidence = oversizedEvidence();

        expect(() => parseReviewDossier(mutated)).toThrow(new RegExp(`exceeds ${REVIEW_DOSSIER_MAX_BYTES} bytes`));
    });

    it('should refuse a credential-shaped reason in a persisted discard event', () => {
        const mutated = cloneDossier();
        const record = recordAt(mutated, 2);
        if (record.kind !== 'finding-discarded') {
            throw new Error('fixture must carry a discard at index 2');
        }
        record.reason = `ghp_${'A'.repeat(24)}`;

        expect(() => parseReviewDossier(mutated)).toThrow(/event 2 reason value at index 0 contains a GitHub token/);
    });

    it('should refuse a credential-shaped reviewerModel in a persisted record', () => {
        const mutated = cloneDossier();
        const record = recordAt(mutated, 0);
        if (record.kind !== 'stance-completed') {
            throw new Error('fixture must start with a stance-completed record');
        }
        record.reviewerModel = `ghp_${'A'.repeat(24)}`;

        expect(() => parseReviewDossier(mutated)).toThrow(
            /event 0 reviewerModel value at index 0 contains a GitHub token/
        );
    });

    it('should refuse a credential-shaped stance name in a persisted record', () => {
        const mutated = cloneDossier();
        const record = recordAt(mutated, 0);
        if (record.kind !== 'stance-completed') {
            throw new Error('fixture must start with a stance-completed record');
        }
        record.stance = `ghp_${'A'.repeat(24)}`;

        expect(() => parseReviewDossier(mutated)).toThrow(/event 0 stance value at index 0 contains a GitHub token/);
    });

    it('should refuse a transcript marker in a persisted accepted path', () => {
        const mutated = cloneDossier();
        const record = recordAt(mutated, 1);
        if (record.kind !== 'finding-accepted') {
            throw new Error('fixture must carry an accepted finding at index 1');
        }
        record.path = '⏺ Read scripts/reviewDossier.ts';

        expect(() => parseReviewDossier(mutated)).toThrow(
            /event 1 path value at index 0 contains a session transcript marker/
        );
    });

    it('should refuse a credential-shaped finding id in a persisted discard event', () => {
        const mutated = cloneDossier();
        const record = recordAt(mutated, 2);
        if (record.kind !== 'finding-discarded') {
            throw new Error('fixture must carry a discard at index 2');
        }
        record.findingId = `ghp_${'A'.repeat(24)}`;

        expect(() => parseReviewDossier(mutated)).toThrow(/event 2 findingId value at index 0 contains a GitHub token/);
    });

    it('should accept a bounded, safe dossier', () => {
        expect(() => parseReviewDossier(validDossier())).not.toThrow();
        expect(Buffer.byteLength(serializeReviewDossier(validDossier()), 'utf8')).toBeLessThanOrEqual(
            REVIEW_DOSSIER_MAX_BYTES
        );
    });
});

/**
 * A record serialized by the chain before `exhaustion` and `assessmentImpact` existed: no
 * stance-completed event carries `exhaustion`, no top-level key carries `assessmentImpact`, and every
 * digest covers exactly the five base fields. It is an already-published record — it records its own
 * `review-published` event — which is the one shape a missing `assessmentImpact` is tolerated on.
 * Pinned as bytes so any change to the digest preimage — such as including exhaustion or
 * assessmentImpact unconditionally — breaks verification of records the previous chain printed,
 * instead of silently re-keying history.
 */
const HISTORICAL_PUBLISHED_RECORD = `{
    "format": "dossier-v1",
    "pr": 2999,
    "headSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "baseSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "riskClasses": [
        "small"
    ],
    "requiredStances": [
        "correctness"
    ],
    "events": [
        {
            "sequence": 0,
            "previousDigest": "0000000000000000000000000000000000000000000000000000000000000000",
            "digest": "4afdab1f7953f72839013972ab241a800e49cf154859b83262f3a3a13e3fb33c",
            "kind": "stance-completed",
            "stance": "correctness",
            "reviewerModel": "model-correctness",
            "modelTier": "strongest",
            "outcome": "clean"
        },
        {
            "sequence": 1,
            "previousDigest": "4afdab1f7953f72839013972ab241a800e49cf154859b83262f3a3a13e3fb33c",
            "digest": "6c3c254b99308975d5140dd54c653a406a8cc2aecfc995593f01e15c1bcf3be6",
            "kind": "review-published",
            "reviewId": 5272945685
        }
    ],
    "evidence": [],
    "limitations": [],
    "recommendation": "approve",
    "headDigest": "6c3c254b99308975d5140dd54c653a406a8cc2aecfc995593f01e15c1bcf3be6",
    "dossierDigest": "958088c65c8962cccc9d12c6545a4411be3641e32564bf42f7eaa4b12f58a83e"
}
`;

describe('historical dossier records', () => {
    it('should verify a record persisted before exhaustion existed, byte-identically', () => {
        const historical = JSON.parse(HISTORICAL_PUBLISHED_RECORD);

        expect(() => parseReviewDossier(historical)).not.toThrow();
        expect(serializeReviewDossier(parseReviewDossier(historical))).toBe(HISTORICAL_PUBLISHED_RECORD);
    });

    it('should read a historical completed stance with no exhaustion', () => {
        const [only] = completedStances(parseReviewDossier(JSON.parse(HISTORICAL_PUBLISHED_RECORD)));
        if (only === undefined) {
            throw new Error('fixture must carry one completed stance');
        }

        expect(only.exhaustion).toBeUndefined();
    });

    it('should replay a published record persisted before assessmentImpact existed with no recorded impact', () => {
        const parsed = parseReviewDossier(JSON.parse(HISTORICAL_PUBLISHED_RECORD));

        expect(publishedReviewId(parsed)).toBe(5272945685);
        expect(assessmentImpact(parsed)).toBeUndefined();
    });
});

const ARMOR_EDGE = '-----';
const SECSH_EDGE = '----';

/** Assembles a PEM or PGP armor header from its edges and label, keeping the literal out of source. */
function armorHeader(label: string): string {
    return [ARMOR_EDGE, 'BEGIN ', label, ARMOR_EDGE].join('');
}

/** Assembles the four-dash SECSH spelling the reader must refuse as well. */
function secshArmorHeader(label: string): string {
    return [SECSH_EDGE, ' BEGIN ', label, ' ', SECSH_EDGE].join('');
}

const BEARER_TOKEN = ['0123456789', 'abcdef'].join('');
const BEARER_CREDENTIAL = ['Bearer', BEARER_TOKEN].join(' ');
const LOWERCASE_BEARER_CREDENTIAL = ['bearer', BEARER_TOKEN].join(' ');
const JSON_WEB_TOKEN = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxIn0', 'c2lnbmF0dXJl'].join('.');
const SHORT_BEARER_CREDENTIAL = ['Bearer', 'abc123'].join(' ');
const EIGHT_CHARACTER_BEARER_CREDENTIAL = ['Bearer', 'abcdefgh'].join(' ');
const LONG_BEARER_CREDENTIAL = ['Bearer', 'abcdefghijklmnopqrstuvwx'].join(' ');
const SYMBOL_BEARER_CREDENTIAL = ['Bearer', ['abcd', 'ef'].join('_')].join(' ');
const LATE_DIGIT_BEARER_CREDENTIAL = ['Bearer', ['abcdef', '12345'].join('')].join(' ');
const TRAILING_DIGIT_BEARER_CREDENTIAL = ['Bearer', ['abc', '1'].join('')].join(' ');
const TRAILING_SYMBOL_BEARER_CREDENTIAL = ['Bearer', ['abc', '_'].join('')].join(' ');
const PROSE_BEARER = ['Bearer', 'token'].join(' ');
const MID_TOKEN_DOT_BEARER_CREDENTIAL = ['Bearer', ['abc', 'def'].join('.')].join(' ');
const CAPITALISED_SYSTEM_TURN = '{"role":"System","content":"x"}';
const BENIGN_ADMIN_TURN = '{"role":"admin"}';

const UNSAFE_FIXTURES: { name: string; value: string }[] = [
    { name: 'a gh-prefixed GitHub token', value: `ghp_${'A'.repeat(24)}` },
    { name: 'a gho-prefixed GitHub token', value: `gho_${'A'.repeat(24)}` },
    { name: 'a ghs-prefixed GitHub token', value: `ghs_${'A'.repeat(24)}` },
    { name: 'a ghu-prefixed GitHub token', value: `ghu_${'A'.repeat(24)}` },
    { name: 'a ghr-prefixed GitHub token', value: `ghr_${'A'.repeat(24)}` },
    { name: 'a fine-grained GitHub token', value: `github_pat_${'B'.repeat(24)}` },
    { name: 'an AWS access key id', value: `AKIA${'C'.repeat(16)}` },
    { name: 'a temporary AWS access key id', value: `ASIA${'D'.repeat(16)}` },
    { name: 'a private key header', value: armorHeader('RSA PRIVATE KEY') },
    { name: 'a PGP private key armor header', value: armorHeader('PGP PRIVATE KEY BLOCK') },
    { name: 'a JSON web token', value: JSON_WEB_TOKEN },
    { name: 'a bearer credential', value: BEARER_CREDENTIAL },
    { name: 'a short digit-bearing bearer credential', value: SHORT_BEARER_CREDENTIAL },
    { name: 'a non-dot-symbol bearer credential', value: SYMBOL_BEARER_CREDENTIAL },
    { name: 'a late-digit bearer credential', value: LATE_DIGIT_BEARER_CREDENTIAL },
    { name: 'a twenty-four-character bearer credential', value: LONG_BEARER_CREDENTIAL },
    { name: 'a serialized assistant turn', value: '{"role": "assistant", "content": "review"}' },
    { name: 'a serialized user turn', value: '{"role":"user","content":"review"}' },
    { name: 'a serialized system turn', value: '{"role":"system","content":"review"}' },
    { name: 'a serialized tool turn', value: '{"role": "tool", "content": "review"}' },
    { name: 'a capitalised serialized system turn', value: CAPITALISED_SYSTEM_TURN },
    { name: 'a serialized function turn', value: '{"role":"function","content":"review"}' },
    { name: 'a serialized developer turn', value: '{"role":"developer","content":"review"}' },
    { name: 'a lowercase bearer credential', value: LOWERCASE_BEARER_CREDENTIAL },
    { name: 'a Human transcript line', value: 'Human: please review' },
    { name: 'an Assistant transcript line', value: 'Assistant: reviewed' },
    { name: 'a System transcript line', value: 'System: instructions' },
    { name: 'a session marker', value: '⏺ Read scripts/reviewDossier.ts' },
    { name: 'a session tag', value: '<session id="1">' },
    { name: 'a multiline value', value: 'first line\nsecond line' },
    { name: 'a line separator value', value: 'first line\u2028second line' },
    { name: 'a paragraph separator value', value: 'first line\u2029second line' },
    { name: 'an over-long value', value: 'x'.repeat(REVIEW_EVIDENCE_FIELD_MAX_BYTES + 1) },
    { name: 'an edge-untrimmed value', value: ' padded value ' },
    { name: 'a blank value', value: '   ' },
];

describe('assertPublicationSafeEvidence', () => {
    it.each(UNSAFE_FIXTURES)('should refuse $name and name the field', ({ value }) => {
        expect(() => assertPublicationSafeEvidence('evidence[0].observed', [value])).toThrow(
            /evidence\[0\]\.observed value at index 0/
        );
    });

    it('should name the offending index of a value list', () => {
        expect(() => assertPublicationSafeEvidence('limitations', ['safe value', `ghp_${'A'.repeat(24)}`])).toThrow(
            /limitations value at index 1/
        );
    });

    it('should refuse a bearer credential by the bearer rule rather than an earlier token shape', () => {
        expect(() => assertPublicationSafeEvidence('evidence[0].observed', [BEARER_CREDENTIAL])).toThrow(
            /evidence\[0\]\.observed value at index 0 contains a bearer credential/
        );
    });

    it('should refuse a lowercase bearer credential by the bearer rule and name the field and index', () => {
        expect(() => assertPublicationSafeEvidence('evidence[0].observed', [LOWERCASE_BEARER_CREDENTIAL])).toThrow(
            /evidence\[0\]\.observed value at index 0 contains a bearer credential/
        );
    });

    it.each([
        ['a short digit-bearing bearer credential', SHORT_BEARER_CREDENTIAL],
        ['a non-dot-symbol bearer credential', SYMBOL_BEARER_CREDENTIAL],
        ['a late-digit bearer credential', LATE_DIGIT_BEARER_CREDENTIAL],
        ['a trailing-digit bearer credential', TRAILING_DIGIT_BEARER_CREDENTIAL],
        ['a trailing-symbol bearer credential', TRAILING_SYMBOL_BEARER_CREDENTIAL],
        ['a twenty-four-character bearer credential', LONG_BEARER_CREDENTIAL],
    ])('should refuse %s by the bearer rule', (_name, value) => {
        expect(() => assertPublicationSafeEvidence('evidence[0].observed', [value])).toThrow(
            /evidence\[0\]\.observed value at index 0 contains a bearer credential/
        );
    });

    it.each(['ghp', 'gho', 'ghs', 'ghu', 'ghr'])(
        'should refuse a %s-prefixed GitHub token by the GitHub token reason',
        (prefix) => {
            expect(() =>
                assertPublicationSafeEvidence('evidence[0].observed', [`${prefix}_${'A'.repeat(24)}`])
            ).toThrow(/evidence\[0\]\.observed value at index 0 contains a GitHub token/);
        }
    );

    it('should refuse a capitalised serialized system turn by the chat turn reason', () => {
        expect(() => assertPublicationSafeEvidence('evidence[0].observed', [CAPITALISED_SYSTEM_TURN])).toThrow(
            /evidence\[0\]\.observed value at index 0 contains a serialized chat turn/
        );
    });

    it.each([
        ['a line separator', 'first\u2028second'],
        ['a paragraph separator', 'first\u2029second'],
    ])('should refuse %s by the separator rule and name the field and index', (_name, value) => {
        expect(() => assertPublicationSafeEvidence('evidence[0].observed', [value])).toThrow(
            /evidence\[0\]\.observed value at index 0 contains a line separator/
        );
    });

    it('should refuse a temporary AWS access key id by the AWS key rule and name the field and index', () => {
        expect(() => assertPublicationSafeEvidence('evidence[0].observed', [`ASIA${'D'.repeat(16)}`])).toThrow(
            /evidence\[0\]\.observed value at index 0 contains an AWS access key id/
        );
    });

    it('should refuse a PGP private key armor header by the private-key rule and name the field and index', () => {
        expect(() =>
            assertPublicationSafeEvidence('evidence[0].observed', [armorHeader('PGP PRIVATE KEY BLOCK')])
        ).toThrow(/evidence\[0\]\.observed value at index 0 contains a private key header/);
    });

    it.each([
        armorHeader('PRIVATE KEY'),
        armorHeader('SECRET KEY'),
        armorHeader('RSA PRIVATE KEY'),
        armorHeader('EC PRIVATE KEY'),
        armorHeader('DSA PRIVATE KEY'),
        armorHeader('OPENSSH PRIVATE KEY'),
        armorHeader('ENCRYPTED PRIVATE KEY'),
        armorHeader('X25519 PRIVATE KEY'),
        armorHeader('ED25519 PRIVATE KEY'),
        armorHeader('PGP PRIVATE KEY BLOCK'),
        armorHeader('X25519 SECRET KEY'),
        secshArmorHeader('PRIVATE KEY'),
        secshArmorHeader('SECRET KEY'),
        secshArmorHeader('RSA PRIVATE KEY'),
        secshArmorHeader('EC PRIVATE KEY'),
        secshArmorHeader('DSA PRIVATE KEY'),
        secshArmorHeader('OPENSSH PRIVATE KEY'),
        secshArmorHeader('ENCRYPTED PRIVATE KEY'),
        secshArmorHeader('X25519 PRIVATE KEY'),
        secshArmorHeader('ED25519 PRIVATE KEY'),
        secshArmorHeader('PGP PRIVATE KEY BLOCK'),
        secshArmorHeader('X25519 SECRET KEY'),
        secshArmorHeader('SSH2 ENCRYPTED PRIVATE KEY'),
    ])('should refuse the private or secret key armor %s and name the field, index and reason', (armor) => {
        expect(() => assertPublicationSafeEvidence('evidence[0].observed', [armor])).toThrow(
            /evidence\[0\]\.observed value at index 0 contains a private key header/
        );
    });

    it.each([
        ['a PGP public key armor block', armorHeader('PGP PUBLIC KEY BLOCK')],
        ['the SECSH public key armor block', secshArmorHeader('SSH2 PUBLIC KEY')],
        ['a certificate armor block', armorHeader('CERTIFICATE')],
        ['prose that mentions a private key', 'the private key must never be committed'],
        ['a base64 body with no armor header', 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ'],
        ['prose that mentions a bearer token', 'send the bearer token in the Authorization header'],
        ['the bare bearer token words', PROSE_BEARER],
        ['the lowercase bare bearer token words', 'bearer token'],
        ['a sentence ending on the bearer token words', 'the bearer token.'],
        ['the bearer word pair with a mid-token dot', MID_TOKEN_DOT_BEARER_CREDENTIAL],
        ['the bearer certificates word pair', 'bearer certificates'],
        ['the bearer instruments word pair', 'bearer instruments'],
        ['a sentence about bearer instruments in the ledger', 'a sentence about bearer instruments in the ledger'],
        // Eight pure letters cannot be told from a word, so `Bearer abcdefgh` stands as the accepted
        // trade-off; the credential shape starts at a digit, a non-dot symbol, or twenty-four characters.
        ['an eight-letter word after bearer', EIGHT_CHARACTER_BEARER_CREDENTIAL],
        ['a benign serialized admin role', BENIGN_ADMIN_TURN],
        ['prose that mentions a system prompt', 'the system prompt is stable on this head'],
        ['an ordinary sentence with the word system', 'the system reports one failing assertion'],
    ])('should pass %s', (_name, value) => {
        expect(() => assertPublicationSafeEvidence('evidence[0].observed', [value])).not.toThrow();
    });

    it('should pass a PGP public key armor block and prose that mentions a private key', () => {
        expect(() =>
            assertPublicationSafeEvidence('evidence[0].observed', [
                armorHeader('PGP PUBLIC KEY BLOCK'),
                'the private key must never be committed',
            ])
        ).not.toThrow();
    });

    it('should pass separator-free text and an under-length key-like value', () => {
        expect(() =>
            assertPublicationSafeEvidence('evidence[0].observed', ['a safe single-line value', `AKIA${'D'.repeat(15)}`])
        ).not.toThrow();
    });

    it('should pass a bounded safe value', () => {
        expect(() => assertPublicationSafeEvidence('evidence[0].observed', [EVIDENCE_ENTRY.observed])).not.toThrow();
    });
});

describe('publication binding events', () => {
    const REVIEW_ID = 5272945685;
    const PUBLICATION_EVENTS: readonly ReviewDossierEvent[] = [
        { kind: 'review-published', reviewId: REVIEW_ID },
        { kind: 'finding-published', findingId: 'finding-1', reviewId: REVIEW_ID, commentId: 2329000001 },
    ];

    it('should append publication bindings, keep every prefix digest, and round-trip byte-identically', () => {
        const dossier = validDossier();
        const prefixDigests = dossier.events.map((record) => record.digest);

        const bound = appendReviewDossierEvents(dossier, PUBLICATION_EVENTS);

        expect(bound.events.map((record) => record.digest).slice(0, prefixDigests.length)).toEqual(prefixDigests);
        expect(bound.events).toHaveLength(prefixDigests.length + 2);
        expect(bound.headDigest).toBe(recordAt(bound, bound.events.length - 1).digest);
        expect(bound.headDigest).not.toBe(dossier.headDigest);
        expect(parseReviewDossier(JSON.parse(serializeReviewDossier(bound)))).toEqual(bound);
    });

    it('should report the recorded publication and its finding bindings', () => {
        const bound = appendReviewDossierEvents(validDossier(), PUBLICATION_EVENTS);

        expect(publishedReviewId(bound)).toBe(REVIEW_ID);
        expect(publishedFindings(bound)).toEqual([
            { findingId: 'finding-1', reviewId: REVIEW_ID, commentId: 2329000001 },
        ]);
        expect(publishedReviewId(validDossier())).toBeUndefined();
        expect(publishedFindings(validDossier())).toEqual([]);
    });

    it('should refuse appending a binding for a finding no accepted event carries', () => {
        expect(() =>
            appendReviewDossierEvents(validDossier(), [
                { kind: 'review-published', reviewId: REVIEW_ID },
                { kind: 'finding-published', findingId: 'finding-9', reviewId: REVIEW_ID, commentId: 2329000001 },
            ])
        ).toThrow(/finding-9.*no accepted finding/u);
    });

    it('should refuse appending a binding for a discarded finding', () => {
        expect(() =>
            appendReviewDossierEvents(validDossier(), [
                { kind: 'review-published', reviewId: REVIEW_ID },
                { kind: 'finding-published', findingId: 'finding-2', reviewId: REVIEW_ID, commentId: 2329000001 },
            ])
        ).toThrow(/finding-2.*no accepted finding/u);
    });

    it('should refuse a second publication record', () => {
        expect(() =>
            appendReviewDossierEvents(validDossier(), [
                { kind: 'review-published', reviewId: REVIEW_ID },
                { kind: 'review-published', reviewId: REVIEW_ID + 1 },
            ])
        ).toThrow(/more than one publication/u);
    });

    it('should refuse a finding binding without a recorded publication', () => {
        expect(() =>
            appendReviewDossierEvents(validDossier(), [
                { kind: 'finding-published', findingId: 'finding-1', reviewId: REVIEW_ID, commentId: 2329000001 },
            ])
        ).toThrow(/without recording the publication's review id/u);
    });

    it('should refuse a finding binding naming another review', () => {
        expect(() =>
            appendReviewDossierEvents(validDossier(), [
                { kind: 'review-published', reviewId: REVIEW_ID },
                { kind: 'finding-published', findingId: 'finding-1', reviewId: REVIEW_ID + 1, commentId: 2329000001 },
            ])
        ).toThrow(/binds review .*not the recorded publication/u);
    });

    it('should refuse a repeated finding binding', () => {
        expect(() =>
            appendReviewDossierEvents(validDossier(), [
                ...PUBLICATION_EVENTS,
                { kind: 'finding-published', findingId: 'finding-1', reviewId: REVIEW_ID, commentId: 2329000002 },
            ])
        ).toThrow(/finding-1.*more than once/u);
    });

    it('should refuse a rebound review id on a dossier that already recorded its publication', () => {
        const bound = appendReviewDossierEvents(validDossier(), PUBLICATION_EVENTS);

        expect(() => appendReviewDossierEvents(bound, [{ kind: 'review-published', reviewId: REVIEW_ID + 7 }])).toThrow(
            /more than one publication/u
        );
    });

    it('should parse the publication kinds from a persisted record and refuse a missing key', () => {
        const bound = appendReviewDossierEvents(validDossier(), PUBLICATION_EVENTS);
        const persisted = JSON.parse(serializeReviewDossier(bound)) as {
            events: Record<string, unknown>[];
        };
        expect(parseReviewDossier(persisted)).toEqual(bound);

        const broken = structuredClone(persisted);
        const findingRecord = broken.events.find((record) => record.kind === 'finding-published');
        if (findingRecord === undefined) {
            throw new Error('expected a finding-published record');
        }
        delete findingRecord.commentId;
        expect(() => parseReviewDossier(broken)).toThrow(/fields must be/u);
    });

    it('should refuse a tampered publication binding that keeps its recorded digest', () => {
        const bound = appendReviewDossierEvents(validDossier(), PUBLICATION_EVENTS);
        const persisted = JSON.parse(serializeReviewDossier(bound)) as {
            events: { kind: string; commentId?: number }[];
        };
        const findingRecord = persisted.events.find((record) => record.kind === 'finding-published');
        if (findingRecord === undefined) {
            throw new Error('expected a finding-published record');
        }
        findingRecord.commentId = 999999999;

        expect(() => parseReviewDossier(persisted)).toThrow(/digest does not match/u);
    });
});
