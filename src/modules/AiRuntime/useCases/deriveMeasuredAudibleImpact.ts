import { MAX_AUDIBLE_CLAIM_METRICS, type AgentRunPlanAudibleImpact } from '../models/AgentRun';

import { boundMeasurement, type DeriveMeasuredAudibleImpactInput } from './boundAudibleMeasurement';

export const AUDIBLE_CLAIM_TOO_LARGE_REASON = 'The measurement moved more figures than a plan can list.';

export const NO_MEASURED_CHANGE_REASON = 'The measured preview moved no figure, so the plan claims no audible change.';

export const UNDISPLAYED_MEASUREMENT_REASON =
    'The proofs measured figures the approval card does not show, so the plan does not list them.';

export const NO_AUDIBLE_CLAIM_REASON =
    'The application plans state changes but does not infer or claim that it listened to audio.';

export const UNBOUND_PREDICTION_REASON =
    'The request states perceptual or comparative goals, but no command batch is bound to them yet, so nothing is predicted.';

/**
 * The audible claim of one exact batch, listing only metrics whose compared change is not zero. A
 * card whose own preview is bound to the batch claims exactly what that card shows. A card with none
 * (a vibe-run batch) claims what its bound proofs measured, the latest figure of each target and
 * metric. A preview of another batch or revision never contributes, so a claim never describes a
 * change nobody measured.
 */
export function deriveMeasuredAudibleImpact(input: DeriveMeasuredAudibleImpactInput): AgentRunPlanAudibleImpact | null {
    const measurement = boundMeasurement(input);
    if (measurement === null) {
        return null;
    }
    if (measurement.metrics.length === 0) {
        return { status: 'not-claimed', reason: NO_MEASURED_CHANGE_REASON };
    }
    // Never truncated: a list that leaves figures out would claim less than the card shows as moved.
    if (measurement.metrics.length > MAX_AUDIBLE_CLAIM_METRICS) {
        return { status: 'not-claimed', reason: AUDIBLE_CLAIM_TOO_LARGE_REASON };
    }
    return {
        status: 'measured',
        revision: measurement.preview.revision,
        batchContentHash: measurement.preview.batchContentHash,
        metrics: measurement.metrics,
    };
}
