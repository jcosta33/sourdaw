import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

type MixRecipe = ReturnType<typeof getMixRecipeCatalog>['recipes'][number];

/**
 * How many commands expanding the recipe adds to a batch: one `addDevice` for each insert step and
 * one `setDeviceParameter` for every authored parameter. This is the count `recipe.expand` holds
 * against the batch ceiling, so discovery can withhold a recipe the expander would refuse.
 */
export function countRecipeExpansionCommands(recipe: MixRecipe): number {
    return recipe.steps.reduce((total, step) => total + (step.kind === 'insert' ? 1 : 0) + step.parameters.length, 0);
}
