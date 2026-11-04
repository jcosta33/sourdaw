/** Which recipe a batch adopted and what it was adopted for: the provenance an approval shows. */
export type AdoptedRecipe = {
    recipeId: string;
    title: string;
    targetId: string;
};
