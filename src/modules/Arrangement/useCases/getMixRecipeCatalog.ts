import { type MixRecipeCatalog } from '../models/MixRecipe';
import { buildMixRecipeCatalog } from '../repositories/mixRecipes/mixRecipeCatalog';

/**
 * Reads the versioned mixing recipe catalog.
 *
 * Arrangement owns the mixing knowledge: the recipes are authored data in this
 * module, not something a caller supplies or a model produces. A planner picks
 * a recipe and adapts it to one source through this use case and never reaches
 * past it into the repository files. The catalog shape is private to this
 * module: a cross-module consumer names it as `ReturnType<typeof
 * getMixRecipeCatalog>` rather than importing the model type.
 */
export function getMixRecipeCatalog(): MixRecipeCatalog {
    return buildMixRecipeCatalog();
}
