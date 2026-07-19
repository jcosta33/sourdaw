/**
 * Adjustment layer store — non-destructive, stackable effect layers.
 *
 * Extracted from adjustmentLayerUseCases.ts.
 */

import { createStore } from '#/infra/store/createStore';

export type AdjustmentEffectType =
    | 'eq'
    | 'compressor'
    | 'reverb'
    | 'delay'
    | 'saturation'
    | 'filter'
    | 'stereo-width'
    | 'volume'
    | 'pan';

export type AdjustmentParameter = {
    name: string;
    value: number;
    min: number;
    max: number;
    unit: string;
};

export type AdjustmentRegion = {
    id: string;
    startBeat: number;
    endBeat: number;
    /** Blend amount (0-1) — how strongly this region applies */
    blend: number;
    /** Fade in/out durations in beats */
    fadeInBeats: number;
    fadeOutBeats: number;
};

export type AdjustmentLayer = {
    id: string;
    name: string;
    /** Effect type */
    effectType: AdjustmentEffectType;
    /** Effect parameters */
    parameters: AdjustmentParameter[];
    /** Which tracks this layer affects (empty = all tracks below) */
    affectedTrackIds: string[];
    /** Track index where this layer sits */
    insertionIndex: number;
    /** Active regions — empty means the effect is always on */
    regions: AdjustmentRegion[];
    /** Is the layer enabled? */
    enabled: boolean;
    /** Mix/dry-wet (0 = dry, 1 = fully wet) */
    mix: number;
    color: string;
};

export type AdjustmentLayerState = {
    layers: AdjustmentLayer[];
};

function clamp_unit_interval(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function canonical_parameter_bounds(parameter: AdjustmentParameter): { min: number; max: number } {
    const first_bound = Number.isFinite(parameter.min) ? parameter.min : 0;
    const second_bound = Number.isFinite(parameter.max) ? parameter.max : first_bound;
    return {
        min: Math.min(first_bound, second_bound),
        max: Math.max(first_bound, second_bound),
    };
}

export function resolveAdjustmentParameterValue(parameter: AdjustmentParameter): number {
    const { min, max } = canonical_parameter_bounds(parameter);
    const value = Number.isFinite(parameter.value) ? parameter.value : min;
    return Math.max(min, Math.min(max, value));
}

export function canonicalizeAdjustmentParameter(parameter: AdjustmentParameter): AdjustmentParameter {
    const { min, max } = canonical_parameter_bounds(parameter);
    return {
        ...parameter,
        min,
        max,
        value: resolveAdjustmentParameterValue(parameter),
    };
}

export function resolveAdjustmentLayerTrackIds(layer: AdjustmentLayer, orderedTrackIds: readonly string[]): string[] {
    if (layer.affectedTrackIds.length > 0) {
        const available_track_ids = new Set(orderedTrackIds);
        return layer.affectedTrackIds.filter((track_id) => available_track_ids.has(track_id));
    }
    return orderedTrackIds.slice(layer.insertionIndex);
}

export function computeAdjustmentLayerBlendAtBeat(layer: AdjustmentLayer, beat: number): number {
    if (!layer.enabled) {
        return 0;
    }
    const mix = clamp_unit_interval(layer.mix);
    if (layer.regions.length === 0) {
        return mix;
    }

    let total = 0;
    for (const region of layer.regions) {
        if (region.endBeat <= region.startBeat || beat < region.startBeat || beat >= region.endBeat) {
            continue;
        }
        const fade_in = Math.max(0, region.fadeInBeats);
        const fade_out = Math.max(0, region.fadeOutBeats);
        let envelope = 1;
        if (fade_in > 0 && beat < region.startBeat + fade_in) {
            envelope = (beat - region.startBeat) / fade_in;
        } else if (fade_out > 0 && beat > region.endBeat - fade_out) {
            envelope = Math.max(0, (region.endBeat - beat) / fade_out);
        }
        total += clamp_unit_interval(region.blend) * envelope;
    }
    return clamp_unit_interval(total * mix);
}

function is_potentially_audible_region(region: AdjustmentRegion): boolean {
    return region.endBeat > region.startBeat && clamp_unit_interval(region.blend) > 0;
}

export function createEffectiveAdjustmentLayerSignature(
    layers: readonly AdjustmentLayer[],
    orderedTrackIds: readonly string[],
    trackId: string
): string {
    return JSON.stringify(
        layers.flatMap((layer) => {
            const mix = clamp_unit_interval(layer.mix);
            const audible_regions = layer.regions.filter(is_potentially_audible_region);
            if (
                !layer.enabled ||
                mix === 0 ||
                !resolveAdjustmentLayerTrackIds(layer, orderedTrackIds).includes(trackId) ||
                (layer.regions.length > 0 && audible_regions.length === 0)
            ) {
                return [];
            }
            return [
                {
                    id: layer.id,
                    effectType: layer.effectType,
                    mix,
                    parameters: layer.parameters.map((parameter) => ({
                        name: parameter.name,
                        value: resolveAdjustmentParameterValue(parameter),
                    })),
                    regions: audible_regions.map((region) => ({
                        startBeat: region.startBeat,
                        endBeat: region.endBeat,
                        blend: clamp_unit_interval(region.blend),
                        fadeInBeats: Math.max(0, region.fadeInBeats),
                        fadeOutBeats: Math.max(0, region.fadeOutBeats),
                    })),
                },
            ];
        })
    );
}

export const adjustmentLayerStore = createStore<AdjustmentLayerState>({
    initialData: { layers: [] },
});

// §122.1 — UUID instead of module-level counters that reset on HMR
// and collide across sequential creates after a reload.
export function getNextLayerId(): string {
    return `adj-${crypto.randomUUID()}`;
}

export function getNextRegionId(): string {
    return `adjr-${crypto.randomUUID()}`;
}

export const EFFECT_PRESETS: Record<AdjustmentEffectType, AdjustmentParameter[]> = {
    eq: [
        { name: 'Low Cut', value: 80, min: 20, max: 500, unit: 'Hz' },
        { name: 'Low Gain', value: 0, min: -12, max: 12, unit: 'dB' },
        { name: 'Mid Gain', value: 0, min: -12, max: 12, unit: 'dB' },
        { name: 'High Gain', value: 0, min: -12, max: 12, unit: 'dB' },
        { name: 'High Cut', value: 16000, min: 2000, max: 20000, unit: 'Hz' },
    ],
    compressor: [
        { name: 'Threshold', value: -20, min: -60, max: 0, unit: 'dB' },
        { name: 'Ratio', value: 4, min: 1, max: 20, unit: ':1' },
        { name: 'Attack', value: 10, min: 0.1, max: 100, unit: 'ms' },
        { name: 'Release', value: 100, min: 10, max: 1000, unit: 'ms' },
        { name: 'Makeup', value: 0, min: 0, max: 24, unit: 'dB' },
    ],
    reverb: [
        { name: 'Size', value: 50, min: 0, max: 100, unit: '%' },
        { name: 'Decay', value: 2, min: 0.1, max: 10, unit: 's' },
        { name: 'Pre-Delay', value: 20, min: 0, max: 200, unit: 'ms' },
        { name: 'Damping', value: 50, min: 0, max: 100, unit: '%' },
    ],
    delay: [
        { name: 'Time', value: 250, min: 1, max: 2000, unit: 'ms' },
        { name: 'Feedback', value: 40, min: 0, max: 95, unit: '%' },
        { name: 'Ping-Pong', value: 0, min: 0, max: 1, unit: '' },
    ],
    saturation: [
        { name: 'Drive', value: 30, min: 0, max: 100, unit: '%' },
        { name: 'Tone', value: 50, min: 0, max: 100, unit: '%' },
    ],
    filter: [
        { name: 'Cutoff', value: 1000, min: 20, max: 20000, unit: 'Hz' },
        { name: 'Resonance', value: 0.5, min: 0, max: 1, unit: '' },
        { name: 'Type', value: 0, min: 0, max: 3, unit: '' }, // 0=LP, 1=HP, 2=BP, 3=Notch
    ],
    'stereo-width': [
        { name: 'Width', value: 100, min: 0, max: 200, unit: '%' },
        { name: 'Center', value: 0, min: -100, max: 100, unit: '%' },
    ],
    volume: [{ name: 'Gain', value: 0, min: -60, max: 12, unit: 'dB' }],
    pan: [{ name: 'Pan', value: 0, min: -100, max: 100, unit: '%' }],
};

export const LAYER_COLORS = [
    'oklch(0.40 0.10 180)',
    'oklch(0.40 0.10 240)',
    'oklch(0.40 0.10 300)',
    'oklch(0.40 0.10 60)',
    'oklch(0.40 0.10 120)',
    'oklch(0.40 0.10 30)',
];
