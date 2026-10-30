import { describe, expect, it } from 'vitest';

import { MIX_RECIPE_DESCRIPTOR_TERMS } from '../../models/MixRecipe';
import { buildMixRecipeCatalog } from '../mixRecipes/mixRecipeCatalog';

const catalog = buildMixRecipeCatalog();
describe('authored drum transient recipes', () => {
    it('adds only tight and punchy shaper recipes and leaves the original drum recipes present', () => {
        const recipes = catalog.recipes.filter((recipe) =>
            recipe.steps.some((step) => step.deviceType === 'transient-shaper')
        );
        expect(recipes.map((r) => r.id)).toEqual(['drums-tight-transient', 'drums-punchy-transient']);
        expect(recipes.map((r) => ({ descriptor: r.descriptor, roles: r.roles, steps: r.steps }))).toEqual([
            {
                descriptor: 'tight',
                roles: ['drums'],
                steps: [
                    {
                        kind: 'insert',
                        deviceType: 'transient-shaper',
                        parameters: [{ paramId: 'sustainGain', minimum: 0.5, maximum: 0.75 }],
                    },
                ],
            },
            {
                descriptor: 'punchy',
                roles: ['drums'],
                steps: [
                    {
                        kind: 'insert',
                        deviceType: 'transient-shaper',
                        parameters: [{ paramId: 'attackGain', minimum: 1.25, maximum: 1.5 }],
                    },
                ],
            },
        ]);
        for (const id of ['drums-tight', 'drums-punchy']) {
            expect(catalog.recipes.find((r) => r.id === id)?.steps[0]?.deviceType).toBe('builtin-compressor');
        }
        expect(
            catalog.recipes
                .filter((r) => r.roles.includes('drums'))
                .some((r) => r.steps.some((s) => s.deviceType === 'faust-noise-gate'))
        ).toBe(false);
    });
    it('preserves the complete global vocabulary and leaves bare controlled unresolved', () => {
        expect(MIX_RECIPE_DESCRIPTOR_TERMS).toEqual({
            warm: ['warm', 'warmer', 'warmth'],
            bright: ['bright', 'brighter', 'brightness', 'crisp', 'crisper', 'less dark'],
            tight: ['tight', 'tighter', 'tighten'],
            punchy: ['punchy', 'punchier', 'punch', 'more punch'],
            wide: ['wide', 'wider', 'width', 'spread', 'more width'],
            intimate: ['intimate', 'more intimate', 'closer', 'up close'],
            dark: ['dark', 'darker', 'less bright', 'mellow', 'mellower'],
            airy: ['airy', 'airier', 'air', 'more air'],
            muddy: ['muddy', 'less muddy', 'mud', 'muddiness'],
            thin: ['thin', 'less thin', 'fuller', 'thicker'],
            glued: ['glued', 'glue', 'cohesive'],
            'lo-fi': ['lo-fi', 'lofi', 'lo fi'],
            vintage: ['vintage', 'retro'],
        });
        expect(Object.values(catalog.descriptorTerms).flat()).not.toContain('controlled');
    });
});
