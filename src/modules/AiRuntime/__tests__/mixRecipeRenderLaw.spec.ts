import { describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { type Track } from '#/modules/Arrangement/stores';
import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { measureAgentScopeRender } from '#/modules/AudioAnalysis/useCases';

import { createTrack } from '../useCases/__tests__/trackFixture';
import { readRecipeExpectationTolerance } from '../useCases/metricHoldTolerances';
import { objectiveMetricProjection } from '../useCases/objectiveMetricProjection';

import { createAcceptanceRenderLaw } from './acceptanceRenderLaw';

registerDeviceEnginePorts();

type MixRecipe = ReturnType<typeof getMixRecipeCatalog>['recipes'][number];

const TEMPO = 120;
const BEATS = 8;

type LawSource = {
    name: string;
    /** The fixture position that fixes the source's spectrum, strike shape and base level. */
    position: number;
    /** Gain ahead of the recipe's devices, raising the source level without changing its shape. */
    trimDb: number;
};

/**
 * Positions 0 to 3 peak at about -8 dBFS or lower, where a compressor's makeup alone lifts a level. A bus
 * or a hot take peaks near 0 dBFS, where the same compressor lowers it, so the last source is the same
 * shape as position 3 trimmed up to about -1 dBFS: a level claim whose direction depends on input level
 * fails on it.
 */
const SOURCES: readonly LawSource[] = [
    { name: 'source 0', position: 0, trimDb: 0 },
    { name: 'source 1', position: 1, trimDb: 0 },
    { name: 'source 2', position: 2, trimDb: 0 },
    { name: 'source 3', position: 3, trimDb: 0 },
    { name: 'hot source', position: 3, trimDb: 9.3 },
];

/** The devices the acceptance render law has a rule for; any other step makes a recipe unrenderable. */
const LAW_DEVICES = new Set(['builtin-eq', 'builtin-compressor', 'builtin-gain', 'builtin-stereo-widener']);

type Claim = MixRecipe['metrics'][number];
type Figures = ReturnType<typeof measureAgentScopeRender>;
type Stage = 'before' | 'after';

/**
 * The level, dynamics and transient claims, the ones a compressor decides. The law's sources are six
 * partials, one per band, two of the four positions mono, so its spectral, band and stereo figures cannot
 * discriminate a recipe's claim and are not checked here.
 */
const CHECKED_METRICS = [
    'rms',
    'crestFactor',
    'dynamicRangeEstimate',
    'truePeak',
    'integratedLoudness',
    'shortTermLoudnessMax',
    'transientDensity',
] as const;

/**
 * Every recipe the law cannot render, by the first step it has no rule for. Asserted equal
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
    'drums-controlled-gate': 'faust-noise-gate',
    'drums-intimate': 'builtin-convolution-reverb',
    'drums-lo-fi': 'builtin-bitcrusher',
    'drums-punchy-transient': 'transient-shaper',
    'drums-tight-transient': 'transient-shaper',
    'drums-vintage': 'builtin-distortion',
    'preset:factory-faust-1176-drum-smash': 'faust-1176-compressor',
    'preset:factory-faust-1176-gentle-glue:glued': 'faust-1176-compressor',
    'preset:factory-faust-1176-vocal-control': 'faust-1176-compressor',
    'preset:factory-faust-tape-dub-delay:dark': 'faust-tape-delay',
    'preset:factory-faust-tape-slapback:vintage': 'faust-tape-delay',
    'preset:factory-faust-tape-space-echo': 'faust-tape-delay',
    'preset:factory-faust-zita-huge-hall': 'faust-zita-rev1-reverb',
    'preset:factory-faust-zita-tight-room:tight': 'faust-zita-rev1-reverb',
    'preset:factory-faust-zita-vocal-plate:bright': 'faust-zita-rev1-reverb',
    'preset:fx-chain-drum-punch:punchy': 'builtin-reverb',
    'preset:fx-chain-guitar-clean:warm': 'builtin-chorus',
    'preset:fx-chain-master-bus:glued': 'builtin-limiter',
    'preset:fx-chain-vocal-strip': 'builtin-reverb',
    'preset:fx-chorus-classic:warm': 'builtin-chorus',
    'preset:fx-chorus-slow-shimmer': 'builtin-chorus',
    'preset:fx-conv-cathedral': 'builtin-convolution-reverb',
    'preset:fx-conv-dark-tunnel:dark': 'builtin-convolution-reverb',
    'preset:fx-conv-plate-shimmer:bright': 'builtin-convolution-reverb',
    'preset:fx-conv-studio-room:tight': 'builtin-convolution-reverb',
    'preset:fx-conv-vintage-spring:vintage': 'builtin-convolution-reverb',
    'preset:fx-conv-warehouse': 'builtin-convolution-reverb',
    'preset:fx-creative-industrial': 'builtin-distortion',
    'preset:fx-creative-shimmer': 'builtin-reverb',
    'preset:fx-creative-space-echo': 'builtin-delay',
    'preset:fx-delay-dotted-eighth': 'builtin-delay',
    'preset:fx-delay-dub-echo': 'builtin-delay',
    'preset:fx-delay-ping-pong:wide': 'builtin-delay',
    'preset:fx-delay-slapback': 'builtin-delay',
    'preset:fx-dist-fuzz': 'builtin-distortion',
    'preset:fx-dist-warm-overdrive:warm': 'builtin-distortion',
    'preset:fx-flanger-jet': 'builtin-flanger',
    'preset:fx-leslie-sim': 'builtin-chorus',
    'preset:fx-lofi-retro-radio:lo-fi': 'builtin-bitcrusher',
    'preset:fx-lofi-retro-radio:vintage': 'builtin-bitcrusher',
    'preset:fx-lofi-vinyl:lo-fi': 'builtin-bitcrusher',
    'preset:fx-lofi-vinyl:vintage': 'builtin-bitcrusher',
    'preset:fx-phaser-slow-sweep': 'builtin-phaser',
    'preset:fx-rev-ambient-wash': 'builtin-reverb',
    'preset:fx-rev-gated-80s': 'builtin-reverb',
    'preset:fx-rev-large-hall': 'builtin-reverb',
    'preset:fx-rev-plate:bright': 'builtin-reverb',
    'preset:fx-rev-small-room:tight': 'builtin-reverb',
    'preset:fx-rev-spring:bright': 'builtin-reverb',
    'preset:fx-rev-spring:vintage': 'builtin-reverb',
    'preset:fx-trem-vintage:vintage': 'builtin-tremolo',
};

/**
 * The recipe's devices at their parameter midpoints, or before it runs: an edit step's device at the
 * values it starts with, an insert step's not yet there.
 */
function recipeTrack(recipe: MixRecipe | null, source: LawSource, stage: Stage = 'after'): Track {
    const steps = (recipe?.steps ?? []).filter((step) => stage === 'after' || step.kind === 'edit');
    const devices = steps.map((step, index) => ({
        id: `device-${index}`,
        name: step.deviceType,
        type: step.deviceType,
        bypassed: false,
        parameterValues: stagedParameterValues(step, stage),
    }));
    const trim = {
        id: 'source-trim',
        name: 'builtin-gain',
        type: 'builtin-gain',
        bypassed: false,
        parameterValues: { 'gain-level': source.trimDb },
    };
    return createTrack({ id: `track-${source.position}`, devices: source.trimDb === 0 ? devices : [trim, ...devices] });
}

/** A step's parameter midpoints once the recipe has run; before it, the device's own starting values. */
function stagedParameterValues(step: MixRecipe['steps'][number], stage: Stage): Record<string, number> {
    if (stage === 'before') {
        return {};
    }
    return Object.fromEntries(
        step.parameters.map((parameter) => [parameter.paramId, (parameter.minimum + parameter.maximum) / 2])
    );
}

function measure(recipe: MixRecipe | null, source: LawSource, stage: Stage = 'after') {
    const law = createAcceptanceRenderLaw({
        trackPosition: () => source.position,
        tempo: () => TEMPO,
        liveTracks: () => [],
        masterGain: () => 1,
    });
    const target = recipeTrack(recipe, source, stage);
    const buffer = law.renderTrack({
        targetTrackId: target.id,
        renderTracks: [target],
        startBeat: 0,
        endBeat: BEATS,
    });
    return measureAgentScopeRender(buffer, CHECKED_METRICS);
}

function isCheckedMetric(metric: string): boolean {
    return (CHECKED_METRICS as readonly string[]).includes(metric);
}

function checkedClaims(recipe: MixRecipe): readonly Claim[] {
    return recipe.metrics.filter((claim) => isCheckedMetric(claim.metric));
}

/** The figure a claim states, the frozen band's energy for a band claim. */
function figure(entries: Figures, claim: Claim): number {
    const projection = objectiveMetricProjection(claim.metric, entries[claim.metric], claim.band ?? null);
    if (projection === null) {
        throw new Error(`${claim.metric} ${claim.band ?? ''} was not measured`);
    }
    return projection.value;
}

function movedDirection(
    metric: Claim['metric'],
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
function isMeantFor(recipe: MixRecipe, metric: Claim['metric'], dryTruePeakDb: number): boolean {
    const thresholdDb = compressorThresholdDb(recipe);
    if (thresholdDb === null || (metric !== 'crestFactor' && metric !== 'dynamicRangeEstimate')) {
        return true;
    }
    return dryTruePeakDb > thresholdDb;
}

/**
 * Claims no law source is meant for: every source's peak sits below the compressor threshold, so the
 * law cannot check them. Asserted equal to what the catalog holds, so no claim leaves the checked set
 * unnoticed.
 */
const CLAIMS_NO_LAW_SOURCE_DRIVES: readonly string[] = [];

/**
 * Renderable recipes whose every stated move is a band, spectral or stereo one. The law's sources cannot
 * discriminate those, so the render spec checks none of them; asserted equal to what the catalog holds.
 * A recipe whose rationale makes a level or dynamics move the law renders states it and leaves this table.
 */
const RECIPES_WITH_NO_CHECKABLE_CLAIM: Readonly<Record<string, string>> = Object.fromEntries(
    [
        'vocal-warm',
        'vocal-tight',
        'vocal-wide',
        'vocal-dark',
        'vocal-muddy',
        'vocal-thin',
        'drums-warm',
        'drums-bright',
        'drums-tight',
        'drums-wide',
        'drums-dark',
        'drums-airy',
        'drums-muddy',
        'bass-warm',
        'bass-bright',
        'bass-wide',
        'bass-dark',
        'bass-airy',
        'bass-muddy',
        'guitar-warm',
        'guitar-bright',
        'guitar-tight',
        'guitar-dark',
        'guitar-airy',
        'guitar-muddy',
        'guitar-thin',
        'keys-warm',
        'keys-bright',
        'keys-tight',
        'keys-dark',
        'keys-airy',
        'keys-muddy',
        'keys-thin',
        'bus-warm',
        'bus-bright',
        'bus-tight',
        'bus-wide',
        'bus-dark',
        'bus-airy',
        'bus-muddy',
        'master-warm',
        'master-bright',
        'master-wide',
        'master-dark',
        'master-airy',
        'master-muddy',
    ].map((id) => [id, 'states only band, spectral or stereo moves'])
);

describe('mix recipe metric claims against the acceptance render law', () => {
    const recipes = getMixRecipeCatalog().recipes;
    const claimed = recipes.filter((recipe) => firstUnrenderableDevice(recipe) === null);
    const dry = new Map(SOURCES.map((source) => [source.name, measure(null, source, 'before')]));
    const dryFigures = (source: LawSource) => {
        const figures = dry.get(source.name);
        if (figures === undefined) {
            throw new Error(`No dry render of ${source.name}.`);
        }
        return figures;
    };
    const dryPeak = (source: LawSource): number =>
        figure(dryFigures(source), { metric: 'truePeak', direction: 'hold' });
    /** The figures before the recipe runs: the devices its edit steps change, or the dry source when it only inserts. */
    const beforeFigures = (recipe: MixRecipe, source: LawSource) => {
        if (recipe.steps.some((step) => step.kind === 'edit')) {
            return measure(recipe, source, 'before');
        }
        return dryFigures(source);
    };

    it('names every authored renderable recipe with no level, dynamics or transient claim, and only those', () => {
        const unchecked = claimed
            .filter((recipe) => recipe.origin === undefined && checkedClaims(recipe).length === 0)
            .map((recipe) => [recipe.id, 'states only band, spectral or stereo moves']);
        expect(Object.fromEntries(unchecked)).toEqual(RECIPES_WITH_NO_CHECKABLE_CLAIM);
    });

    it('states no metric for a factory preset recipe, so none is left unchecked', () => {
        const stated = claimed.filter((recipe) => recipe.origin !== undefined && recipe.metrics.length > 0);
        expect(stated.map((recipe) => recipe.id)).toEqual([]);
    });

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
            checkedClaims(recipe)
                .filter((claim) => SOURCES.every((source) => !isMeantFor(recipe, claim.metric, dryPeak(source))))
                .map((claim) => `${recipe.id}:${claim.metric}`)
        );
        expect(undriven).toEqual(CLAIMS_NO_LAW_SOURCE_DRIVES);
    });

    describe.each(SOURCES)('on $name at the parameter midpoints', (source) => {
        const rows = claimed
            .map((recipe) => ({
                recipe,
                claims: checkedClaims(recipe).filter((claim) => isMeantFor(recipe, claim.metric, dryPeak(source))),
            }))
            .filter((row) => row.claims.length > 0);

        it.each(rows.map((row) => [row.recipe.id, row] as const))(
            '%s moves every metric it claims the way it claims',
            (_id, { recipe, claims }) => {
                const before = beforeFigures(recipe, source);
                const after = measure(recipe, source);
                const observed = claims.map((claim) => {
                    const from = figure(before, claim);
                    const to = figure(after, claim);
                    return {
                        metric: claim.metric,
                        moved: movedDirection(claim.metric, from, to, claim.direction),
                        before: from,
                        after: to,
                    };
                });
                expect(observed).toEqual(
                    observed.map((entry, index) => ({ ...entry, moved: claims[index]!.direction }))
                );
            },
            120_000
        );
    });
});
