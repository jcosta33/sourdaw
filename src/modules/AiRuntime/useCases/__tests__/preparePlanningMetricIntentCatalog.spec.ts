import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { type RunnableAiBackend } from '../../models/LlmOrchestrationTypes';
import { getProjectContext } from '../getProjectContext';
import { prepareAnswerInterpretationCatalog } from '../prepareAnswerInterpretationCatalog';
import { type MetricIntentCatalog, prepareMetricIntentCatalog } from '../prepareMetricIntentCatalog';
import { preparePlanningMetricIntentCatalog } from '../preparePlanningMetricIntentCatalog';

import { createPlanningProject } from './planningProjectFixture';

registerDeviceEnginePorts();

const chain = vi.hoisted(() => ({ value: [] as RunnableAiBackend[] }));
vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({ getBackendChain: () => chain.value }));

beforeEach(() => {
    chain.value = ['webllm'];
});

function prepareInput(prompt: string, trackNames: readonly string[] = []) {
    const base = createPlanningProject(getProjectContext(), 5);
    const context = {
        ...base,
        tracks: base.tracks.map((track, index) => ({ ...track, name: trackNames[index] ?? track.name })),
    };
    return { prompt, answer: prepareAnswerInterpretationCatalog({ prompt, context, projectRevision: 'revision-1' }) };
}

function recipeIds(catalog: MetricIntentCatalog): string[] {
    return catalog.objectives.flatMap((objective) => {
        const source = objective.goals[0]?.source;
        return source?.kind === 'recipe' ? [source.recipeId] : [];
    });
}

/** Every objective but the recipe ones, without the enum ids a removed recipe objective renumbers. */
function otherObjectives(catalog: MetricIntentCatalog) {
    return catalog.objectives
        .filter((objective) => objective.goals[0]?.source.kind !== 'recipe')
        .map(({ id: _id, ...objective }) => objective);
}

/** The authored recipes of these descriptors the full catalog offers as objectives, in catalog order. */
function fullRecipeIdsOf(full: MetricIntentCatalog, descriptors: readonly string[]): string[] {
    const byId = new Map(getMixRecipeCatalog().recipes.map((recipe) => [recipe.id, recipe.descriptor]));
    return recipeIds(full).filter((id) => descriptors.includes(byId.get(id) ?? ''));
}

describe('preparePlanningMetricIntentCatalog', () => {
    it('publishes the full catalog byte for byte to a hosted request', () => {
        chain.value = ['cloud'];
        const input = prepareInput('tame the harshness on the lead vocal');
        expect(JSON.stringify(preparePlanningMetricIntentCatalog(input))).toBe(
            JSON.stringify(prepareMetricIntentCatalog(input))
        );
        expect(recipeIds(preparePlanningMetricIntentCatalog(input)).length).toBeGreaterThan(0);
    });

    it.each([
        { prompt: 'make the vocal warmer', descriptors: ['warm'] },
        { prompt: 'make the lead vocal brighter than the snare', descriptors: ['bright'] },
        { prompt: 'make the chorus wider and tame the harshness on the lead vocal', descriptors: ['wide'] },
        { prompt: 'make the keys less bright and a bit punchier', descriptors: ['dark', 'punchy'] },
    ])(
        'offers a local $prompt request every recipe objective of $descriptors and no other',
        ({ prompt, descriptors }) => {
            const input = prepareInput(prompt);
            const local = preparePlanningMetricIntentCatalog(input);
            const full = prepareMetricIntentCatalog(input);
            const expected = fullRecipeIdsOf(full, descriptors);
            expect(expected.length).toBeGreaterThan(0);
            expect(recipeIds(local)).toEqual(expected);
            expect(otherObjectives(local)).toEqual(otherObjectives(full));
            expect(local.objectives.map((objective) => objective.id)).toEqual(
                local.objectives.map((_objective, index) => `o${String(index)}`)
            );
        }
    );

    it('offers a local request naming no descriptor term no recipe objective, keeping every other one', () => {
        const input = prepareInput('tame the harshness on the lead vocal');
        const local = preparePlanningMetricIntentCatalog(input);
        expect(recipeIds(local)).toEqual([]);
        expect(otherObjectives(local)).toEqual(otherObjectives(prepareMetricIntentCatalog(input)));
    });

    it('reads no descriptor inside a track name', () => {
        const local = preparePlanningMetricIntentCatalog(prepareInput('turn Warm Pad down 2 dB', ['Warm Pad']));
        expect(recipeIds(local)).toEqual([]);
    });
});
