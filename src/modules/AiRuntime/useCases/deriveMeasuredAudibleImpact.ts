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

function claimOf(preview: MeasuredPreview, metrics: AgentRunMeasuredAudibleMetric[]): MeasuredAudibleImpact | null {
    if (metrics.length === 0) {
        return null;
    }
    return { status: 'measured', revision: preview.revision, batchContentHash: preview.batchContentHash, metrics };
}

/** Metrics of every bound proof, a later proof replacing an earlier figure of the same target and metric. */
function mergeProofMetrics(proofs: readonly MeasuredPreview[]): AgentRunMeasuredAudibleMetric[] {
    const latest = new Map<string, AgentRunMeasuredAudibleMetric>();
    for (const proof of proofs) {
        for (const metric of movedMetrics(proof)) {
            latest.set(`${metric.targetId}\u0000${metric.metricId}`, metric);
        }
    }
    return [...latest.values()];
}

/**
 * The audible claim of one exact batch, listing only metrics whose compared change is not zero. A
 * card whose own preview is bound to the batch claims exactly what that card shows. A card with none
 * (a vibe-run batch) claims what its bound proofs measured, the latest figure of each target and
 * metric. A preview of another batch or revision never contributes, so a claim never describes a
 * change nobody measured.
 */
export function deriveMeasuredAudibleImpact(input: DeriveMeasuredAudibleImpactInput): MeasuredAudibleImpact | null {
    const snapshot = bindMeasuredPreviewToBatch(input.snapshotPreview, input.envelope);
    if (snapshot !== undefined) {
        return claimOf(snapshot, movedMetrics(snapshot));
    }
    const boundProofs = input.proofPreviews.flatMap((preview) => {
        const bound = bindMeasuredPreviewToBatch(preview, input.envelope);
        return bound === undefined ? [] : [bound];
    });
    const latestProof = boundProofs.at(-1);
    return latestProof === undefined ? null : claimOf(latestProof, mergeProofMetrics(boundProofs));
}
