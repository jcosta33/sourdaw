import { describe, it, expect } from 'vitest';

import { findWasmDescriptor } from '../../../engine/wasmDeviceRegistry';
import { isNativeDspDevice, NATIVE_DSP_DEVICE_FACTORIES } from '../nativeDspDeviceFactories';

/**
 * Every device type the app can place on a track that is backed by a native
 * WASM DSP engine. Adding an engine means adding it here — the point of this
 * list is that it is written by hand and cross-checked against both registries.
 */
const NATIVE_DSP_DEVICE_TYPES = [
    'fermenter',
    'toaster',
    'levain',
    'grand-boule',
    'gluten',
    'bacteria',
    'grinder',
    'proof',
    'dutch-oven',
    'native-scoring',
    'knead',
] as const;

describe('native DSP device coverage', () => {
    // MD-4 review — `grand-boule` had a branch in createNativeDspStrategy but was
    // missing from the offline registry's matcher, so no factory claimed it,
    // `createDevice` threw, and `buildDeviceChain` skipped it: a frozen or
    // bounced GrandBoule track rendered silence. Live playback was unaffected
    // (it goes through wasmDeviceRegistry), which is exactly why the gap
    // survived — only a cross-check of the two registries catches it.
    it.each(NATIVE_DSP_DEVICE_TYPES)('claims %s in both the live and the offline device registry', (deviceType) => {
        expect(findWasmDescriptor(deviceType)).toBeDefined();
        expect(isNativeDspDevice(deviceType)).toBe(true);
    });

    it('has no factory that the offline matcher fails to claim', () => {
        const unclaimed = NATIVE_DSP_DEVICE_TYPES.filter(
            (deviceType) =>
                NATIVE_DSP_DEVICE_FACTORIES.some((factory) => factory.matches(deviceType)) !==
                isNativeDspDevice(deviceType)
        );

        expect(unclaimed).toEqual([]);
    });

    it('does not claim a device type no native engine backs', () => {
        expect(isNativeDspDevice('builtin-filter')).toBe(false);
        expect(isNativeDspDevice('faust-zita-rev1-reverb')).toBe(false);
    });
});
