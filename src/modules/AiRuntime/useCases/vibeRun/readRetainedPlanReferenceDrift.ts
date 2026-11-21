import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { type BriefReading } from '../../models/BriefReading';
import { type ProjectContext } from '../../models/ProjectContext';

/**
 * Why a reading's retained plan names something the project no longer has, or `null` while every
 * recipe it expands is still published and every track it plans is still in the project.
 */
export function readRetainedPlanReferenceDrift(reading: BriefReading, context: ProjectContext): string | null {
    const published = new Set(getMixRecipeCatalog().recipes.map((recipe) => recipe.id));
    const trackIds = new Set(context.tracks.map((track) => track.id));
    for (const batch of reading.plan.batches) {
        for (const target of batch.targets) {
            const missingRecipe = target.recipeIds.find((recipeId) => !published.has(recipeId));
            if (missingRecipe !== undefined) {
                return `The recipe "${missingRecipe}" this reading's plan uses is no longer published, so the reading no longer applies.`;
            }
            if (!trackIds.has(target.targetId)) {
                const name = reading.plan.trackNames[target.targetId] ?? target.targetId;
                return `The track "${name}" this reading's plan targets is no longer in the project, so the reading no longer applies.`;
            }
        }
    }
    return null;
}
