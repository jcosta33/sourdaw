import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';
import { digest } from '#/utils/canonicalDigest';

import { type ScheduledVibeRunBatch } from '../../models/VibeRunPlan';
import { type MetricGoal } from '../metricGoalContractTypes';

import { type VibeBatchPair, readVibeBatchPairs } from './readVibeBatchPairs';

type MixRecipeCatalog = ReturnType<typeof getMixRecipeCatalog>;

export type VibeBatchRecipeGoals =
    { status: 'read'; pairs: VibeBatchPair[]; goals: MetricGoal[] } | { status: 'refused'; reason: string };

/** A range the plan bound as silent for this target carries no goal: there is nothing to move there. */
function isSilentRange(batch: ScheduledVibeRunBatch, targetId: string, range: NonNullable<MetricGoal['range']>) {
    return (batch.silentRanges ?? []).some(
        (cell) => cell.targetId === targetId && digest(cell.range) === digest(range)
    );
}

/**
 * The objective each pair of a batch promises: every measurable expectation of its authored recipe,
 * on its own target, over each verification range the target is not silent over, judged across that pair's own step. A goal keeps the
 * index of the expectation it states, so admission can hold it to the catalog entry it came from.
 */
export function readVibeBatchRecipeGoals(input: {
    batch: ScheduledVibeRunBatch;
    catalog: MixRecipeCatalog;
    range: NonNullable<MetricGoal['range']>;
}): VibeBatchRecipeGoals {
    const metricIds = getAgentMeasurementMetricIds();
    const pairs = readVibeBatchPairs(input.batch);
    const goals: MetricGoal[] = [];
    for (const pair of pairs) {
        const recipe = input.catalog.recipes.find(
            (candidate) => candidate.id === pair.recipeId && candidate.origin === undefined
        );
        if (recipe === undefined) {
            return { status: 'refused', reason: `recipe ${pair.recipeId} is no longer an authored recipe` };
        }
        const recipeDigest = digest(recipe);
        for (const [expectationIndex, expectation] of recipe.metrics.entries()) {
            const metricId = metricIds.find((metric) => metric === expectation.metric);
            if (metricId === undefined) {
                continue;
            }
            for (const range of input.batch.verificationRanges ?? [input.range]) {
                if (isSilentRange(input.batch, pair.targetId, range)) {
                    continue;
                }
                goals.push({
                    goalId: `vibe:${input.batch.id}:${pair.targetId}:${pair.recipeId}:${String(expectationIndex)}:${digest(range)}`,
                    stepId: pair.stepId,
                    metricId,
                    band: expectation.band ?? null,
                    targetIds: [pair.targetId],
                    referenceTargetIds: [],
                    range,
                    relation: expectation.direction,
                    targetValue: null,
                    tolerance: 0,
                    source: {
                        kind: 'recipe',
                        recipeId: recipe.id,
                        catalogVersion: input.catalog.version,
                        recipeDigest,
                        expectationIndex,
                    },
                });
            }
        }
    }
    return { status: 'read', pairs, goals };
}
