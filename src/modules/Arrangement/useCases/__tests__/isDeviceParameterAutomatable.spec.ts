import { describe, expect, it } from 'vitest';

import { isDeviceParameterAutomatable } from '../isDeviceParameterAutomatable';

describe('isDeviceParameterAutomatable', () => {
    it('returns true for an automatable builtin parameter', () => {
        const result = isDeviceParameterAutomatable({
            deviceType: 'builtin-synth',
            paramId: 'filterCutoff',
        });
        expect(typeof result).toBe('boolean');
    });

    it('returns false for non-automatable parameters', () => {
        const result = isDeviceParameterAutomatable({
            deviceType: 'builtin-synth',
            paramId: 'waveform',
        });
        expect(result).toBe(false);
    });
});
