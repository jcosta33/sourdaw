import { describe, it, expect } from 'vitest';

import * as subject from '../helpers';
import { DEFAULT_GRINDER_PEDAL_PARAMS, getAudioParamKeyForPedal } from '../helpers';

describe('helpers', () => {
    it('should load the module', () => {
        expect(subject).toBeDefined();
    });

    it('should expose a single source of truth for supported drive pedal default params', () => {
        // These are the values the panel renders and the audio sync sends as fallbacks;
        // both paths import this constant so they cannot drift apart.
        expect(DEFAULT_GRINDER_PEDAL_PARAMS.compressor).toEqual({
            threshold: -24,
            ratio: 3,
            attack: 16,
            release: 220,
        });
        expect(DEFAULT_GRINDER_PEDAL_PARAMS.overdrive).toEqual({ drive: 2.8, tone: 5.2, level: 5.4 });
        expect(DEFAULT_GRINDER_PEDAL_PARAMS.distortion).toEqual({ drive: 5.2, tone: 4.4, level: 7.2 });
        expect(DEFAULT_GRINDER_PEDAL_PARAMS.fuzz).toEqual({ fuzz: 6.8, tone: 4.8, level: 6.4 });
    });

    it('should map supported pedal types to their pre/post audio param keys', () => {
        expect(getAudioParamKeyForPedal(false, 'compressor', 'threshold')).toBe('preCompressorThreshold');
        expect(getAudioParamKeyForPedal(true, 'fuzz', 'level')).toBe('postFuzzLevel');
        expect(getAudioParamKeyForPedal(false, 'noise-gate', 'threshold')).toBeNull();
    });
});
