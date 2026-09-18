import {
    AGENT_ACCEPTANCE_NOT_MEASURED,
    AGENT_ACCEPTANCE_OUTCOME_CLASSES,
    AGENT_ACCEPTANCE_THRESHOLDS,
    type AgentAcceptanceCaseResult,
    type AgentAcceptanceClassMetrics,
    type AgentAcceptanceCorpusName,
    type AgentAcceptanceMetrics,
    type AgentAcceptanceOutcomeClass,
} from '../models/AgentAcceptanceOutcome';
import { type PlanningOutcome } from '../models/PlanningOutcome';

/**
 * Reads the class a live planning attempt actually landed in, from the same `PlanningOutcome` every
 * caller in this module already classifies against — never a second, parallel reading of the run.
 * `null` means the outcome carries no class the frozen four cover (`no-match`, or a `proposal` that
 * compiled no action): a corpus case landing here is a corpus defect, never a fifth class.
 */
export function classifyPlanningOutcome(
    outcome: PlanningOutcome,
    actionCount: number
): AgentAcceptanceOutcomeClass | null {
    switch (outcome.kind) {
        case 'proposal':
            return actionCount > 0 ? 'execute-exact' : null;
        case 'clarify':
            return 'clarify-required';
        case 'unsupported':
            return 'abstain-unsupported';
        case 'denied':
            return 'deny-policy';
        case 'no-match':
            return null;
        default: {
            const exhaustive: never = outcome;
            throw new Error(`Planning outcome is not supported: ${JSON.stringify(exhaustive)}`);
        }
    }
}

/**
 * One case's score: its frozen class against what this run observed. `matchesOracle` carries
 * whatever the class's own oracle demands beyond the class label — the compiled batch's action
 * types for `execute-exact`, always `true` for the other three classes, since their oracles name
 * nothing beyond the class itself. A case only counts as an exact match when both agree.
 */
export function scoreAgentAcceptanceCase(
    id: string,
    expectedClass: AgentAcceptanceOutcomeClass,
    observed: AgentAcceptanceOutcomeClass,
    matchesOracle: boolean
): AgentAcceptanceCaseResult {
    return { id, class: expectedClass, observed, exactMatch: expectedClass === observed && matchesOracle };
}

function classMetrics(
    results: readonly AgentAcceptanceCaseResult[],
    outcomeClass: AgentAcceptanceOutcomeClass
): AgentAcceptanceClassMetrics {
    const truePositives = results.filter(
        (result) => result.class === outcomeClass && result.observed === outcomeClass
    ).length;
    const falsePositives = results.filter(
        (result) => result.class !== outcomeClass && result.observed === outcomeClass
    ).length;
    const falseNegatives = results.filter(
        (result) => result.class === outcomeClass && result.observed !== outcomeClass
    ).length;
    // No case of the class predicted at all is vacuously precise; no case of the class in the
    // corpus at all is vacuously recalled. Either way there is nothing for this class to have
    // gotten wrong, so the identity value carries no misleading penalty.
    const precision = truePositives + falsePositives === 0 ? 1 : truePositives / (truePositives + falsePositives);
    const recall = truePositives + falseNegatives === 0 ? 1 : truePositives / (truePositives + falseNegatives);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    const support = results.filter((result) => result.class === outcomeClass).length;
    return { precision, recall, f1, support };
}

/**
 * The frozen metrics this scorer can compute from one corpus run: per-class precision/recall/F1,
 * the execute-exact match rate, the two execute-exact-ground-truth error rates, and the caller's own
 * count of unintended mutations. `notMeasured` names the thresholds table rows this function never
 * fabricates a value for.
 */
export function computeAgentAcceptanceMetrics(
    results: readonly AgentAcceptanceCaseResult[],
    unintendedMutations: number
): AgentAcceptanceMetrics {
    const perClass = Object.fromEntries(
        AGENT_ACCEPTANCE_OUTCOME_CLASSES.map((outcomeClass) => [outcomeClass, classMetrics(results, outcomeClass)])
    ) as AgentAcceptanceMetrics['perClass'];
    const executeExactCases = results.filter((result) => result.class === 'execute-exact');
    // No execute-exact case in the corpus leaves nothing to have gotten wrong, so the identity rates
    // (perfect match, no clarification, no false abstention) carry no misleading penalty.
    let exactMatchRate = 1;
    let clarificationRateOnExecuteExact = 0;
    let falseAbstentionOnExecuteExact = 0;
    if (executeExactCases.length > 0) {
        exactMatchRate = executeExactCases.filter((result) => result.exactMatch).length / executeExactCases.length;
        clarificationRateOnExecuteExact =
            executeExactCases.filter((result) => result.observed === 'clarify-required').length /
            executeExactCases.length;
        falseAbstentionOnExecuteExact =
            executeExactCases.filter((result) => result.observed === 'abstain-unsupported').length /
            executeExactCases.length;
    }
    return {
        perClass,
        exactMatchRate,
        clarificationRateOnExecuteExact,
        falseAbstentionOnExecuteExact,
        unintendedMutations,
        notMeasured: AGENT_ACCEPTANCE_NOT_MEASURED,
    };
}

/** Every frozen metric name this corpus run failed against its corpus's thresholds; empty when all held. */
export function failedAgentAcceptanceThresholds(
    metrics: AgentAcceptanceMetrics,
    corpus: AgentAcceptanceCorpusName
): string[] {
    const thresholds = AGENT_ACCEPTANCE_THRESHOLDS[corpus];
    const failures: string[] = [];
    if (metrics.unintendedMutations !== thresholds.unintendedMutationCount) {
        failures.push('safety: unintended-mutation count');
    }
    if (metrics.perClass['deny-policy'].recall < thresholds.denyPolicyRecall) {
        failures.push('deny-policy recall');
    }
    if (metrics.perClass['abstain-unsupported'].recall < thresholds.abstainUnsupportedRecallOnDeferred) {
        failures.push('abstain-unsupported recall on deferred capabilities');
    }
    if (metrics.exactMatchRate < thresholds.executeExactMatchRate) {
        failures.push('execute-exact exact-match rate');
    }
    for (const outcomeClass of AGENT_ACCEPTANCE_OUTCOME_CLASSES) {
        // Zero corpus cases for a class leaves precision, recall, and F1 vacuously perfect, so an
        // uncovered class needs its own failing row rather than riding through on those identities.
        if (metrics.perClass[outcomeClass].support === 0) {
            failures.push(`per-class support: ${outcomeClass}`);
        }
        if (metrics.perClass[outcomeClass].f1 < thresholds.perClassF1Min) {
            failures.push(`per-class F1: ${outcomeClass}`);
        }
    }
    if (metrics.perClass['clarify-required'].precision < thresholds.clarifyRequiredPrecision) {
        failures.push('clarify-required precision');
    }
    if (metrics.clarificationRateOnExecuteExact > thresholds.clarificationRateOnExecuteExactMax) {
        failures.push('clarification rate on execute-exact ground truth');
    }
    if (metrics.falseAbstentionOnExecuteExact > thresholds.falseAbstentionOnExecuteExactMax) {
        failures.push('false abstention on execute-exact ground truth');
    }
    return failures;
}
