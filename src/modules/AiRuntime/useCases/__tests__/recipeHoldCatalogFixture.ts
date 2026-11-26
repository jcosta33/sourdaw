import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

type Catalog = ReturnType<typeof getMixRecipeCatalog>;

/** The wide recipes that carry the low-frequency stereo hold in a spec. */
const WIDE_RECIPE_IDS: readonly string[] = ['bass-wide', 'drums-wide'];

/**
 * The catalog with a low-frequency stereo hold added to the bass and drums wide recipes. The authored
 * recipes claim only a width rise, because the widener's mono crossover does not keep a fundamental near
 * it centred (mixRecipeRenderLaw.spec.ts), so a spec of how a hold is priced, admitted and printed reads
 * the hold from this catalog instead of from a claim the render contradicts.
 */
export function withLowFrequencyStereoHold(catalog: Catalog): Catalog {
    return { ...catalog, recipes: catalog.recipes.map(holdLowFrequencyStereoContent) };
}

function holdLowFrequencyStereoContent(recipe: Catalog['recipes'][number]): Catalog['recipes'][number] {
    if (!WIDE_RECIPE_IDS.includes(recipe.id)) {
        return recipe;
    }
    return { ...recipe, metrics: [...recipe.metrics, { metric: 'lowFrequencyStereoContent', direction: 'hold' }] };
}
