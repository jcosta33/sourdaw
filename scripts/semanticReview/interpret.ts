/**
 * Deterministic interpretation of provider answers.
 *
 * The model supplies probabilities; this module decides what they mean. Thresholds come from the
 * versioned policy, overlapping conditions resolve toward uncertainty, and missing required evidence
 * is decisive on its own: no threshold can turn an unassessed scope into a clean one.
 *
 * Confidence is stored because it was returned, but it is a summary of the answer's distribution and
 * never an empirically established defect probability.
 */

import { refuse, type SemanticFailureCode } from './contracts.ts';
import {
    PROBABILITY_SUM_TOLERANCE,
    SEVERE_INVESTIGATION_CATEGORIES,
    VERIFICATION_ATTRIBUTION_THRESHOLD,
    VERIFICATION_KIND_THRESHOLD,
    VERIFICATION_SUPPORT_THRESHOLD,
    type SemanticRule,
    type ScanOutcome,
} from './rules.ts';

export type ScanDisposition =
    /** The rule recommends the orchestrator investigate this scope. */
    | 'recommend_investigation'
    /** The rule adds no recommendation for the evaluated scope. */
    | 'no_additional_recommendation'
    /** The outcome is not decisive, or required evidence was deterministically missing. */
    | 'unresolved';

export type ScanAssessment = {
    readonly ruleId: SemanticRule['id'];
    readonly unitId: string;
    readonly path: string;
    /** The band the answer fell in, derived in code from `probability` and the rule's thresholds. */
    readonly outcome: ScanOutcome;
    /** The Noul answer itself: the probability that this one property holds. Nothing is derived from it but `outcome`. */
    readonly probability: number;
    /**
     * How far the answer sits past the band edge it cleared, and 0 when it cleared neither. A Noul
     * carries no separate confidence, so this is a reading of the one number rather than a second one.
     */
    readonly confidence: number;
    readonly disposition: ScanDisposition;
    readonly investigationCategory: SemanticRule['investigationCategory'];
    readonly missingEvidence: readonly string[];
    readonly reasoning: string;
};

/**
 * How far a returned distribution may sit from 1 before it is refused.
 *
 * The provider rounds its probabilities, so a legitimate three-way Choice can sum to 0.99 — and a
 * 0.01 tolerance trips on the floating-point error in `|0.99 - 1|` alone. Distributions inside this
 * bound are normalized so interpretation sees a true distribution; anything further off is a
 * malformed answer and still refused.
 */

/**
 * Rescales a returned distribution to sum to one. The provider rounds its probabilities, so a
 * legitimate three-way Choice can arrive summing to 0.99; interpretation compares thresholds against
 * a real distribution rather than propagating that rounding into the decision.
 */
function normalizeProbabilities(probabilities: Record<string, number>, sum: number): void {
    if (sum === 1) {
        return;
    }
    for (const key of Object.keys(probabilities)) {
        probabilities[key] = (probabilities[key] ?? 0) / sum;
    }
}

function isProbability(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Validates a Choice answer against the labels the question offered. Probabilities must be present,
 * finite, in range, and sum to one; an answer the question did not define is refused rather than
 * coerced.
 */
export function readChoiceAnswer(
    value: unknown,
    labels: readonly string[],
    label: string
): { probabilities: Record<string, number>; confidence: number; selected: string } {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        refuse('invalid_response', `${label} must be an object`);
    }
    const record = value as Record<string, unknown>;
    if (record.type !== 'choice') {
        refuse(
            'invalid_response',
            `${label} must be a choice answer, found ${JSON.stringify(record.type) ?? 'nothing'}`
        );
    }
    const raw = record.probabilities;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        refuse('invalid_response', `${label} must carry a probabilities object`);
    }
    const probabilities: Record<string, number> = {};
    let sum = 0;
    for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
        if (!labels.includes(key)) {
            refuse('invalid_response', `${label} carries an unknown label ${key}`);
        }
        if (!isProbability(entry)) {
            refuse('invalid_response', `${label} probability for ${key} must be a finite number in [0, 1]`);
        }
        probabilities[key] = entry;
        sum += entry;
    }
    for (const expected of labels) {
        if (probabilities[expected] === undefined) {
            refuse('invalid_response', `${label} is missing the required label ${expected}`);
        }
    }
    if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) {
        refuse('invalid_response', `${label} probabilities sum to ${sum.toFixed(4)}, not 1`);
    }
    normalizeProbabilities(probabilities, sum);
    const selected = record.choice;
    if (typeof selected !== 'string' || !labels.includes(selected)) {
        refuse('invalid_response', `${label} selected an unknown option ${JSON.stringify(selected) ?? 'nothing'}`);
    }
    if (!isProbability(record.confidence)) {
        refuse('invalid_response', `${label} confidence must be a finite number in [0, 1]`);
    }
    return { probabilities, confidence: record.confidence, selected };
}

/** Reads the one number a Noul answer carries: the probability that the question's answer is yes. */
export function readNoulAnswer(value: unknown, label: string): number {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        refuse('invalid_response', `${label} must be an object`);
    }
    const record = value as Record<string, unknown>;
    if (record.type !== 'noul') {
        refuse('invalid_response', `${label} must be a noul answer, found ${JSON.stringify(record.type) ?? 'nothing'}`);
    }
    if (!isProbability(record.noul)) {
        refuse('invalid_response', `${label} noul must be a finite number in [0, 1]`);
    }
    return record.noul;
}

/**
 * The decision order is deliberate: evidence the application already knows to be missing outranks
 * anything the model said, and the band between the two thresholds is reported unresolved rather than
 * pressed toward whichever edge is nearer. The band is policy; the middle is not an answer.
 */
export function interpretScanOutcome(input: {
    answer: unknown;
    rule: SemanticRule;
    unitId: string;
    path: string;
    missingEvidence: readonly string[];
}): ScanAssessment {
    const { rule } = input;
    const { fire } = rule.thresholds;
    const probability = readNoulAnswer(input.answer, `${rule.id} answer for ${input.path}`);

    let outcome: ScanOutcome;
    let disposition: ScanDisposition;
    let reasoning: string;
    let confidence: number;

    if (input.missingEvidence.length > 0) {
        outcome = 'insufficient_context';
        disposition = 'unresolved';
        confidence = 0;
        reasoning = `required evidence was not supplied: ${input.missingEvidence.join(', ')}`;
    } else if (probability >= fire) {
        outcome = 'signal';
        disposition = 'recommend_investigation';
        confidence = probability;
        reasoning = `yes probability ${probability.toFixed(3)} is at or above ${String(fire)}`;
    } else {
        // Below the threshold is an ordinary no. The value is still reported, so a reader can see a
        // near miss without the report inventing a third state for it.
        outcome = 'no_signal';
        disposition = 'no_additional_recommendation';
        confidence = 1 - probability;
        reasoning = `yes probability ${probability.toFixed(3)} is below ${String(fire)}`;
    }

    return {
        ruleId: rule.id,
        unitId: input.unitId,
        path: input.path,
        outcome,
        probability,
        confidence,
        disposition,
        investigationCategory: rule.investigationCategory,
        missingEvidence: input.missingEvidence,
        reasoning,
    };
}

export const VERIFICATION_DISPOSITIONS = [
    /** Evidence supports further validation; publication is not authorized by this. */
    'ready_for_orchestrator_validation',
    /** Missing or uncertain context prevents a useful conclusion. */
    'needs_more_evidence',
    /** The assessment conflicts with the candidate finding. */
    'disputed',
    /** The issue appears unrelated to the introduced change. */
    'pre_existing_issue',
    /** The finding may not establish behavioral or contractual harm. */
    'possible_style_only',
] as const;

export type VerificationDisposition = (typeof VERIFICATION_DISPOSITIONS)[number];

export const SUPPORT_OUTCOMES = ['supported', 'contradicted', 'insufficient_context'] as const;
export type SupportOutcome = (typeof SUPPORT_OUTCOMES)[number];

export const ATTRIBUTION_OUTCOMES = ['introduced_by_change', 'pre_existing', 'undetermined'] as const;
export type AttributionOutcome = (typeof ATTRIBUTION_OUTCOMES)[number];

export const FINDING_KIND_OUTCOMES = ['behavioral_or_contract_issue', 'style_preference', 'undetermined'] as const;
export type FindingKindOutcome = (typeof FINDING_KIND_OUTCOMES)[number];

export {
    VERIFICATION_ATTRIBUTION_THRESHOLD,
    VERIFICATION_KIND_THRESHOLD,
    VERIFICATION_SUPPORT_THRESHOLD,
} from './rules.ts';

export type FindingAssessment = {
    readonly findingId: string;
    readonly support: {
        readonly outcome: SupportOutcome;
        readonly probabilities: Readonly<Record<SupportOutcome, number>>;
        readonly confidence: number;
    };
    readonly attribution: {
        readonly outcome: AttributionOutcome;
        readonly probabilities: Readonly<Record<AttributionOutcome, number>>;
        readonly confidence: number;
    };
    readonly kind: {
        readonly outcome: FindingKindOutcome;
        readonly probabilities: Readonly<Record<FindingKindOutcome, number>>;
        readonly confidence: number;
    };
    readonly disposition: VerificationDisposition;
    /** A disputed severe finding stays visible instead of being silently discarded. */
    readonly escalate: boolean;
    readonly strongestEvidenceIds: readonly string[];
    readonly reasoning: string;
};

/**
 * Which dispositions count as severe for escalation. A disputed finding in one of these categories is
 * returned to the orchestrator rather than dropped; a pre-existing issue stays visible for handling
 * under repository ownership rules and is never relabelled as introduced by the change.
 */
const SEVERE_CATEGORIES: ReadonlySet<string> = new Set(SEVERE_INVESTIGATION_CATEGORIES);

export function interpretFinding(input: {
    findingId: string;
    severityCategory: string | undefined;
    /** Referenced regions that were withheld or unavailable. Attribution cannot be decided without them. */
    missingEvidence?: readonly string[];
    answers: {
        support: unknown;
        attribution: unknown;
        kind: unknown;
    };
    strongestEvidenceIds: readonly string[];
}): FindingAssessment {
    const label = `finding ${input.findingId}`;
    const support = readChoiceAnswer(input.answers.support, SUPPORT_OUTCOMES, `${label} evidence support`);
    const attribution = readChoiceAnswer(input.answers.attribution, ATTRIBUTION_OUTCOMES, `${label} attribution`);
    const kind = readChoiceAnswer(input.answers.kind, FINDING_KIND_OUTCOMES, `${label} finding kind`);

    const supportOutcome = support.selected as SupportOutcome;
    const attributionOutcome = attribution.selected as AttributionOutcome;
    const kindOutcome = kind.selected as FindingKindOutcome;

    const supportProbabilities = support.probabilities as Record<SupportOutcome, number>;
    const attributionProbabilities = attribution.probabilities as Record<AttributionOutcome, number>;
    const kindProbabilities = kind.probabilities as Record<FindingKindOutcome, number>;

    let disposition: VerificationDisposition;
    let reasoning: string;

    const missing = input.missingEvidence ?? [];

    if (missing.length > 0) {
        // Attribution cannot be decided without the side it compares against, so a dropped region
        // outranks any threshold rather than being a note beside an advancing disposition.
        disposition = 'needs_more_evidence';
        reasoning = `referenced evidence was not supplied: ${missing.join(', ')}`;
    } else if (
        supportOutcome === 'contradicted' &&
        supportProbabilities.contradicted >= VERIFICATION_SUPPORT_THRESHOLD
    ) {
        disposition = 'disputed';
        reasoning = `supplied evidence contradicts the claim at ${supportProbabilities.contradicted.toFixed(3)}`;
    } else if (
        attributionOutcome === 'pre_existing' &&
        attributionProbabilities.pre_existing >= VERIFICATION_ATTRIBUTION_THRESHOLD
    ) {
        disposition = 'pre_existing_issue';
        reasoning = `the issue appears pre-existing at ${attributionProbabilities.pre_existing.toFixed(3)}`;
    } else if (
        kindOutcome === 'style_preference' &&
        kindProbabilities.style_preference >= VERIFICATION_KIND_THRESHOLD
    ) {
        disposition = 'possible_style_only';
        reasoning = `the finding may be style rather than behavioral or contractual at ${kindProbabilities.style_preference.toFixed(3)}`;
    } else if (
        supportProbabilities.supported >= VERIFICATION_SUPPORT_THRESHOLD &&
        attributionProbabilities.introduced_by_change >= VERIFICATION_ATTRIBUTION_THRESHOLD
    ) {
        disposition = 'ready_for_orchestrator_validation';
        reasoning = 'evidence support and introduced-by-change attribution both cleared their thresholds';
    } else {
        disposition = 'needs_more_evidence';
        reasoning = 'the assessment is not decisive enough to advance or contradict the finding';
    }

    const escalate = disposition === 'disputed' && SEVERE_CATEGORIES.has(input.severityCategory ?? '');
    return {
        findingId: input.findingId,
        support: { outcome: supportOutcome, probabilities: supportProbabilities, confidence: support.confidence },
        attribution: {
            outcome: attributionOutcome,
            probabilities: attributionProbabilities,
            confidence: attribution.confidence,
        },
        kind: { outcome: kindOutcome, probabilities: kindProbabilities, confidence: kind.confidence },
        disposition,
        escalate,
        strongestEvidenceIds: [...input.strongestEvidenceIds],
        reasoning,
    };
}

/** The failure code a refused assessment carries, for the report's execution state. */
export function executionStateFor(failure: SemanticFailureCode): 'partial' | 'unavailable' {
    if (failure === 'budget_exhausted' || failure === 'context_collection_failed') {
        return 'partial';
    }
    return 'unavailable';
}
