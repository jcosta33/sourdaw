/**
 * Shared factory helper functions for building DevicePreset objects.
 * All preset category files import from here — never from each other.
 */

import { type DevicePreset } from '#/modules/Arrangement/models/SoundPreset';

export const AUTHOR = 'Sourdaw';

export const synth = (name: string, params: Record<string, number>): DevicePreset => ({
    type: 'builtin-synth',
    name,
    parameterValues: params,
});

export const eq = (
    name: string,
    params: Partial<
        Record<
            | 'eq-low-gain'
            | 'eq-low-freq'
            | 'eq-mid-gain'
            | 'eq-mid-freq'
            | 'eq-mid-q'
            | 'eq-high-gain'
            | 'eq-high-freq',
            number
        >
    >
): DevicePreset => ({
    type: 'builtin-eq',
    name,
    parameterValues: {
        'eq-low-gain': 0,
        'eq-low-freq': 100,
        'eq-mid-gain': 0,
        'eq-mid-freq': 1000,
        'eq-mid-q': 1,
        'eq-high-gain': 0,
        'eq-high-freq': 8000,
        ...params,
    },
});

export const comp = (
    name: string,
    params: Partial<Record<'comp-threshold' | 'comp-ratio' | 'comp-attack' | 'comp-release' | 'comp-makeup', number>>
): DevicePreset => ({
    type: 'builtin-compressor',
    name,
    parameterValues: {
        'comp-threshold': -20,
        'comp-ratio': 4,
        'comp-attack': 10,
        'comp-release': 100,
        'comp-makeup': 0,
        ...params,
    },
});

export const reverb = (
    name: string,
    params: Partial<Record<'rev-size' | 'rev-decay' | 'rev-damping' | 'rev-mix', number>>
): DevicePreset => ({
    type: 'builtin-reverb',
    name,
    parameterValues: {
        'rev-size': 0.5,
        'rev-decay': 2,
        'rev-damping': 0.5,
        'rev-mix': 0.3,
        ...params,
    },
});

export const delay = (
    name: string,
    params: Partial<Record<'delay-time' | 'delay-feedback' | 'delay-mix', number>>
): DevicePreset => ({
    type: 'builtin-delay',
    name,
    parameterValues: {
        'delay-time': 250,
        'delay-feedback': 0.4,
        'delay-mix': 0.3,
        ...params,
    },
});

export const flanger = (
    name: string,
    params: Partial<Record<'flanger-rate' | 'flanger-depth' | 'flanger-feedback' | 'flanger-mix', number>>
): DevicePreset => ({
    type: 'builtin-flanger',
    name,
    parameterValues: {
        'flanger-rate': 0.3,
        'flanger-depth': 3,
        'flanger-feedback': 0.5,
        'flanger-mix': 0.5,
        ...params,
    },
});

export const tremolo = (
    name: string,
    params: Partial<Record<'trem-rate' | 'trem-depth' | 'trem-shape', number>>
): DevicePreset => ({
    type: 'builtin-tremolo',
    name,
    parameterValues: { 'trem-rate': 4, 'trem-depth': 0.5, 'trem-shape': 0, ...params },
});

export const bitcrusher = (
    name: string,
    params: Partial<Record<'crush-bits' | 'crush-rate' | 'crush-mix', number>>
): DevicePreset => ({
    type: 'builtin-bitcrusher',
    name,
    parameterValues: { 'crush-bits': 8, 'crush-rate': 1, 'crush-mix': 0.5, ...params },
});

export const filter = (
    name: string,
    params: Partial<Record<'filter-cutoff' | 'filter-resonance' | 'filter-type', number>>
): DevicePreset => ({
    type: 'builtin-filter',
    name,
    parameterValues: { 'filter-cutoff': 1000, 'filter-resonance': 1, 'filter-type': 0, ...params },
});

export const autopan = (
    name: string,
    params: Partial<Record<'autopan-rate' | 'autopan-depth' | 'autopan-shape', number>>
): DevicePreset => ({
    type: 'builtin-autopan',
    name,
    parameterValues: { 'autopan-rate': 2, 'autopan-depth': 0.7, 'autopan-shape': 0, ...params },
});

export const chorus = (
    name: string,
    params: Partial<Record<'chorus-rate' | 'chorus-depth' | 'chorus-feedback' | 'chorus-mix', number>>
): DevicePreset => ({
    type: 'builtin-chorus',
    name,
    parameterValues: { 'chorus-rate': 1.5, 'chorus-depth': 7, 'chorus-feedback': 0.2, 'chorus-mix': 0.5, ...params },
});

export const phaser = (
    name: string,
    params: Partial<Record<'phaser-rate' | 'phaser-depth' | 'phaser-feedback' | 'phaser-stages', number>>
): DevicePreset => ({
    type: 'builtin-phaser',
    name,
    parameterValues: { 'phaser-rate': 0.5, 'phaser-depth': 0.5, 'phaser-feedback': 0.3, 'phaser-stages': 4, ...params },
});

export const distortion = (
    name: string,
    params: Partial<Record<'dist-drive' | 'dist-tone' | 'dist-mix', number>>
): DevicePreset => ({
    type: 'builtin-distortion',
    name,
    parameterValues: { 'dist-drive': 5, 'dist-tone': 5000, 'dist-mix': 0.5, ...params },
});

export const limiter = (
    name: string,
    params: Partial<Record<'lim-threshold' | 'lim-release', number>>
): DevicePreset => ({
    type: 'builtin-limiter',
    name,
    parameterValues: { 'lim-threshold': -1, 'lim-release': 0.1, ...params },
});

export const convReverb = (
    name: string,
    params: Partial<Record<'conv-ir' | 'conv-mix' | 'conv-predelay' | 'conv-lowcut' | 'conv-highcut', number>>
): DevicePreset => ({
    type: 'builtin-convolution-reverb',
    name,
    parameterValues: {
        'conv-ir': 6,
        'conv-mix': 0.4,
        'conv-predelay': 10,
        'conv-lowcut': 60,
        'conv-highcut': 12000,
        ...params,
    },
});
