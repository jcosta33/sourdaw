import { describe, expect, it } from 'vitest';

import { buildMixRecipeCatalog } from '#/modules/Arrangement/repositories/mixRecipes/mixRecipeCatalog';
import { buildPresetMixRecipes } from '#/modules/Arrangement/services/buildPresetMixRecipes';
import { getMixRecipeCatalog as getMixRecipeCatalogFromBarrel } from '#/modules/Arrangement/useCases';
import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases/getMixRecipeCatalog';
import { getFactoryPresets } from '#/modules/Arrangement/useCases/soundPresetLibrary';

describe('getMixRecipeCatalog', () => {
    it('returns the catalog the repository builds, then the factory preset recipes after the authored ones', () => {
        const authored = buildMixRecipeCatalog();

        expect(getMixRecipeCatalog()).toEqual({
            ...authored,
            recipes: [...authored.recipes, ...buildPresetMixRecipes(getFactoryPresets())],
        });
    });

    it('is reachable through the module contract barrel', () => {
        expect(getMixRecipeCatalogFromBarrel).toBe(getMixRecipeCatalog);
    });
});
