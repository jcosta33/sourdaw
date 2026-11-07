import { type ScheduledVibeRunBatch } from '../../models/VibeRunPlan';

/** One recipe on one target of a batch: one logical step, in the order the batch expands them. */
export type VibeBatchPair = { readonly recipeId: string; readonly targetId: string; readonly stepId: string };

/** Every recipe of every target, target by target, each as the step its own expansion is judged across. */
export function readVibeBatchPairs(batch: ScheduledVibeRunBatch): VibeBatchPair[] {
    return batch.targets.flatMap((target) =>
        target.recipeIds.map((recipeId) => ({
            recipeId,
            targetId: target.targetId,
            stepId: `recipe:${recipeId}:${target.targetId}`,
        }))
    );
}
