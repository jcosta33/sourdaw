import { describe, expect, it } from 'vitest';

import {
    MIX_RECIPE_CATALOG_VERSION,
    MIX_RECIPE_DESCRIPTOR_EFFECTS,
    MIX_RECIPE_DESCRIPTOR_TERMS,
} from '../../models/MixRecipe';
import { getMixRecipeCatalog } from '../../useCases/getMixRecipeCatalog';
import { buildMixRecipeCatalog } from '../mixRecipes/mixRecipeCatalog';

const expected = [
    {
        id: 'vocal-controlled',
        role: 'vocal',
        device: 'builtin-compressor',
        metric: 'dynamicRangeEstimate',
        windows: [
            [-24, -16],
            [3, 5],
            [5, 12],
            [60, 120],
        ],
        conditions: ['phrase', 'rumble', 'contrast'],
    },
    {
        id: 'drums-controlled-gate',
        role: 'drums',
        device: 'faust-noise-gate',
        metric: 'rms',
        windows: [
            [-55, -30],
            [0.0002, 0.01],
            [0.02, 0.1],
            [0.05, 0.25],
        ],
        conditions: ['bleed', 'strikes', 'ghost notes'],
    },
    {
        id: 'bass-controlled',
        role: 'bass',
        device: 'builtin-compressor',
        metric: 'dynamicRangeEstimate',
        windows: [
            [-24, -16],
            [4, 6],
            [8, 20],
            [80, 160],
        ],
        conditions: ['played bass', 'rumble', 'lowest wanted notes'],
    },
    {
        id: 'guitar-controlled',
        role: 'guitar',
        device: 'builtin-compressor',
        metric: 'dynamicRangeEstimate',
        windows: [
            [-22, -14],
            [3, 5],
            [5, 15],
            [60, 120],
        ],
        conditions: ['rhythmic guitar', 'detector', 'articulation'],
    },
    {
        id: 'keys-controlled',
        role: 'keys',
        device: 'builtin-compressor',
        metric: 'dynamicRangeEstimate',
        windows: [
            [-22, -14],
            [3, 5],
            [5, 15],
            [60, 120],
        ],
        conditions: ['accompaniment', 'left-hand', 'hammer'],
    },
    {
        id: 'bus-controlled',
        role: 'bus',
        device: 'builtin-compressor',
        metric: 'dynamicRangeEstimate',
        windows: [
            [-18, -10],
            [2, 3],
            [20, 30],
            [150, 250],
            [6, 10],
        ],
        conditions: ['balance', 'softer passages', 'dominant source'],
    },
    {
        id: 'master-controlled',
        role: 'master',
        device: 'builtin-compressor',
        metric: 'dynamicRangeEstimate',
        windows: [
            [-14, -6],
            [2, 3],
            [25, 30],
            [150, 250],
            [6, 10],
        ],
        conditions: ['mix balance', 'program passages', 'peak ceiling'],
    },
] as const;

const parameterIds = {
    'builtin-compressor': ['comp-threshold', 'comp-ratio', 'comp-attack', 'comp-release'],
    'faust-noise-gate': ['threshold', 'attack', 'hold', 'release'],
} as const;

describe('controlled authored recipes', () => {
    it('adds exactly one real entry for each required core role, with its device, native-unit windows and conditional metric', () => {
        const controlled = buildMixRecipeCatalog().recipes.filter((recipe) => recipe.descriptor === 'controlled');
        expect(controlled.map((recipe) => recipe.id)).toEqual(expected.map((entry) => entry.id));

        for (const entry of expected) {
            const recipe = controlled.find((candidate) => candidate.id === entry.id);
            expect(recipe).toBeDefined();
            expect(recipe!.roles).toEqual([entry.role]);
            expect(recipe!.steps).toEqual([
                {
                    kind: 'insert',
                    deviceType: entry.device,
                    parameters: entry.windows.map(([minimum, maximum], index) => ({
                        paramId: [...parameterIds[entry.device], ...(entry.windows.length === 5 ? ['comp-knee'] : [])][
                            index
                        ],
                        minimum,
                        maximum,
                    })),
                },
            ]);
            expect(recipe!.metrics).toEqual([{ metric: entry.metric, direction: 'decrease' }]);
            const body = [...recipe!.prerequisites, ...recipe!.contraindications].join(' ').toLowerCase();
            for (const condition of entry.conditions) {
                expect(body).toContain(condition);
            }
        }
    });

    it('keeps the schema and all previous term and effect meanings', () => {
        expect(MIX_RECIPE_CATALOG_VERSION).toBe(2);
        expect(MIX_RECIPE_DESCRIPTOR_TERMS).toMatchObject({
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
            controlled: ['controlled'],
        });
        expect(
            Object.entries(MIX_RECIPE_DESCRIPTOR_EFFECTS)
                .filter(([, effect]) => effect === 'removes')
                .map(([name]) => name)
        ).toEqual(['muddy', 'thin']);
        expect(MIX_RECIPE_DESCRIPTOR_EFFECTS.controlled).toBe('produces');
    });

    it('publishes no preset-derived controlled recipe and retains every previous authored recipe body', () => {
        const authored = buildMixRecipeCatalog().recipes;
        const publicControlled = getMixRecipeCatalog().recipes.filter((recipe) => recipe.descriptor === 'controlled');
        expect(publicControlled.map((recipe) => recipe.id)).toEqual(expected.map((entry) => entry.id));
        expect(authored.filter((recipe) => recipe.descriptor !== 'controlled').map((recipe) => recipe.id)).toContain(
            'drums-tight'
        );
        expect(authored.find((recipe) => recipe.id === 'vocal-tight')?.steps).toEqual([
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -24, maximum: -16 },
                    { paramId: 'comp-ratio', minimum: 3, maximum: 5 },
                    { paramId: 'comp-attack', minimum: 5, maximum: 12 },
                    { paramId: 'comp-release', minimum: 60, maximum: 120 },
                    { paramId: 'comp-makeup', minimum: 2, maximum: 5 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 100, maximum: 140 },
                    { paramId: 'eq-low-gain', minimum: -4, maximum: -2 },
                ],
            },
        ]);
    });
});
