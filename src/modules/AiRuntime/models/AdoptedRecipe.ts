/** Which recipe a batch adopted and what it was adopted for: the provenance an approval shows. */
export type AdoptedRecipe = {
    recipeId: string;
    title: string;
    targetId: string;
    /**
     * Set only on a vibe-run batch: whether its parameter values were chosen from the target's
     * measured baselines or kept at the catalogue defaults. Absent everywhere else.
     */
    valueSource?: 'measurements' | 'catalogue-defaults';
};
