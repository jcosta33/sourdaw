/**
 * The questions one verify request asks, and the identity of that set.
 *
 * The static wording is digested separately from the scan rules because a verify report's
 * dispositions come from these questions, not from `SEMANTIC_RULES`; recording the scan digest on a
 * verify report named a question set that did not produce it.
 */

import { NO_EVIDENCE_ID, semanticDigest } from './contracts.ts';

import type { CandidateFinding } from './candidateFindings.ts';

/**
 * The static wording of the verification questions. Digested separately from the scan rules because a
 * verify report's dispositions come from these questions, not from `SEMANTIC_RULES`; recording the
 * scan digest on a verify report named a question set that did not produce it.
 */
const VERIFY_QUESTION_SPEC = {
    support: {
        instructions:
            'Does the supplied implementation evidence support the claim? The expected behavior is stated in the finding. Judge only from the supplied regions; reported observations are not verified execution.',
        criteria: {
            supported: 'The supplied evidence supports the claim and its expected behavior.',
            contradicted: 'The supplied evidence shows the claim is not correct as stated.',
            insufficient_context: 'The supplied evidence is not enough to decide.',
        },
    },
    attribution: {
        instructions:
            'Was the condition the claim describes introduced by the supplied change, or did it already exist at the before side?',
        criteria: {
            introduced_by_change: 'The after-side evidence shows the condition arising from the change.',
            pre_existing: 'The before-side evidence already shows the same condition.',
            undetermined: 'The supplied evidence cannot distinguish the two.',
        },
    },
    kind: {
        instructions:
            'Does the claim describe behavioral or contractual harm, or a style preference with no behavior or contract consequence?',
        criteria: {
            behavioral_or_contract_issue: 'The claim names behavior or a contract that changes.',
            style_preference: 'The claim is about presentation, naming, or preference only.',
            undetermined: 'The supplied evidence cannot decide.',
        },
    },
    strongestEvidence: {
        instructions: 'Which single supplied region is the strongest evidence for your answers above?',
    },
} as const;

/**
 * The identity of the questions a verify report's dispositions came from.
 *
 * The static spec is not enough: the questions actually sent interpolate each finding's claim and
 * expected behavior, and the evidence-selection labels are that finding's own ids. Digesting only the
 * spec made two different finding sets share one identity — and one sidecar path, so the second
 * silently overwrote the first.
 */
export function computeVerifyQuestionsDigest(findings: readonly CandidateFinding[]): string {
    return semanticDigest({
        spec: VERIFY_QUESTION_SPEC,
        findings: findings.map((finding) => ({
            findingId: finding.findingId,
            claim: finding.claim,
            expectedBehavior: finding.expectedBehavior,
            // Every field below reaches the model or changes a recorded disposition: the first three
            // are sent in the state, and the category drives `escalate`. Omitting them let two
            // materially different runs share one identity and one sidecar path.
            allegedFailureInputOrState: finding.allegedFailureInputOrState ?? null,
            allegedObservedBehavior: finding.allegedObservedBehavior ?? null,
            reproductionReferences: (finding.reproductionReferences ?? []).map(
                (reference) => `${reference.path}|${reference.note}|${String(reference.verifiedExecution)}`
            ),
            claimedImpactCategory: finding.claimedImpactCategory ?? null,
            evidenceReferences: finding.evidenceReferences.map((reference) => `${reference.side}:${reference.path}`),
        })),
    });
}

/** The questions one finding's request asks, shaped for the provider, with that finding's own labels. */
export function findingQuestions(finding: CandidateFinding, evidenceIds: readonly string[]): Record<string, unknown> {
    const selectionLabels: Record<string, string> = {
        [NO_EVIDENCE_ID]: 'No supplied region is the strongest evidence.',
    };
    for (const id of evidenceIds) {
        selectionLabels[id] = `Region ${id} is the strongest evidence for this finding.`;
    }
    return {
        support: {
            type: 'choice',
            instructions: `${VERIFY_QUESTION_SPEC.support.instructions} The claim is "${finding.claim}" and the expected behavior is "${finding.expectedBehavior}".`,
            criteria: VERIFY_QUESTION_SPEC.support.criteria,
        },
        attribution: {
            type: 'choice',
            instructions: VERIFY_QUESTION_SPEC.attribution.instructions,
            criteria: VERIFY_QUESTION_SPEC.attribution.criteria,
        },
        kind: {
            type: 'choice',
            instructions: VERIFY_QUESTION_SPEC.kind.instructions,
            criteria: VERIFY_QUESTION_SPEC.kind.criteria,
        },
        strongestEvidence: {
            type: 'choice',
            instructions: VERIFY_QUESTION_SPEC.strongestEvidence.instructions,
            criteria: selectionLabels,
        },
    };
}
