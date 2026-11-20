import { describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { type Track } from '#/modules/Arrangement/stores';
import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { measureAgentScopeRender } from '#/modules/AudioAnalysis/useCases';

import { createTrack } from '../useCases/__tests__/trackFixture';

import { createAcceptanceRenderLaw } from './acceptanceRenderLaw';

registerDeviceEnginePorts();

type MixRecipe = ReturnType<typeof getMixRecipeCatalog>['recipes'][number];

const TEMPO = 120;
const BEATS = 8;
const SOURCE_POSITIONS = [0, 1, 2, 3] as const;

function recipeTrack(recipe: MixRecipe | null, position: number): Track {
    const devices = (recipe?.steps ?? []).map((step, index) => ({
        id: `device-${index}`,
        name: step.deviceType,
        type: step.deviceType,
        bypassed: false,
        parameterValues: Object.fromEntries(
            step.parameters.map((parameter) => [parameter.paramId, (parameter.minimum + parameter.maximum) / 2])
        ),
    }));
    return createTrack({ id: `track-${position}`, devices });
}

function measure(recipe: MixRecipe | null, position: number) {
    const law = createAcceptanceRenderLaw({
        trackPosition: () => position,
        tempo: () => TEMPO,
        liveTracks: () => [],
        masterGain: () => 1,
    });
    const target = recipeTrack(recipe, position);
    const buffer = law.renderTrack({
        targetTrackId: target.id,
        renderTracks: [target],
        startBeat: 0,
        endBeat: BEATS,
    });
    const entries = measureAgentScopeRender(buffer, ['crestFactor', 'dynamicRangeEstimate']);
    const value = (id: 'crestFactor' | 'dynamicRangeEstimate'): number => {
        const entry = entries[id];
        if (entry?.status !== 'measured' || typeof entry.value !== 'number') {
            throw new Error(`${id} was not measured`);
        }
        return entry.value;
    };
    return { crestFactor: value('crestFactor'), dynamicRangeEstimate: value('dynamicRangeEstimate') };
}

type DynamicsMetric = 'crestFactor' | 'dynamicRangeEstimate';

function movedDirection(before: number, after: number): 'increase' | 'decrease' | 'hold' {
    if (after > before) {
        return 'increase';
    }
    return after < before ? 'decrease' : 'hold';
}

describe('mix recipe metric claims against the acceptance render law', () => {
    const drumsTight = getMixRecipeCatalog().recipes.find((recipe) => recipe.id === 'drums-tight');

    it.each(SOURCE_POSITIONS)(
        'drums-tight moves every dynamics metric it claims the way it claims, on source %i at its parameter midpoints',
        (position) => {
            if (drumsTight === undefined) {
                throw new Error('The catalog holds no drums-tight recipe.');
            }
            const before = measure(null, position);
            const after = measure(drumsTight, position);
            const claims = drumsTight.metrics.filter(
                (claim): claim is typeof claim & { metric: DynamicsMetric } =>
                    claim.metric === 'crestFactor' || claim.metric === 'dynamicRangeEstimate'
            );
            expect(claims.length).toBeGreaterThan(0);
            expect(
                claims.map((claim) => ({
                    metric: claim.metric,
                    moved: movedDirection(before[claim.metric], after[claim.metric]),
                }))
            ).toEqual(claims.map((claim) => ({ metric: claim.metric, moved: claim.direction })));
        },
        120_000
    );
});
