import { type MixRecipeCatalog } from '../models/MixRecipe';
import { buildMixRecipeCatalog } from '../repositories/mixRecipes/mixRecipeCatalog';
import { buildPresetMixRecipes } from '../services/buildPresetMixRecipes';

import { getFactoryPresets } from './soundPresetLibrary';

/**
 * Reads the versioned mixing recipe catalog.
 *
 * Arrangement owns the mixing knowledge: the recipes are authored data in this
 * module, not something a caller supplies or a model produces. The factory
 * chain presets are published beside them as recipes of the same shape, after
 * the authored ones, each carrying an `origin` that names its preset. A planner
 * picks a recipe and adapts it to one source through this use case and never
 * reaches past it into the repository files. The catalog shape is private to
 * this module: a cross-module consumer names it as `ReturnType<typeof
 * getMixRecipeCatalog>` rather than importing the model type.
 */
export function getMixRecipeCatalog(): MixRecipeCatalog {
    const authored = buildMixRecipeCatalog();
    return { ...authored, recipes: [...authored.recipes, ...buildPresetMixRecipes(getFactoryPresets())] };
}
