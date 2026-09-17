/**
 * The composition-root dispatch a native device's own `deviceState` (or
 * per-device store, for the one arm that reads neither) projects through
 * (#3124, #4302).
 *
 * `nativeBuiltinParameterNames.spec.ts` covers the parallel per-parameter
 * name table; this covers the per-device-type table `AudioDeviceRuntimeSink`
 * calls through `projectDeviceForNativeBody`. Grand Boule's arm is the one
 * case that ignores `deviceState` and reads `deviceId` instead — a native
 * body built fresh at Play must start on a calibrated half-pedal edge rather
 * than the DSP's own default, and calibration lives in a per-device store, not
 * in `deviceState`.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
    createGrandBouleStore,
    createDefaultGrandBouleState,
    resetGrandBouleStores,
} from '#/modules/GrandBoule/stores';

import { projectNativeDeviceState } from '../projectNativeDeviceState';

describe('projectNativeDeviceState', () => {
    beforeEach(() => {
        resetGrandBouleStores();
    });

    it('projects a calibrated Grand Boule store by deviceId, ignoring a committed deviceState chunk', () => {
        // A committed chunk, not `undefined`: every Grand Boule that has had one
        // morph edit carries one (`commitGrandBouleDeviceState`), so a case that
        // only ever passes `undefined` cannot tell this arm apart from one that
        // reads `deviceState` after all — a chunk-dependent
        // `deviceState ? null : projectGrandBouleCalibrationToNativePatch(...)`
        // would stay green here.
        const deviceId = 'grand-boule-device-a';
        const store = createGrandBouleStore(deviceId);
        const state = createDefaultGrandBouleState();
        store.set({
            ...state,
            midiCalibration: { ...state.midiCalibration, sustainThreshold: 0.6, ccSmoothingMs: 40 },
        });
        const deviceState = {
            version: 1,
            data: {
                modelA: 'balanced-grand',
                modelB: 'clear-grand',
                morphPosition: 0.3,
                layerBalance: 0,
                enabled: true,
            },
        };

        const projected = projectNativeDeviceState({ deviceId, deviceType: 'grand-boule', deviceState });

        expect(projected).toEqual({ sustain_threshold: 0.6, cc_smoothing_ms: 40 });
    });

    it('answers null for a grand-boule device with no calibrated store', () => {
        const projected = projectNativeDeviceState({
            deviceId: 'grand-boule-untouched',
            deviceType: 'grand-boule',
            deviceState: undefined,
        });

        expect(projected).toBeNull();
    });

    it('answers null for a toaster device with no committed deviceState', () => {
        const projected = projectNativeDeviceState({
            deviceId: 'toaster-device-a',
            deviceType: 'toaster',
            deviceState: undefined,
        });

        expect(projected).toBeNull();
    });

    it('answers null for a levain device with no committed deviceState', () => {
        const projected = projectNativeDeviceState({
            deviceId: 'levain-device-a',
            deviceType: 'levain',
            deviceState: undefined,
        });

        expect(projected).toBeNull();
    });

    it('answers null for a device type with no native body at all', () => {
        const projected = projectNativeDeviceState({
            deviceId: 'device-a',
            deviceType: 'plugin',
            deviceState: undefined,
        });

        expect(projected).toBeNull();
    });
});
