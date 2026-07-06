import { describe, expect, it } from 'vitest';

import { getAudioParamKeyForPedal } from '../getAudioParamKeyForPedal';

describe('getAudioParamKeyForPedal', () => {
    it('should map supported pedal types to pre and post audio parameter keys', () => {
        expect(getAudioParamKeyForPedal(false, 'compressor', 'threshold')).toBe('preCompressorThreshold');
        expect(getAudioParamKeyForPedal(false, 'overdrive', 'drive')).toBe('preOverdriveDrive');
        expect(getAudioParamKeyForPedal(false, 'boost', 'level')).toBe('preOverdriveLevel');
        expect(getAudioParamKeyForPedal(true, 'distortion', 'tone')).toBe('postDistortionTone');
        expect(getAudioParamKeyForPedal(true, 'fuzz', 'fuzz')).toBe('postFuzzFuzz');
    });

    it('should return null for unsupported pedal types', () => {
        expect(getAudioParamKeyForPedal(false, 'noise-gate', 'threshold')).toBeNull();
        expect(getAudioParamKeyForPedal(true, 'wah', 'depth')).toBeNull();
    });
});
