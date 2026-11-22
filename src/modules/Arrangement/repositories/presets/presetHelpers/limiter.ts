import { type DevicePreset } from '../../../models/SoundPreset';

type LimiterParameterId = 'lim-threshold' | 'lim-release' | 'lim-auto-makeup';

/**
 * A built-in limiter preset. Auto Makeup is stated on: every factory limiter
 * preset was voiced with the browser's makeup gain in the output (ADR 0066).
 */
export function limiter(name: string, params: Partial<Record<LimiterParameterId, number>>): DevicePreset {
    return {
        type: 'builtin-limiter',
        name,
        // `lim-release` is milliseconds: the descriptor declares [10, 500] ms
        // and `applyLimiterParams` divides by 1000 before assigning it to
        // `DynamicsCompressorNode.release`. This default was authored in
        // seconds (0.1), which reached the engine as 0.1 ms — three orders of
        // magnitude fast, and outside the declared range in the direction the
        // clamp now catches.
        parameterValues: { 'lim-threshold': -1, 'lim-release': 100, 'lim-auto-makeup': 1, ...params },
    };
}
