import {
    MIX_RECIPE_CATALOG_VERSION,
    MIX_RECIPE_DESCRIPTORS,
    MIX_RECIPE_ROLES,
    type MixRecipeCatalog,
} from '../../models/MixRecipe';

import { bassMixRecipes } from './bassMixRecipes';
import { busMixRecipes } from './busMixRecipes';
import { drumsMixRecipes } from './drumsMixRecipes';
import { guitarMixRecipes } from './guitarMixRecipes';
import { keysMixRecipes } from './keysMixRecipes';
import { masterMixRecipes } from './masterMixRecipes';
import { vocalMixRecipes } from './vocalMixRecipes';

/**
 * Assembles the authored role files into one versioned catalog.
 *
 * The declared descriptor and role lists travel with the recipes so a reader
 * can tell a vocabulary it does not cover from a vocabulary it covers and
 * happens to have no recipe for.
 */
export function buildMixRecipeCatalog(): MixRecipeCatalog {
    return {
        version: MIX_RECIPE_CATALOG_VERSION,
        descriptors: MIX_RECIPE_DESCRIPTORS,
        roles: MIX_RECIPE_ROLES,
        recipes: [
            ...vocalMixRecipes,
            ...drumsMixRecipes,
            ...bassMixRecipes,
            ...guitarMixRecipes,
            ...keysMixRecipes,
            ...busMixRecipes,
            ...masterMixRecipes,
        ],
    };
}
