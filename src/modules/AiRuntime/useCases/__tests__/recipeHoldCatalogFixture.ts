import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

type Catalog = ReturnType<typeof getMixRecipeCatalog>;

/** The wide recipes that carry the low-frequency stereo hold in a spec. */
const WIDE_RECIPE_IDS: readonly string[] = ['bass-wide', 'drums-wide'];

/**
 * The catalog with a low-frequency stereo hold on the bass and drums wide recipes. No authored recipe claims
 * that content (mixRecipeRenderLaw.spec.ts renders the widener's high-pass, which leaves content near its
 * crossover partly in the side), so a spec of how a hold is priced, admitted and printed reads the hold here.
 */
export function withLowFrequencyStereoHold(catalog: Catalog): Catalog {
    return { ...catalog, recipes: catalog.recipes.map(holdLowFrequencyStereoContent) };
}

function holdLowFrequencyStereoContent(recipe: Catalog['recipes'][number]): Catalog['recipes'][number] {
    if (!WIDE_RECIPE_IDS.includes(recipe.id)) {
        return recipe;
    }
    const others = recipe.metrics.filter((claim) => claim.metric !== 'lowFrequencyStereoContent');
    return { ...recipe, metrics: [...others, { metric: 'lowFrequencyStereoContent', direction: 'hold' }] };
}
