/**
 * Use case: resolve built-in synthesizer parameters from device descriptors.
 */

import { isBuiltinSynthDevice } from '#/utils/deviceTypeMatching';

import { type BuiltinSynthParams } from '../models/BuiltinSynthTypes';

// Consumer-local shape (AGENTS.md §95 — model isolation). Only fields used here.
type Device = { type: string; parameterValues: Record<string, number> };

const defaultSynthParams: BuiltinSynthParams = {
    waveform: 'sawtooth',
    attack: 0.01,
    decay: 0.2,
    sustain: 0.7,
    release: 0.3,
    filterCutoff: 5000,
    filterResonance: 1,
    filterType: 'lowpass',
    filterEnvAmount: 0,
    detune: 0,
    gain: 0.3,
    osc2Waveform: 'sawtooth',
    osc2Detune: 0,
    osc2Mix: 0,
    subOscLevel: 0,
    noiseLevel: 0,
    vibratoRate: 0,
    vibratoDepth: 0,
    vibratoDelay: 0.3,
    stereoSpread: 0,
    filterVelocitySensitivity: 0,
};

const SYNTH_PARAM_KEYS: ReadonlyArray<keyof BuiltinSynthParams> = [
    'waveform',
    'attack',
    'decay',
    'sustain',
    'release',
    'filterCutoff',
    'filterResonance',
    'filterType',
    'filterEnvAmount',
    'detune',
    'gain',
    'osc2Waveform',
    'osc2Detune',
    'osc2Mix',
    'subOscLevel',
    'noiseLevel',
    'vibratoRate',
    'vibratoDepth',
    'vibratoDelay',
    'stereoSpread',
    'filterVelocitySensitivity',
];

const WAVEFORMS = new Set<string>(['sine', 'triangle', 'sawtooth', 'square']);
const FILTER_TYPES = new Set<string>(['lowpass', 'highpass', 'bandpass']);

const WAVEFORM_INDEX: Record<number, BuiltinSynthParams['waveform']> = {
    0: 'sine',
    1: 'triangle',
    2: 'sawtooth',
    3: 'square',
};

const FILTER_TYPE_INDEX: Record<number, BuiltinSynthParams['filterType']> = {
    0: 'lowpass',
    1: 'highpass',
    2: 'bandpass',
};

function resolveEnumParam<TValue extends string>(
    raw: number | string | undefined,
    allowed: Set<string>,
    indexMap: Record<number, TValue>,
    fallback: TValue
): TValue {
    if (raw === undefined) {
        return fallback;
    }
    if (typeof raw === 'string' && allowed.has(raw)) {
        return raw as TValue;
    }
    if (typeof raw === 'number' && indexMap[raw] !== undefined) {
        return indexMap[raw];
    }
    return fallback;
}

/**
 * Resolve synth params from an array of device descriptors.
 * Prefer this over `getSynthParamsForTrack` during offline rendering
 * to avoid re-reading the live store mid-render.
 */
export function getSynthParamsFromDevices(devices: Device[]): BuiltinSynthParams {
    const synthDevice = devices.find((d) => isBuiltinSynthDevice(d.type));
    if (!synthDevice) {
        return { ...defaultSynthParams };
    }

    const pv = synthDevice.parameterValues;
    const result: BuiltinSynthParams = { ...defaultSynthParams };

    for (const key of SYNTH_PARAM_KEYS) {
        const raw = pv[key];
        if (raw === undefined) {
            continue;
        }

        if (key === 'waveform') {
            result.waveform = resolveEnumParam(raw, WAVEFORMS, WAVEFORM_INDEX, defaultSynthParams.waveform);
        } else if (key === 'osc2Waveform') {
            result.osc2Waveform = resolveEnumParam(raw, WAVEFORMS, WAVEFORM_INDEX, defaultSynthParams.osc2Waveform);
        } else if (key === 'filterType') {
            result.filterType = resolveEnumParam(raw, FILTER_TYPES, FILTER_TYPE_INDEX, defaultSynthParams.filterType);
        } else {
            // key is a numeric param at this point (waveform/osc2Waveform/filterType handled above)
            result[key] = raw;
        }
    }

    return result;
}
