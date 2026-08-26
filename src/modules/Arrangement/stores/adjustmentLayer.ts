/**
 * Adjustment layer store — non-destructive, stackable effect layers.
 *
 * Extracted from adjustmentLayerUseCases.ts.
 */

import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

export type AdjustmentEffectType =
    'eq' | 'compressor' | 'reverb' | 'delay' | 'saturation' | 'filter' | 'stereo-width' | 'volume' | 'pan';

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

const ADJUSTMENT_PARAMETER_KEYS = ['name', 'value', 'min', 'max', 'unit'] as const;
const ADJUSTMENT_REGION_KEYS = ['id', 'startBeat', 'endBeat', 'blend', 'fadeInBeats', 'fadeOutBeats'] as const;
const ADJUSTMENT_LAYER_KEYS = [
    'id',
    'name',
    'effectType',
    'parameters',
    'affectedTrackIds',
    'insertionIndex',
    'regions',
    'enabled',
    'mix',
    'color',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
    const keys = Object.keys(value);
    return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isDenseArray(value: unknown): value is unknown[] {
    if (!Array.isArray(value) || Object.keys(value).length !== value.length) {
        return false;
    }
    for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) {
            return false;
        }
    }
    return true;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isAdjustmentEffectType(value: unknown): value is AdjustmentEffectType {
    return (
        value === 'eq' ||
        value === 'compressor' ||
        value === 'reverb' ||
        value === 'delay' ||
        value === 'saturation' ||
        value === 'filter' ||
        value === 'stereo-width' ||
        value === 'volume' ||
        value === 'pan'
    );
}

function isAdjustmentParameter(value: unknown): value is AdjustmentParameter {
    return (
        isRecord(value) &&
        hasExactKeys(value, ADJUSTMENT_PARAMETER_KEYS) &&
        typeof value.name === 'string' &&
        value.name.length > 0 &&
        isFiniteNumber(value.value) &&
        isFiniteNumber(value.min) &&
        isFiniteNumber(value.max) &&
        value.min <= value.max &&
        value.value >= value.min &&
        value.value <= value.max &&
        typeof value.unit === 'string'
    );
}

function isAdjustmentRegion(value: unknown): value is AdjustmentRegion {
    return (
        isRecord(value) &&
        hasExactKeys(value, ADJUSTMENT_REGION_KEYS) &&
        typeof value.id === 'string' &&
        value.id.length > 0 &&
        isFiniteNumber(value.startBeat) &&
        value.startBeat >= 0 &&
        isFiniteNumber(value.endBeat) &&
        value.endBeat >= value.startBeat &&
        isFiniteNumber(value.blend) &&
        value.blend >= 0 &&
        value.blend <= 1 &&
        isFiniteNumber(value.fadeInBeats) &&
        value.fadeInBeats >= 0 &&
        isFiniteNumber(value.fadeOutBeats) &&
        value.fadeOutBeats >= 0
    );
}

function isAdjustmentLayer(value: unknown, regionIds: Set<string>): value is AdjustmentLayer {
    if (
        !isRecord(value) ||
        !hasExactKeys(value, ADJUSTMENT_LAYER_KEYS) ||
        typeof value.id !== 'string' ||
        value.id.length === 0 ||
        typeof value.name !== 'string' ||
        !isAdjustmentEffectType(value.effectType) ||
        !isDenseArray(value.parameters) ||
        !isDenseArray(value.affectedTrackIds) ||
        !isFiniteNumber(value.insertionIndex) ||
        !Number.isInteger(value.insertionIndex) ||
        value.insertionIndex < 0 ||
        !isDenseArray(value.regions) ||
        typeof value.enabled !== 'boolean' ||
        !isFiniteNumber(value.mix) ||
        value.mix < 0 ||
        value.mix > 1 ||
        typeof value.color !== 'string'
    ) {
        return false;
    }

    const parameterNames = new Set<string>();
    for (const parameter of value.parameters) {
        if (!isAdjustmentParameter(parameter) || parameterNames.has(parameter.name)) {
            return false;
        }
        parameterNames.add(parameter.name);
    }

    const affectedTrackIds = new Set<string>();
    for (const trackId of value.affectedTrackIds) {
        if (typeof trackId !== 'string' || trackId.length === 0 || affectedTrackIds.has(trackId)) {
            return false;
        }
        affectedTrackIds.add(trackId);
    }

    for (const region of value.regions) {
        if (!isAdjustmentRegion(region) || regionIds.has(region.id)) {
            return false;
        }
        regionIds.add(region.id);
    }
    return true;
}

function isAdjustmentLayerState(value: unknown): value is AdjustmentLayerState {
    if (!isRecord(value) || !hasExactKeys(value, ['layers']) || !isDenseArray(value.layers)) {
        return false;
    }

    const layerIds = new Set<string>();
    const regionIds = new Set<string>();
    for (const layer of value.layers) {
        if (!isAdjustmentLayer(layer, regionIds) || layerIds.has(layer.id)) {
            return false;
        }
        layerIds.add(layer.id);
    }
    return true;
}

/**
 * Decode the shared `adjustmentLayers` slot without repairing it in place.
 *
 * Valid state is returned by identity. Any malformed or unsupported content
 * projects as empty so typed audio and command consumers cannot observe it;
 * the Automerge adapter retains the raw slot and its registered sanitizer
 * makes project admission report repair-required instead of writing a lossy
 * projection back over another peer's data.
 */
export function sanitizeAdjustmentLayerState(value: unknown): AdjustmentLayerState {
    return isAdjustmentLayerState(value) ? value : { layers: [] };
}

export const adjustmentLayerStore = createStore<AdjustmentLayerState>({
    storage: createAutomergeStorage<AdjustmentLayerState>(DOC_PREFIX_ROOT, 'adjustmentLayers', {
        fromCrdt: sanitizeAdjustmentLayerState,
        crdtEntityIdentity: {
            parameters: (row) => (typeof row.name === 'string' && row.name.length > 0 ? row.name : null),
        },
        hydrateMissing: () => ({ layers: [] }),
    }),
    initialData: { layers: [] },
    sanitize: sanitizeAdjustmentLayerState,
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
