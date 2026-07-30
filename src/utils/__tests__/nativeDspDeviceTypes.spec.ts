import { describe, expect, it } from 'vitest';

import { NATIVE_DSP_DEVICE_TYPES, resolveNativeDspDeviceType } from '../nativeDspDeviceTypes';

describe('resolveNativeDspDeviceType', () => {
    it('returns each canonical type unchanged', () => {
        const resolved = NATIVE_DSP_DEVICE_TYPES.map((type) => resolveNativeDspDeviceType(type));

        expect(resolved).toEqual([...NATIVE_DSP_DEVICE_TYPES]);
    });

    it('returns null for a type no native factory builds', () => {
        // `synth` and `builtin-drum-kit` are real device types — they are voiced by
        // the note schedulers and contribute no chain node, so they never reach a
        // native factory. `external-plugin` is a real type the offline path cannot
        // render at all.
        expect(resolveNativeDspDeviceType('synth')).toBeNull();
        expect(resolveNativeDspDeviceType('builtin-drum-kit')).toBeNull();
        expect(resolveNativeDspDeviceType('external-plugin')).toBeNull();
        expect(resolveNativeDspDeviceType('')).toBeNull();
    });

    // `isKneadDevice` case-folds where the other ten matchers use exact equality,
    // so `Knead` is a type that genuinely builds. The resolver has to agree, or the
    // hydration table would miss a device the chain constructed.
    it('case-folds knead, and only knead', () => {
        expect(resolveNativeDspDeviceType('Knead')).toBe('knead');
        expect(resolveNativeDspDeviceType('KNEAD')).toBe('knead');

        // The others stay exact: case-folding them would resolve types that no
        // factory matches and no chain ever builds.
        expect(resolveNativeDspDeviceType('Toaster')).toBeNull();
        expect(resolveNativeDspDeviceType('Levain')).toBeNull();
        expect(resolveNativeDspDeviceType('Proof')).toBeNull();
    });
});

describe('NATIVE_DSP_DEVICE_TYPES', () => {
    it('holds no duplicates, which would silently collapse a hydration row', () => {
        expect(new Set(NATIVE_DSP_DEVICE_TYPES).size).toBe(NATIVE_DSP_DEVICE_TYPES.length);
    });
});
