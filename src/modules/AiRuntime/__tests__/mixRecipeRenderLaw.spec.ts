import { describe, expect, it } from 'vitest';

import { type MixRecipe } from '#/modules/Arrangement/models/MixRecipe';
import { buildMixRecipeCatalog } from '#/modules/Arrangement/repositories/mixRecipes/mixRecipeCatalog';
import { type Track } from '#/modules/Arrangement/stores';
import { measureAgentScopeRender } from '#/modules/AudioAnalysis/useCases';

import { readRecipeExpectationTolerance } from '../useCases/metricHoldTolerances';
import { createTrack } from '../useCases/__tests__/trackFixture';

import { createAcceptanceRenderLaw } from './acceptanceRenderLaw';

const TEMPO = 120;
const BEATS = 8;
const SOURCE_POSITIONS = [0, 1, 2, 3] as const;

/** The devices the acceptance render law has a rule for; any other step makes a recipe unrenderable. */
const LAW_DEVICES = new Set(['builtin-eq', 'builtin-compressor', 'builtin-gain', 'builtin-stereo-widener']);

/**
 * The level and dynamics claims, the ones a compressor decides. The law's source is six partials, two
 * of its four positions mono, so its spectral and stereo figures cannot discriminate a recipe's claim.
 */
const DYNAMICS_METRICS = [
    'rms',
    'crestFactor',
    'dynamicRangeEstimate',
    'truePeak',
    'integratedLoudness',
    'shortTermLoudnessMax',
    'transientDensity',
] as const;

type DynamicsMetric = (typeof DYNAMICS_METRICS)[number];
type Stage = 'before' | 'after';

/**
 * Every non-drum recipe the law cannot render, by the first step it has no rule for. Asserted equal
 * to what the catalog holds, so a recipe the law can render never sits here unchecked.
 */
const UNRENDERABLE_RECIPES: Readonly<Record<string, string>> = {
    'vocal-bright': 'builtin-deesser',
    'vocal-intimate': 'builtin-reverb',
    'vocal-airy': 'builtin-deesser',
    'vocal-lo-fi': 'builtin-bitcrusher',
    'vocal-vintage': 'builtin-distortion',
    'bass-tight': 'builtin-filter',
    'bass-punchy': 'builtin-sidechain-compressor',
    'bass-lo-fi': 'builtin-bitcrusher',
    'bass-vintage': 'builtin-distortion',
    'guitar-wide': 'builtin-chorus',
    'guitar-intimate': 'builtin-reverb',
    'guitar-lo-fi': 'builtin-bitcrusher',
    'guitar-vintage': 'builtin-distortion',
    'keys-wide': 'builtin-autopan',
    'keys-intimate': 'builtin-reverb',
    'keys-lo-fi': 'builtin-bitcrusher',
    'keys-vintage': 'builtin-tremolo',
    'bus-intimate': 'builtin-reverb',
    'bus-lo-fi': 'builtin-bitcrusher',
    'bus-vintage': 'builtin-convolution-reverb',
    'master-tight': 'builtin-limiter',
    'master-lo-fi': 'builtin-bitcrusher',
    'master-vintage': 'builtin-distortion',
};

/**
 * The recipe's devices at their parameter midpoints, or before it runs: an edit step's device at the
 * values it starts with, an insert step's not yet there.
 */
function recipeTrack(recipe: MixRecipe | null, position: number, stage: Stage = 'after'): Track {
    const steps = (recipe?.steps ?? []).filter((step) => stage === 'after' || step.kind === 'edit');
    const devices = steps.map((step, index) => ({
        id: `device-${index}`,
        name: step.deviceType,
        type: step.deviceType,
        bypassed: false,
        parameterValues:
            stage === 'after'
                ? Object.fromEntries(
                      step.parameters.map((parameter) => [
                          parameter.paramId,
                          (parameter.minimum + parameter.maximum) / 2,
                      ])
                  )
                : {},
    }));
    return createTrack({ id: `track-${position}`, devices });
}

function measure(recipe: MixRecipe | null, position: number, stage: Stage = 'after') {
    const law = createAcceptanceRenderLaw({
        trackPosition: () => position,
        tempo: () => TEMPO,
        liveTracks: () => [],
        masterGain: () => 1,
    });
    const target = recipeTrack(recipe, position, stage);
    const buffer = law.renderTrack({
        targetTrackId: target.id,
        renderTracks: [target],
        startBeat: 0,
        endBeat: BEATS,
    });
    const entries = measureAgentScopeRender(buffer, DYNAMICS_METRICS);
    const value = (id: DynamicsMetric): number => {
        const entry = entries[id];
        if (entry?.status !== 'measured' || typeof entry.value !== 'number') {
            throw new Error(`${id} was not measured`);
        }
        return entry.value;
    };
    return Object.fromEntries(DYNAMICS_METRICS.map((id) => [id, value(id)])) as Record<DynamicsMetric, number>;
}

function isDynamicsMetric(metric: string): metric is DynamicsMetric {
    return (DYNAMICS_METRICS as readonly string[]).includes(metric);
}

function movedDirection(
    metric: DynamicsMetric,
    before: number,
    after: number,
    claimed: 'increase' | 'decrease' | 'hold'
): 'increase' | 'decrease' | 'hold' {
    if (claimed === 'hold') {
        const tolerance = readRecipeExpectationTolerance(metric, 'hold');
        if (tolerance.status === 'read' && Math.abs(after - before) <= tolerance.tolerance) {
            return 'hold';
        }
    }
    if (after > before) {
        return 'increase';
    }
    return after < before ? 'decrease' : 'hold';
}

function firstUnrenderableDevice(recipe: MixRecipe): string | null {
    return recipe.steps.find((step) => !LAW_DEVICES.has(step.deviceType))?.deviceType ?? null;
}

/** The threshold midpoint of the recipe's compressor, or `null` when no compressor decides its dynamics. */
function compressorThresholdDb(recipe: MixRecipe): number | null {
    const threshold = recipe.steps
        .find((step) => step.deviceType === 'builtin-compressor')
        ?.parameters.find((parameter) => parameter.paramId === 'comp-threshold');
    if (threshold === undefined) {
        return null;
    }
    return (threshold.minimum + threshold.maximum) / 2;
}

/**
 * Whether a claim is meant for a source. A compressor's crest and dynamic-range claims are meant for a
 * source whose peak reaches its threshold: a compressor reduces nothing below it, so a quieter source
 * cannot show the claim either way. Every other claim is meant for every source.
 */
function isMeantFor(recipe: MixRecipe, metric: DynamicsMetric, dryTruePeakDb: number): boolean {
    const thresholdDb = compressorThresholdDb(recipe);
    if (thresholdDb === null || (metric !== 'crestFactor' && metric !== 'dynamicRangeEstimate')) {
        return true;
    }
    return dryTruePeakDb > thresholdDb;
}

function dynamicsClaims(recipe: MixRecipe) {
    return recipe.metrics.filter(
        (claim): claim is typeof claim & { metric: DynamicsMetric } => isDynamicsMetric(claim.metric)
    );
}

/**
 * Claims no law source is meant for: every source's peak sits below the compressor threshold, so the
 * law cannot check them. Asserted equal to what the catalog holds, so no claim leaves the checked set
 * unnoticed.
 */
const CLAIMS_NO_LAW_SOURCE_DRIVES: readonly string[] = [];

describe('mix recipe metric claims against the acceptance render law', () => {
    // The drum recipes are left out: #6947 and the drums lane own their claims and their rows.
    const recipes = buildMixRecipeCatalog().recipes.filter((recipe) => !recipe.roles.includes('drums'));
    const claimed = recipes.filter(
        (recipe) => firstUnrenderableDevice(recipe) === null && dynamicsClaims(recipe).length > 0
    );
    const dry = new Map(SOURCE_POSITIONS.map((position) => [position, measure(null, position, 'before')]));
    const dryFigures = (position: (typeof SOURCE_POSITIONS)[number]) => {
        const figures = dry.get(position);
        if (figures === undefined) {
            throw new Error(`No dry render of source ${position}.`);
        }
        return figures;
    };
    const dryPeak = (position: (typeof SOURCE_POSITIONS)[number]): number => dryFigures(position).truePeak;

    it('names every recipe the law cannot render, and only those, with the device it has no rule for', () => {
        const unrenderable = Object.fromEntries(
            recipes.flatMap((recipe) => {
                const device = firstUnrenderableDevice(recipe);
                return device === null ? [] : [[recipe.id, device]];
            })
        );
        expect(unrenderable).toEqual(UNRENDERABLE_RECIPES);
    });

    it('names every claim no law source drives the compressor for, and only those', () => {
        const undriven = claimed.flatMap((recipe) =>
            dynamicsClaims(recipe)
                .filter((claim) => SOURCE_POSITIONS.every((position) => !isMeantFor(recipe, claim.metric, dryPeak(position))))
                .map((claim) => `${recipe.id}:${claim.metric}`)
        );
        expect(undriven).toEqual(CLAIMS_NO_LAW_SOURCE_DRIVES);
    });

    describe.each(SOURCE_POSITIONS)('on source %i at the parameter midpoints', (position) => {
        const rows = claimed
            .map((recipe) => ({
                recipe,
                claims: dynamicsClaims(recipe).filter((claim) => isMeantFor(recipe, claim.metric, dryPeak(position))),
            }))
            .filter((row) => row.claims.length > 0);

        it.each(rows.map((row) => [row.recipe.id, row] as const))(
            '%s moves every dynamics metric it claims the way it claims',
            (_id, { recipe, claims }) => {
                const before = recipe.steps.some((step) => step.kind === 'edit')
                    ? measure(recipe, position, 'before')
                    : dryFigures(position);
                const after = measure(recipe, position);
                expect(
                    claims.map((claim) => ({
                        metric: claim.metric,
                        moved: movedDirection(claim.metric, before[claim.metric], after[claim.metric], claim.direction),
                        before: before[claim.metric],
                        after: after[claim.metric],
                    }))
                ).toEqual(
                    claims.map((claim) => ({
                        metric: claim.metric,
                        moved: claim.direction,
                        before: before[claim.metric],
                        after: after[claim.metric],
                    }))
                );
            },
            120_000
        );
    });
});
