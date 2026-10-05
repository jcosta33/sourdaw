import { describe, expect, it } from 'vitest';

import { getPluginById } from '#/modules/Arrangement/models/DeviceParameter';
import { getPresetContractVersion } from '#/modules/Arrangement/models/GetPresetContractVersion';
import { MIX_RECIPE_ROLES } from '#/modules/Arrangement/models/MixRecipe';
import { type SoundPreset } from '#/modules/Arrangement/models/SoundPreset';
import { buildMixRecipeCatalog } from '#/modules/Arrangement/repositories/mixRecipes/mixRecipeCatalog';
import { buildPresetMixRecipes } from '#/modules/Arrangement/services/buildPresetMixRecipes';
import { getFactoryPresets, getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

function chainPreset(overrides: Partial<SoundPreset> = {}): SoundPreset {
    return {
        id: 'test-vocal-chain',
        name: 'Test Vocal Chain',
        category: 'fx',
        description: 'A two-device vocal chain.',
        trackKind: 'audio',
        devices: [
            { type: 'builtin-eq', name: 'EQ', parameterValues: { 'eq-low-gain': 2, 'eq-low-freq': 150 } },
            {
                type: 'builtin-compressor',
                name: 'Comp',
                parameterValues: { 'comp-threshold': -18, 'comp-ratio': 3 },
            },
        ],
        tags: ['vocal', 'glue'],
        author: 'Sourdaw',
        isFactory: true,
        ...overrides,
    };
}

describe('buildPresetMixRecipes', () => {
    it('publishes an effect chain as insert steps in chain order with each stored value as an exact window', () => {
        const preset = chainPreset();

        const [recipe] = buildPresetMixRecipes([preset]);

        expect(recipe).toMatchObject({
            id: 'preset:test-vocal-chain:glued',
            descriptor: 'glued',
            roles: ['vocal'],
            steps: [
                {
                    kind: 'insert',
                    deviceType: 'builtin-eq',
                    parameters: [
                        { paramId: 'eq-low-gain', minimum: 2, maximum: 2 },
                        { paramId: 'eq-low-freq', minimum: 150, maximum: 150 },
                    ],
                },
                {
                    kind: 'insert',
                    deviceType: 'builtin-compressor',
                    parameters: [
                        { paramId: 'comp-threshold', minimum: -18, maximum: -18 },
                        { paramId: 'comp-ratio', minimum: 3, maximum: 3 },
                    ],
                },
            ],
            origin: { kind: 'preset', presetId: 'test-vocal-chain', tags: ['vocal', 'glue'] },
            prerequisites: [],
            contraindications: [],
            metrics: [],
        });
        expect(recipe?.origin?.presetVersion).toBe(getPresetContractVersion(preset));
    });

    it('keeps the authored-character caveat in the recipe text', () => {
        const [recipe] = buildPresetMixRecipes([chainPreset({ tags: ['vocal', 'warm', 'tube'] })]);

        expect(recipe?.source).toContain('not proof of the algorithm');
        expect(recipe?.title).toContain('Factory preset');
    });

    // Red when a preset with no resolvable descriptor or no role is published anyway.
    it.each([
        ['tags that name no descriptor', chainPreset({ tags: ['vocal', 'channel-strip'] })],
        ['tags and a category that name no role', chainPreset({ tags: ['glue', 'compression'] })],
        ['only a corrective descriptor', chainPreset({ tags: ['vocal', 'thin', 'muddy'] })],
    ])('does not publish a preset with %s', (_label, preset) => {
        expect(buildPresetMixRecipes([preset])).toEqual([]);
    });

    it('takes a role from the category when the category is itself a role', () => {
        const recipes = buildPresetMixRecipes([chainPreset({ category: 'bass', tags: ['warm'] })]);

        expect(recipes.map((recipe) => recipe.roles)).toEqual([['bass']]);
    });

    it('publishes one recipe for each descriptor the tags name, under distinct ids', () => {
        const recipes = buildPresetMixRecipes([chainPreset({ tags: ['vocal', 'warm', 'vintage'] })]);

        expect(recipes.map((recipe) => recipe.id)).toEqual([
            'preset:test-vocal-chain:warm',
            'preset:test-vocal-chain:vintage',
        ]);
        expect(recipes[0]?.steps).toEqual(recipes[1]?.steps);
    });

    it.each([
        [
            'an instrument',
            chainPreset({
                devices: [{ type: 'builtin-drum-kit', name: 'Kit', parameterValues: { kit: 0 } }],
            }),
        ],
        [
            'an unknown device',
            chainPreset({ devices: [{ type: 'external-plugin', name: 'Ext', parameterValues: {} }] }),
        ],
        [
            'a parameter the device does not declare',
            chainPreset({
                devices: [{ type: 'builtin-eq', name: 'EQ', parameterValues: { 'eq-nonsense': 1 } }],
            }),
        ],
        [
            'a value outside its parameter bounds',
            chainPreset({
                devices: [{ type: 'builtin-eq', name: 'EQ', parameterValues: { 'eq-low-gain': 999 } }],
            }),
        ],
        [
            'a value its stepped parameter would snap to another setting',
            chainPreset({
                devices: [{ type: 'builtin-bitcrusher', name: 'Crush', parameterValues: { 'crush-bits': 1.4 } }],
            }),
        ],
        ['no devices', chainPreset({ devices: [] })],
    ])('does not publish a chain holding %s', (_label, preset) => {
        expect(buildPresetMixRecipes([preset])).toEqual([]);
    });

    // Red when the version stops fingerprinting the preset's stored values or its tags.
    it('changes the preset version when a stored value or a tag changes', () => {
        const base = chainPreset();
        const changedValue = chainPreset({
            devices: [
                base.devices[0]!,
                { ...base.devices[1]!, parameterValues: { 'comp-threshold': -12, 'comp-ratio': 3 } },
            ],
        });
        const changedTags = chainPreset({ tags: ['vocal', 'glue', 'smooth'] });

        const versions = [base, changedValue, changedTags].map(
            (preset) => buildPresetMixRecipes([preset])[0]?.origin?.presetVersion
        );

        expect(new Set(versions).size).toBe(3);
        expect(versions.every((version) => version?.startsWith('preset-v1:'))).toBe(true);
    });
});

describe('factory preset recipes', () => {
    const presetRecipes = getMixRecipeCatalog().recipes.filter((recipe) => recipe.origin !== undefined);

    it('publishes some factory chain presets', () => {
        expect(presetRecipes.length).toBeGreaterThan(0);
    });

    it('keeps preset recipes out of the authored catalog arrays', () => {
        expect(buildMixRecipeCatalog().recipes.filter((recipe) => recipe.origin !== undefined)).toEqual([]);
    });

    it('gives every preset recipe a unique id that cannot collide with an authored one', () => {
        const authoredIds = new Set(buildMixRecipeCatalog().recipes.map((recipe) => recipe.id));
        const ids = presetRecipes.map((recipe) => recipe.id);

        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.filter((id) => authoredIds.has(id))).toEqual([]);
        expect(ids.filter((id) => !id.startsWith('preset:'))).toEqual([]);
    });

    it('holds every stored value inside its parameter bounds, in one exact window', () => {
        const outside = presetRecipes.flatMap((recipe) =>
            recipe.steps.flatMap((step) =>
                step.parameters
                    .filter((target) => {
                        const declared = getPluginById(step.deviceType)?.parameters.find(
                            (parameter) => parameter.id === target.paramId
                        );
                        return (
                            declared === undefined ||
                            target.minimum !== target.maximum ||
                            target.minimum < declared.minValue ||
                            target.maximum > declared.maxValue
                        );
                    })
                    .map((target) => `${recipe.id}:${target.paramId}`)
            )
        );

        expect(outside).toEqual([]);
    });

    it('draws every roles list from the role vocabulary and every recipe from its own preset', () => {
        const presetsById = new Map(getFactoryPresets().map((preset) => [preset.id, preset]));
        const badRoles = presetRecipes.filter((recipe) =>
            recipe.roles.some((role) => !MIX_RECIPE_ROLES.includes(role))
        );
        const unknownPresets = presetRecipes.filter((recipe) => !presetsById.has(recipe.origin?.presetId ?? ''));
        const staleVersions = presetRecipes.filter((recipe) => {
            const preset = presetsById.get(recipe.origin?.presetId ?? '');
            return preset === undefined || getPresetContractVersion(preset) !== recipe.origin?.presetVersion;
        });

        expect(badRoles).toEqual([]);
        expect(unknownPresets).toEqual([]);
        expect(staleVersions).toEqual([]);
    });
});
