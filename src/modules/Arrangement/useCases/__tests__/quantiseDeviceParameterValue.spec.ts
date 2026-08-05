import { describe, expect, it } from 'vitest';

import { quantiseDeviceParameterValue } from '../quantiseDeviceParameterValue';

describe('quantiseDeviceParameterValue', () => {
    it('quantises a builtin device parameter to its step', () => {
        // Builtin synth waveform is an integer param — fractional values snap to int
        const result = quantiseDeviceParameterValue({
            deviceType: 'builtin-synth',
            paramId: 'waveform',
            value: 1.7,
        });
        expect(result).toBe(2);
    });

    it('passes through values for unknown device types without clamping', () => {
        const result = quantiseDeviceParameterValue({
            deviceType: 'unknown-faust-device',
            paramId: 'some_param',
            value: 42.5,
        });
        expect(result).toBe(42.5);
    });
});
