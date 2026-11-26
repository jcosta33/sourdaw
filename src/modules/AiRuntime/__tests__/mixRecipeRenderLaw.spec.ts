import { describe, expect, it } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { type Track } from '#/modules/Arrangement/stores';
import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { measureAgentScopeRender } from '#/modules/AudioAnalysis/useCases';

import { createTrack } from '../useCases/__tests__/trackFixture';
import { readRecipeExpectationTolerance } from '../useCases/metricHoldTolerances';
import { objectiveMetricProjection } from '../useCases/objectiveMetricProjection';

import { createAcceptanceRenderLaw, type SourceProfile } from './acceptanceRenderLaw';

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
    /** What the source overrides of its position's shape. */
    profile?: SourceProfile;
};

/** Every partial at equal weight: a spectrum that has energy in every band for a band or spectral move to show on. */
const FLAT_SPECTRUM = [1, 1, 1, 1, 1, 1] as const;

/**
 * Positions 0 to 3 peak at about -8 dBFS or lower, where a compressor's makeup alone lifts a level. A bus
 * or a hot take peaks near 0 dBFS, where the same compressor lowers it, so the hot source is the same
 * shape as position 3 trimmed up to about -1 dBFS: a level claim whose direction depends on input level
 * fails on it. The hot struck source is a take with a wide strike (position 1) at the same level, which is
 * where a bus compressor's dynamics claims are meant to show. The sustained source is that hot take held steady (no strike), the organ or pad whose level
 * a compressor only lowers. The wide source has every band at equal weight and a large inter-channel
 * phase lag, so a stereo or spectral claim has a source that carries the figure it moves. Positions 0 and
 * 3 are mono, so a stereo claim is meant for the others.
 */
const SOURCES: readonly LawSource[] = [
    { name: 'source 0', position: 0, trimDb: 0 },
    { name: 'source 1', position: 1, trimDb: 0 },
    { name: 'source 2', position: 2, trimDb: 0 },
    { name: 'source 3', position: 3, trimDb: 0 },
    { name: 'hot source', position: 3, trimDb: 9.3 },
    { name: 'hot struck source', position: 1, trimDb: 12 },
    { name: 'sustained source', position: 3, trimDb: 9.3, profile: { sustain: 1 } },
    { name: 'wide flat source', position: 1, trimDb: 0, profile: { weights: FLAT_SPECTRUM, lag: Math.PI / 4 } },
];

/** The devices the acceptance render law has a rule for; any other step makes a recipe unrenderable. */
const LAW_DEVICES = new Set(['builtin-eq', 'builtin-compressor', 'builtin-gain', 'builtin-stereo-widener']);

type Claim = MixRecipe['metrics'][number];
type Figures = ReturnType<typeof measureAgentScopeRender>;
type Stage = 'before' | 'after';

/**
 * Every metric an authored recipe claims: level, dynamics and transient (a compressor decides them), band
 * and spectral (an equaliser decides them) and stereo (a widener decides them). A claim on a metric outside
 * this set is checked against nothing, so the catalog spec asserts none exists.
 */
const CHECKED_METRICS = [
    'rms',
    'crestFactor',
    'dynamicRangeEstimate',
    'truePeak',
    'integratedLoudness',
    'shortTermLoudnessMax',
    'transientDensity',
    'frequencyBandEnergy',
    'spectralCentroid',
    'spectralRolloff',
    'sideEnergyFraction',
    'lowFrequencyStereoContent',
    'stereoCorrelation',
] as const;

const STEREO_METRICS: readonly string[] = ['sideEnergyFraction', 'lowFrequencyStereoContent', 'stereoCorrelation'];

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

/** One point in a recipe's parameter windows: the value each `step:parameter` takes. */
type WindowSetting = { name: string; values: ReadonlyMap<string, number> };

const MAX_FULL_CORNER_PARAMETERS = 3;

function parameterKey(stepIndex: number, paramId: string): string {
    return `${stepIndex}:${paramId}`;
}

type WindowParameter = { key: string; minimum: number; maximum: number };

function windowParameters(recipe: MixRecipe): readonly WindowParameter[] {
    return recipe.steps.flatMap((step, stepIndex) =>
        step.parameters.map((parameter) => ({
            key: parameterKey(stepIndex, parameter.paramId),
            minimum: parameter.minimum,
            maximum: parameter.maximum,
        }))
    );
}

function settingAt(name: string, parameters: readonly WindowParameter[], pick: (index: number) => number) {
    const values = new Map(
        parameters.map((parameter, index) => [
            parameter.key,
            parameter.minimum + pick(index) * (parameter.maximum - parameter.minimum),
        ])
    );
    return { name, values } satisfies WindowSetting;
}

/**
 * The points the planner may pick that a claim has to hold at: the window midpoint (the catalogue default),
 * and the window's extremes. A recipe with few free parameters is rendered at every corner of its window,
 * since the worst corner mixes ends (a low threshold with a high makeup). A recipe with more renders both
 * all-low and all-high corners and each parameter flipped alone from either, so every parameter is seen
 * at both ends against both ends of the rest.
 */
function windowSettings(recipe: MixRecipe): readonly WindowSetting[] {
    const parameters = windowParameters(recipe);
    const free = parameters.flatMap((parameter, index) => (parameter.minimum < parameter.maximum ? [index] : []));
    const midpoint = settingAt('midpoint', parameters, () => 0.5);
    if (free.length <= MAX_FULL_CORNER_PARAMETERS) {
        const corners = Array.from({ length: 2 ** free.length }, (_, mask) =>
            settingAt(
                `corner ${mask.toString(2).padStart(free.length, '0')}`,
                parameters,
                (index) => (mask >> free.indexOf(index)) & 1
            )
        );
        return [midpoint, ...corners];
    }
    const edge = (base: 0 | 1, flipped: number | null) =>
        settingAt(
            flipped === null
                ? `all ${base === 0 ? 'minimum' : 'maximum'}`
                : `${base === 0 ? 'minimum' : 'maximum'} with ${parameters[flipped]!.key} flipped`,
            parameters,
            (index) => (index === flipped ? 1 - base : base)
        );
    return [
        midpoint,
        ...([0, 1] as const).flatMap((base) => [edge(base, null), ...free.map((index) => edge(base, index))]),
    ];
}

/** The recipe's devices at a point in their windows, or before it runs: an edit step's device at the values it starts with, an insert step's not yet there. */
function recipeTrack(
    recipe: MixRecipe | null,
    source: LawSource,
    stage: Stage = 'after',
    setting: WindowSetting | null = null
): Track {
    const steps = (recipe?.steps ?? []).flatMap((step, stepIndex) =>
        stage === 'after' || step.kind === 'edit' ? [{ step, stepIndex }] : []
    );
    const devices = steps.map(({ step, stepIndex }) => ({
        id: `device-${stepIndex}`,
        name: step.deviceType,
        type: step.deviceType,
        bypassed: false,
        parameterValues: stagedParameterValues(step, stepIndex, stage, setting),
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

/** A step's parameter values at the setting once the recipe has run; before it, the device's own starting values. */
function stagedParameterValues(
    step: MixRecipe['steps'][number],
    stepIndex: number,
    stage: Stage,
    setting: WindowSetting | null
): Record<string, number> {
    if (stage === 'before') {
        return {};
    }
    if (setting === null) {
        throw new Error('A recipe renders at a point in its windows.');
    }
    return Object.fromEntries(
        step.parameters.map((parameter) => {
            const value = setting.values.get(parameterKey(stepIndex, parameter.paramId));
            if (value === undefined) {
                throw new Error(`${parameter.paramId} has no value at ${setting.name}.`);
            }
            return [parameter.paramId, value];
        })
    );
}

function measure(
    recipe: MixRecipe | null,
    source: LawSource,
    metrics: readonly Claim['metric'][],
    stage: Stage = 'after',
    setting: WindowSetting | null = null
) {
    const law = createAcceptanceRenderLaw({
        trackPosition: () => source.position,
        tempo: () => TEMPO,
        liveTracks: () => [],
        masterGain: () => 1,
        sourceProfile: () => source.profile ?? {},
    });
    const target = recipeTrack(recipe, source, stage, setting);
    const buffer = law.renderTrack({
        targetTrackId: target.id,
        renderTracks: [target],
        startBeat: 0,
        endBeat: BEATS,
    });
    return measureAgentScopeRender(buffer, metrics);
}

function isCheckedMetric(metric: string): boolean {
    return (CHECKED_METRICS as readonly string[]).includes(metric);
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

/** The highest threshold in the recipe's compressor window, or `null` when no compressor decides its dynamics. */
function compressorThresholdCeilingDb(recipe: MixRecipe): number | null {
    const threshold = recipe.steps
        .find((step) => step.deviceType === 'builtin-compressor')
        ?.parameters.find((parameter) => parameter.paramId === 'comp-threshold');
    if (threshold === undefined) {
        return null;
    }
    return threshold.maximum;
}

/** The side energy a source needs before a stereo claim can show on it; the mono positions measure zero. */
const MIN_SOURCE_SIDE_ENERGY_FRACTION = 0.01;

const FREQUENCY_BANDS = ['sub', 'bass', 'low-mid', 'mid', 'high-mid', 'presence', 'air'] as const;

/**
 * The share of a source's energy one band may hold before a band-share claim on that band or its neighbour
 * cannot show: a band's share is its energy over the total, so a source whose energy sits mostly in one band
 * moves that band's share by that band's own gain, however the recipe's other bands are set.
 */
const DOMINANT_BAND_SHARE = 0.5;

/** Whether one band holds more than half the source's energy within a band of the claimed one. */
function isDominatedNear(band: (typeof FREQUENCY_BANDS)[number], dry: Figures): boolean {
    const index = FREQUENCY_BANDS.indexOf(band);
    return FREQUENCY_BANDS.slice(Math.max(0, index - 1), index + 2).some(
        (near) => figure(dry, { metric: 'frequencyBandEnergy', band: near, direction: 'hold' }) > DOMINANT_BAND_SHARE
    );
}

/** The span above a compressor's threshold over which its soft knee ramps reduction in (the device's default knee). */
const COMPRESSOR_KNEE_DB = 6;

const STRIKE_SHAPED_METRICS: readonly string[] = ['crestFactor', 'dynamicRangeEstimate', 'transientDensity'];

/**
 * The crest factor a source needs before a compressor or transient claim can show on it: a source whose
 * strike barely clears its body (a steady tone, a part that sustains near its peak) leaves a compressor
 * nothing to reshape, and the claim moves either way on rounding and attack timing.
 */
const MIN_DYNAMIC_SOURCE_CREST_DB = 10;

/**
 * Where the air band starts. A spectral-rolloff claim is the frequency below which 85% of the energy sits,
 * and the recipes that claim it move air-band energy, which can only shift the rolloff of a source whose
 * rolloff already lies in that band.
 */
const AIR_BAND_FLOOR_HZ = 8000;

/**
 * Whether a claim is meant for a source. A compressor's crest and dynamic-range claims are meant for a
 * source whose peak clears every threshold in the window by the knee: a compressor reduces nothing below its
 * threshold and ramps in across the knee above it, so a quieter source cannot show the claim either way. Crest, dynamic-range and transient
 * claims are not meant for a source whose own crest factor is too low to reshape. A band-share claim is meant for a source with no dominant band near the claimed one. A stereo claim is meant for a
 * source with a side signal, since a mono source has nothing to widen or narrow. A spectral-rolloff claim
 * is meant for a source whose own rolloff lies in the air band. Every other claim
 * is meant for every source.
 */
function isMeantFor(recipe: MixRecipe, claim: Claim, dry: Figures): boolean {
    const metric = claim.metric;
    if (STEREO_METRICS.includes(metric)) {
        return figure(dry, { metric: 'sideEnergyFraction', direction: 'hold' }) >= MIN_SOURCE_SIDE_ENERGY_FRACTION;
    }
    if (
        STRIKE_SHAPED_METRICS.includes(metric) &&
        figure(dry, { metric: 'crestFactor', direction: 'hold' }) < MIN_DYNAMIC_SOURCE_CREST_DB
    ) {
        return false;
    }
    if (metric === 'frequencyBandEnergy' && claim.band !== undefined && isDominatedNear(claim.band, dry)) {
        return false;
    }
    if (metric === 'spectralRolloff') {
        return figure(dry, { metric, direction: 'hold' }) >= AIR_BAND_FLOOR_HZ;
    }
    const thresholdDb = compressorThresholdCeilingDb(recipe);
    if (thresholdDb === null || (metric !== 'crestFactor' && metric !== 'dynamicRangeEstimate')) {
        return true;
    }
    return figure(dry, { metric: 'truePeak', direction: 'hold' }) > thresholdDb + COMPRESSOR_KNEE_DB;
}

/**
 * Claims no law source is meant for: every source sits below the compressor threshold or lacks the side
 * signal, so the law cannot check them. Asserted equal to what the catalog holds, so no claim leaves the
 * checked set unnoticed.
 */
const CLAIMS_NO_LAW_SOURCE_DRIVES: readonly string[] = [];

describe('mix recipe metric claims against the acceptance render law', () => {
    const recipes = getMixRecipeCatalog().recipes;
    const claimed = recipes.filter((recipe) => firstUnrenderableDevice(recipe) === null);
    const dry = new Map(SOURCES.map((source) => [source.name, measure(null, source, CHECKED_METRICS, 'before')]));
    const dryFigures = (source: LawSource) => {
        const figures = dry.get(source.name);
        if (figures === undefined) {
            throw new Error(`No dry render of ${source.name}.`);
        }
        return figures;
    };
    const claimMetrics = (recipe: MixRecipe) => [...new Set(recipe.metrics.map((claim) => claim.metric))];
    /** The figures before the recipe runs: the devices its edit steps change, or the dry source when it only inserts. */
    const beforeFigures = (recipe: MixRecipe, source: LawSource) => {
        if (recipe.steps.some((step) => step.kind === 'edit')) {
            return measure(recipe, source, claimMetrics(recipe), 'before');
        }
        return dryFigures(source);
    };

    it('states no claim on a metric the law does not check', () => {
        const unchecked = recipes.flatMap((recipe) =>
            recipe.metrics
                .filter((claim) => !isCheckedMetric(claim.metric))
                .map((claim) => `${recipe.id}:${claim.metric}`)
        );
        expect(unchecked).toEqual([]);
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

    it('names every claim no law source is meant for, and only those', () => {
        const undriven = claimed.flatMap((recipe) =>
            recipe.metrics
                .filter((claim) => SOURCES.every((source) => !isMeantFor(recipe, claim, dryFigures(source))))
                .map((claim) => `${recipe.id}:${claim.metric}`)
        );
        expect(undriven).toEqual(CLAIMS_NO_LAW_SOURCE_DRIVES);
    });

    describe.each(SOURCES)('on $name across the parameter windows', (source) => {
        const rows = claimed
            .map((recipe) => ({
                recipe,
                claims: recipe.metrics.filter((claim) => isMeantFor(recipe, claim, dryFigures(source))),
            }))
            .filter((row) => row.claims.length > 0);

        it.each(rows.map((row) => [row.recipe.id, row] as const))(
            '%s moves every metric it claims the way it claims at every point in its windows',
            (_id, { recipe, claims }) => {
                const before = beforeFigures(recipe, source);
                const observed = windowSettings(recipe).flatMap((setting) => {
                    const after = measure(recipe, source, claimMetrics(recipe), 'after', setting);
                    return claims.map((claim) => {
                        const from = figure(before, claim);
                        const to = figure(after, claim);
                        return {
                            setting: setting.name,
                            metric: claim.metric,
                            band: claim.band ?? null,
                            moved: movedDirection(claim.metric, from, to, claim.direction),
                            before: from,
                            after: to,
                        };
                    });
                });
                const broken = observed
                    .filter(
                        (entry) =>
                            entry.moved !==
                            claims.find(
                                (claim) => claim.metric === entry.metric && (claim.band ?? null) === entry.band
                            )!.direction
                    )
                    .map(
                        (entry) =>
                            `${recipe.id} on ${source.name} at ${entry.setting}: ${entry.metric}${entry.band === null ? '' : ` ${entry.band}`} ${entry.before.toFixed(4)} -> ${entry.after.toFixed(4)} (${entry.moved})`
                    );
                expect(broken).toEqual([]);
            },
            600_000
        );
    });
});
