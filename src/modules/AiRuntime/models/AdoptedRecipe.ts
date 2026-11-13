/**
 * Which recipe a batch adopted and what it was adopted for: the provenance an approval shows. A
 * recipe published from a factory preset also records the preset version it was expanded from, so a
 * later request repeating the committed recipe can tell whether the preset still says the same.
 */
export type AdoptedRecipe = {
    recipeId: string;
    title: string;
    targetId: string;
    presetVersion?: string;
};
