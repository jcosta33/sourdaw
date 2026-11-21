import { type DevicePreset } from '../../../models/SoundPreset';

type CompParameterId =
    'comp-threshold' | 'comp-ratio' | 'comp-attack' | 'comp-release' | 'comp-makeup' | 'comp-auto-makeup';

/**
 * A built-in compressor preset. Auto Makeup is stated on: every factory
 * compressor preset was voiced with the browser's makeup gain in the output,
 * and its makeup values assume it (ADR 0064).
 */
export function comp(name: string, params: Partial<Record<CompParameterId, number>>): DevicePreset {
    return {
        type: 'builtin-compressor',
        name,
        parameterValues: {
            'comp-threshold': -20,
            'comp-ratio': 4,
            'comp-attack': 10,
            'comp-release': 100,
            'comp-makeup': 0,
            'comp-auto-makeup': 1,
            ...params,
        },
    };
}
