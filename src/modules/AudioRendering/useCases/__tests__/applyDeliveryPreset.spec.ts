import { describe, expect, it } from 'vitest';

import { DELIVERY_PRESETS } from '../../models/deliveryPresets';
import { applyDeliveryPreset } from '../applyDeliveryPreset';

describe('applyDeliveryPreset', () => {
    it('fills all fields once and only explicit reset replaces an edited target', () => {
        const preset = DELIVERY_PRESETS[3];
        const original = applyDeliveryPreset({ preset });
        expect(original).toEqual({
            formats: ['mp3'],
            sampleRate: 44100,
            bitDepth: 24,
            channels: 2,
            mp3BitRate: 192,
            normalization: 'r128',
            targetLufs: -16,
            ceilingDbTp: -1,
        });
        const edited = { ...original, sampleRate: 48000, channels: 1 as const, targetLufs: -20 };
        expect(applyDeliveryPreset({ preset, current: edited })).toBe(edited);
        expect(applyDeliveryPreset({ preset, current: edited, reset: true })).toEqual(original);
        expect(edited.targetLufs).toBe(-20);
    });
});
