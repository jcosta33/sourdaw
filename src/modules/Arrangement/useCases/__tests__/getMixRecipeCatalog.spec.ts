import { describe, expect, it } from 'vitest';

import { buildMixRecipeCatalog } from '#/modules/Arrangement/repositories/mixRecipes/mixRecipeCatalog';
import { getMixRecipeCatalog as getMixRecipeCatalogFromBarrel } from '#/modules/Arrangement/useCases';
import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases/getMixRecipeCatalog';

describe('getMixRecipeCatalog', () => {
    it('returns the catalog the repository builds', () => {
        expect(getMixRecipeCatalog()).toEqual(buildMixRecipeCatalog());
    });

    it('is reachable through the module contract barrel', () => {
        expect(getMixRecipeCatalogFromBarrel).toBe(getMixRecipeCatalog);
    });
});
