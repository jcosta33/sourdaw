import { type AgentRunPlanAudibleImpact } from '../models/AgentRun';

import { deriveMeasuredAudibleImpact } from './deriveMeasuredAudibleImpact';
import { type PredictedEvidence, derivePredictedAudibleImpact } from './derivePredictedAudibleImpact';

import type { MetricGoalState } from './metricGoalContractTypes';

/**
 * The claim of one persisted batch: its predictions with their verification when the request states
 * perceptual or comparative goals, else the observed-only measured claim, else null.
 */
export function deriveAudibleImpact(
    input: PredictedEvidence & { state: MetricGoalState | null | undefined }
): AgentRunPlanAudibleImpact | null {
    return derivePredictedAudibleImpact({ state: input.state, evidence: input }) ?? deriveMeasuredAudibleImpact(input);
}
