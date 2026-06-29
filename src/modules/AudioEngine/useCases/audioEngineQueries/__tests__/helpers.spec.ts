import { describe, it, expect } from 'vitest';

import { getDrumKitById as getNativeDrumKitById } from '../../../models/FactoryDrumKits';
import { type NativeDrumKit, cloneSynthParams, defaultSynthParams, toDrumKit, toDrumKitVoice } from '../helpers';

describe('helpers', () => {
    it('should return a new object from cloneSynthParams', () => {
        const source = { ...defaultSynthParams };
        const copy = cloneSynthParams(source);
        expect(copy).not.toBe(source);
        copy.gain = 0.01;
        expect(source.gain).toBe(defaultSynthParams.gain);
    });

    it('should return null from toDrumKit when the native kit is null', () => {
        expect(toDrumKit(null)).toBeNull();
    });

    it('should map a native drum kit to the public DrumKit shape', () => {
        const native = getNativeDrumKitById('factory-808') as NativeDrumKit;
        expect(native).not.toBeNull();
        const mapped = toDrumKit(native);
        expect(mapped?.id).toBe(native.id);
        expect(mapped?.name).toBe(native.name);
        expect(mapped?.voices).toHaveLength(native.voices.length);
    });

    it('should copy pitch range when converting a native voice', () => {
        const native = getNativeDrumKitById('factory-808') as NativeDrumKit;
        const src = native.voices[0]!;
        const voice = toDrumKitVoice(src);
        expect(voice.pitchRange).not.toBe(src.pitchRange);
        expect(voice.pitchRange).toEqual(src.pitchRange);
    });
});
