import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { CANONICAL_ROLE_TO_RECIPE_ROLE, type CanonicalRole } from './canonicalRoleFamilies';

type MixRecipe = ReturnType<typeof getMixRecipeCatalog>['recipes'][number];

/**
 * Whether a recipe serves a track of this canonical role. A drum-family track is served only by a
 * recipe whose declared drum parts name its role, so a kit-wide low shelf meant for the shells
 * never lands on a hi-hat or the overheads. A recipe declaring no parts, a track outside the drum
 * family, and an absent track (a bare role argument) are not narrowed.
 */
export function servesDrumPart(
    recipe: Pick<MixRecipe, 'drumParts'>,
    canonicalRole: CanonicalRole | undefined
): boolean {
    if (
        recipe.drumParts === undefined ||
        canonicalRole === undefined ||
        CANONICAL_ROLE_TO_RECIPE_ROLE[canonicalRole] !== 'drums'
    ) {
        return true;
    }
    return recipe.drumParts.some((part) => part === canonicalRole);
}
