import { type AgentRunMeasuredAudibleMetric } from '../models/AgentRun';
import { type MeasuredPreview } from '../models/MeasuredPreview';

import { bindMeasuredPreviewToBatch } from './bindMeasuredPreviewToBatch';
import {
    OBJECTIVE_METRIC_CHANGE_UNITS,
    OBJECTIVE_METRIC_UNITS,
    objectiveMetricProjection,
} from './objectiveMetricProjection';

import type { ObjectiveMetricId } from './metricGoalContractTypes';

export type DeriveMeasuredAudibleImpactInput = {
    envelope: Parameters<typeof bindMeasuredPreviewToBatch>[1];
    /** The preview the approval card carries, already bound to the persisted batch or absent. */
    snapshotPreview: MeasuredPreview | undefined;
    /** Every preview the metric-goal proofs hold, in the order the proofs were recorded. */
    proofPreviews: readonly MeasuredPreview[];
};

function isObjectiveMetricId(metricId: string): metricId is ObjectiveMetricId {
    return Object.hasOwn(OBJECTIVE_METRIC_UNITS, metricId);
}

type MeasuredEntry = { key: string; compared: boolean; metric: AgentRunMeasuredAudibleMetric | null };

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
                return [{ key, compared: delta.status === 'compared', metric: null }];
            }
            return [
                {
                    key,
                    compared: true,
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

type MeasuredFigures = { metrics: AgentRunMeasuredAudibleMetric[]; comparedFigure: boolean };

function figuresOf(entries: Iterable<MeasuredEntry>): MeasuredFigures {
    const kept = [...entries];
    return {
        metrics: kept.flatMap((entry) => (entry.metric === null ? [] : [entry.metric])),
        comparedFigure: kept.some((entry) => entry.compared),
    };
}

/**
 * The latest bound proof's answer for each target, metric and range comes first, a held or
 * incomparable answer included, and only then are the metrics that moved kept.
 */
function mergeProofFigures(proofs: readonly MeasuredPreview[]): MeasuredFigures {
    const latest = new Map<string, MeasuredEntry>();
    for (const proof of proofs) {
        for (const entry of measuredEntries(proof)) {
            latest.set(entry.key, entry);
        }
    }
    return figuresOf(latest.values());
}

/**
 * The preview a claim is bound to and the metrics it lists, from the card's own preview or else the
 * bound proofs. `comparedFigure` tells a measurement that compared figures and moved none from one
 * that could compare no figure at all.
 */
export function boundMeasurement(
    input: DeriveMeasuredAudibleImpactInput
): ({ preview: MeasuredPreview } & MeasuredFigures) | null {
    const snapshot = bindMeasuredPreviewToBatch(input.snapshotPreview, input.envelope);
    if (snapshot !== undefined) {
        return { preview: snapshot, ...figuresOf(measuredEntries(snapshot)) };
    }
    const boundProofs = input.proofPreviews.flatMap((preview) => {
        const bound = bindMeasuredPreviewToBatch(preview, input.envelope);
        return bound === undefined ? [] : [bound];
    });
    const latestProof = boundProofs.at(-1);
    return latestProof === undefined ? null : { preview: latestProof, ...mergeProofFigures(boundProofs) };
}
