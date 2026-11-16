/** The logical step one recipe on one target forms inside a batch of recipe expansions. */
export function readRecipeStepId(recipe: { recipeId: string; targetId: string }): string {
    return `recipe:${recipe.recipeId}:${recipe.targetId}`;
}
