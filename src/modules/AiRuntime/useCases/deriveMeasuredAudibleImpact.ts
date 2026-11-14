import { type AgentRunMeasuredAudibleMetric, type AgentRunPlanAudibleImpact } from '../models/AgentRun';
import { type MeasuredPreview } from '../models/MeasuredPreview';

import { bindMeasuredPreviewToBatch } from './bindMeasuredPreviewToBatch';
import { OBJECTIVE_METRIC_UNITS, objectiveMetricProjection } from './objectiveMetricProjection';

import type { ObjectiveMetricId } from './metricGoalContractTypes';

export const NO_AUDIBLE_CLAIM_REASON =
    'The application plans state changes but does not infer or claim that it listened to audio.';

type MeasuredAudibleImpact = Extract<AgentRunPlanAudibleImpact, { status: 'measured' }>;

type DeriveMeasuredAudibleImpactInput = {
    envelope: Parameters<typeof bindMeasuredPreviewToBatch>[1];
    /** The preview the approval card carries, already bound to the persisted batch or absent. */
    snapshotPreview: MeasuredPreview | undefined;
    /** Every preview the metric-goal proofs hold, in the order the proofs were recorded. */
    proofPreviews: readonly MeasuredPreview[];
};

function isObjectiveMetricId(metricId: string): metricId is ObjectiveMetricId {
    return Object.hasOwn(OBJECTIVE_METRIC_UNITS, metricId);
}

function movedMetrics(preview: MeasuredPreview): AgentRunMeasuredAudibleMetric[] {
    return preview.targets.flatMap((target) =>
        Object.entries(target.deltas).flatMap(([metricId, delta]) => {
            if (delta?.status !== 'compared' || delta.delta === 0 || !isObjectiveMetricId(metricId)) {
                return [];
            }
            const baseline = objectiveMetricProjection(metricId, target.baseline[metricId]);
            const previewed = objectiveMetricProjection(metricId, target.preview[metricId]);
            if (baseline === null || previewed === null || delta.unit !== OBJECTIVE_METRIC_UNITS[metricId]) {
                return [];
            }
            return [
                {
                    targetId: target.targetId,
                    targetKind: target.targetKind,
                    metricId,
                    baseline,
                    preview: previewed,
                    delta: { value: delta.delta, unit: delta.unit },
                },
            ];
        })
    );
}

/**
 * The audible claim of one exact batch: the figures of the latest measurement bound to it, listing
 * only metrics whose compared change is not zero. A preview that measured another batch or revision
 * claims nothing, so a claim never describes a change nobody measured.
 */
export function deriveMeasuredAudibleImpact(input: DeriveMeasuredAudibleImpactInput): MeasuredAudibleImpact | null {
    const boundProofs = input.proofPreviews.flatMap((preview) => {
        const bound = bindMeasuredPreviewToBatch(preview, input.envelope);
        return bound === undefined ? [] : [bound];
    });
    const current = boundProofs.at(-1) ?? bindMeasuredPreviewToBatch(input.snapshotPreview, input.envelope);
    if (current === undefined) {
        return null;
    }
    const metrics = movedMetrics(current);
    if (metrics.length === 0) {
        return null;
    }
    return { status: 'measured', revision: current.revision, batchContentHash: current.batchContentHash, metrics };
}
