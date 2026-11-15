import {
    MAX_AUDIBLE_CLAIM_METRICS,
    type AgentRunMeasuredAudibleMetric,
    type AgentRunPlanAudibleImpact,
} from '../models/AgentRun';
import { type MeasuredPreview } from '../models/MeasuredPreview';

import { bindMeasuredPreviewToBatch } from './bindMeasuredPreviewToBatch';
import {
    OBJECTIVE_METRIC_CHANGE_UNITS,
    OBJECTIVE_METRIC_UNITS,
    objectiveMetricProjection,
} from './objectiveMetricProjection';

import type { ObjectiveMetricId } from './metricGoalContractTypes';

export const AUDIBLE_CLAIM_TOO_LARGE_REASON =
    'The measurement moved more figures than a plan can list; the card shows them.';

export const NO_AUDIBLE_CLAIM_REASON =
    'The application plans state changes but does not infer or claim that it listened to audio.';

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

type MeasuredEntry = { key: string; metric: AgentRunMeasuredAudibleMetric | null };

/**
 * Every compared or incomparable entry a preview measured, keyed by target, metric and range. An
 * entry that did not move, cannot be compared or has a figure or change in another unit than its
 * metric definition fixes carries no metric, but still counts as that measurement's answer.
 */
function measuredEntries(preview: MeasuredPreview): MeasuredEntry[] {
    const { startBeat, endBeat, sectionId } = preview.range;
    const range = { startBeat, endBeat, sectionId };
    return preview.targets.flatMap((target) =>
        Object.entries(target.deltas).flatMap(([metricId, delta]): MeasuredEntry[] => {
            if (delta === undefined || !isObjectiveMetricId(metricId)) {
                return [];
            }
            const key = [target.targetId, metricId, startBeat, endBeat, sectionId ?? ''].join('\u0000');
            const baseline = objectiveMetricProjection(metricId, target.baseline[metricId]);
            const previewed = objectiveMetricProjection(metricId, target.preview[metricId]);
            if (
                delta.status !== 'compared' ||
                delta.delta === 0 ||
                baseline === null ||
                previewed === null ||
                delta.unit !== OBJECTIVE_METRIC_CHANGE_UNITS[metricId]
            ) {
                return [{ key, metric: null }];
            }
            return [
                {
                    key,
                    metric: {
                        targetId: target.targetId,
                        targetKind: target.targetKind,
                        range,
                        metricId,
                        baseline,
                        preview: previewed,
                        delta: { value: delta.delta, unit: delta.unit },
                    },
                },
            ];
        })
    );
}

function movedMetrics(preview: MeasuredPreview): AgentRunMeasuredAudibleMetric[] {
    return measuredEntries(preview).flatMap((entry) => (entry.metric === null ? [] : [entry.metric]));
}

function claimOf(preview: MeasuredPreview, metrics: AgentRunMeasuredAudibleMetric[]): AgentRunPlanAudibleImpact | null {
    if (metrics.length === 0) {
        return null;
    }
    // Never truncated: a list that leaves figures out would claim less than the card shows as moved.
    if (metrics.length > MAX_AUDIBLE_CLAIM_METRICS) {
        return { status: 'not-claimed', reason: AUDIBLE_CLAIM_TOO_LARGE_REASON };
    }
    return { status: 'measured', revision: preview.revision, batchContentHash: preview.batchContentHash, metrics };
}

/**
 * The latest bound proof's answer for each target, metric and range comes first, a held or
 * incomparable answer included, and only then are the metrics that moved kept.
 */
function mergeProofMetrics(proofs: readonly MeasuredPreview[]): AgentRunMeasuredAudibleMetric[] {
    const latest = new Map<string, AgentRunMeasuredAudibleMetric | null>();
    for (const proof of proofs) {
        for (const entry of measuredEntries(proof)) {
            latest.set(entry.key, entry.metric);
        }
    }
    return [...latest.values()].flatMap((metric) => (metric === null ? [] : [metric]));
}

/**
 * The audible claim of one exact batch, listing only metrics whose compared change is not zero. A
 * card whose own preview is bound to the batch claims exactly what that card shows. A card with none
 * (a vibe-run batch) claims what its bound proofs measured, the latest figure of each target and
 * metric. A preview of another batch or revision never contributes, so a claim never describes a
 * change nobody measured.
 */
export function deriveMeasuredAudibleImpact(input: DeriveMeasuredAudibleImpactInput): AgentRunPlanAudibleImpact | null {
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
