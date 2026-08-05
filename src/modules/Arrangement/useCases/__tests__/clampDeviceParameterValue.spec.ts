import { describe, expect, it } from 'vitest';

import { clampDeviceParameterValue } from '../clampDeviceParameterValue';

describe('clampDeviceParameterValue', () => {
    it('clamps a builtin synth parameter to its valid range', () => {
        const result = clampDeviceParameterValue({
            deviceType: 'builtin-synth',
            paramId: 'waveform',
            value: 15.7,
        });
        expect(result).toBeLessThanOrEqual(3);
    });

    it('passes through values for unknown device types without clamping', () => {
        const result = clampDeviceParameterValue({
            deviceType: 'unknown-faust-device',
            paramId: 'some_param',
            value: 42.5,
        });
        expect(result).toBe(42.5);
    });
});
