import { type AdoptedRecipe } from '../../models/AdoptedRecipe';

const VALUE_SOURCE_PHRASES: Readonly<Record<NonNullable<AdoptedRecipe['valueSource']>, string>> = {
    measurements: 'values chosen from measurements',
    'catalogue-defaults': 'catalogue defaults',
};

/** How a recipe line says where its values came from; null for a recipe adopted outside a vibe run. */
export function describeRecipeValueSource(recipe: Pick<AdoptedRecipe, 'valueSource'>): string | null {
    return recipe.valueSource === undefined ? null : VALUE_SOURCE_PHRASES[recipe.valueSource];
}
