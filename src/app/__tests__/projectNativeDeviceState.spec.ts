/**
 * The composition-root dispatch a native device's own `deviceState` (or
 * per-device store) projects through (#3124, #4302, #4727).
 *
 * `nativeBuiltinParameterNames.spec.ts` covers the parallel per-parameter
 * name table; this covers the per-device-type table `AudioDeviceRuntimeSink`
 * calls through `projectDeviceForNativeBody`. Grand Boule's arm reads both
 * sources: calibration lives in a per-device store, not in `deviceState`, so
 * a native body built fresh at Play must start on a calibrated half-pedal
 * edge (#4302) — and the tuning and preset voicing live only in the chunk
 * (#4727), so the same body must come up on the temperament and voicing the
 * project saved rather than the DSP's Equal/neutral defaults.
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

    it('projects a calibrated Grand Boule store by deviceId and folds the chunk voicing beside it', () => {
        // A committed chunk, not `undefined`: every Grand Boule that has had one
        // morph edit carries one (`commitGrandBouleDeviceState`). The
        // calibration values must still come from the store — a chunk carrying
        // a different calibration never reaches this arm — while the chunk's
        // tuning and voicing fold beside them. This chunk predates #4727 (it
        // holds the morph leaves only), so the fold restores Equal and the
        // neutral voicing, exactly what a pre-#4727 project sounded.
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

        expect(projected).toEqual({
            temperament: 0,
            hammer_hardness: 0,
            tone_tilt: 0,
            stereo_width: 0.6,
            velocity_curve: 1,
            sustain_threshold: 0.6,
            cc_smoothing_ms: 40,
        });
    });

    it('folds the chunk temperament and voicing a rebuilt native body must start on', () => {
        // A project saved with Werckmeister III and a shaped voicing must not
        // reload onto Equal/neutral on the native carrier: the body is built
        // from this projection at session start and at every Play-time
        // topology rebuild, and no live-store push covers a body that does not
        // carry the tuning yet (#4727).
        const deviceState = {
            version: 1,
            data: {
                modelA: 'mellow-grand',
                modelB: 'singing-grand',
                morphPosition: 0.4,
                layerBalance: -0.2,
                enabled: true,
                temperament: 1,
                hammerHardness: 0.3,
                velocityCurve: 1.25,
                stereoWidth: 0.8,
                toneTilt: -0.4,
            },
        };

        const projected = projectNativeDeviceState({
            deviceId: 'grand-boule-voiced',
            deviceType: 'grand-boule',
            deviceState,
        });

        expect(projected).toEqual({
            temperament: 1,
            hammer_hardness: 0.3,
            tone_tilt: -0.4,
            stereo_width: 0.8,
            velocity_curve: 1.25,
        });
    });

    it('lets the live store win when its voicing diverges from the chunk', () => {
        // Store-wins is the capture's precedence: the store holds what the
        // user hears right now, including a preview mid-drag, while the chunk
        // only catches up at commit. A peer's commit never reconciles the
        // local store (#4894), so after one the two genuinely diverge until
        // reload or node recreation — and the projection still follows the
        // store, the same source the live web carrier plays from.
        const deviceId = 'grand-boule-divergent';
        const store = createGrandBouleStore(deviceId);
        const state = createDefaultGrandBouleState();
        store.set({
            ...state,
            temperament: 1,
            parameters: {
                ...state.parameters,
                hammerHardness: 0.5,
                velocityCurve: 1.4,
                stereoWidth: 0.7,
                toneTilt: 0.2,
            },
        });
        // A chunk carrying a different temperament and voicing — what a peer
        // or an older save would hold while the local store is stale.
        const deviceState = {
            version: 1,
            data: {
                modelA: 'balanced-grand',
                modelB: 'clear-grand',
                morphPosition: 0.3,
                layerBalance: 0,
                enabled: true,
                temperament: 3,
                hammerHardness: -0.5,
                velocityCurve: 0.75,
                stereoWidth: 0.2,
                toneTilt: -0.8,
            },
        };

        const projected = projectNativeDeviceState({ deviceId, deviceType: 'grand-boule', deviceState });

        expect(projected).toEqual({
            temperament: 1,
            hammer_hardness: 0.5,
            tone_tilt: 0.2,
            stereo_width: 0.7,
            velocity_curve: 1.4,
            sustain_threshold: 0.15,
            cc_smoothing_ms: 5,
        });
    });

    it('rejects a chunk with an invalid temperament to the wholesale default', () => {
        // The decoder's contract: a temperament leaf outside the six-value
        // vocabulary corrupts the whole chunk, so the fold restores Equal and
        // the neutral voicing rather than salvaging the voicing leaves.
        const deviceState = {
            version: 1,
            data: {
                modelA: 'balanced-grand',
                modelB: 'clear-grand',
                morphPosition: 0.3,
                layerBalance: 0,
                enabled: true,
                temperament: 9,
                hammerHardness: 0.3,
                velocityCurve: 1.25,
                stereoWidth: 0.8,
                toneTilt: -0.4,
            },
        };

        const projected = projectNativeDeviceState({
            deviceId: 'grand-boule-corrupt',
            deviceType: 'grand-boule',
            deviceState,
        });

        expect(projected).toEqual({
            temperament: 0,
            hammer_hardness: 0,
            tone_tilt: 0,
            stereo_width: 0.6,
            velocity_curve: 1,
        });
    });

    it('answers null for a grand-boule device with no calibrated store', () => {
        const projected = projectNativeDeviceState({
            deviceId: 'grand-boule-untouched',
            deviceType: 'grand-boule',
            deviceState: undefined,
        });

        expect(projected).toBeNull();
    });

    it('projects exactly the calibration keys for a calibrated store with no chunk', () => {
        // The chunkless branch must carry the calibration alone. Folding the
        // five default voicing keys into it stays green across every chunked
        // case, so this pins the branch's exact shape — the two calibration
        // keys and nothing else.
        const deviceId = 'grand-boule-chunkless';
        const store = createGrandBouleStore(deviceId);
        const state = createDefaultGrandBouleState();
        store.set({
            ...state,
            midiCalibration: { ...state.midiCalibration, sustainThreshold: 0.6, ccSmoothingMs: 40 },
        });

        const projected = projectNativeDeviceState({
            deviceId,
            deviceType: 'grand-boule',
            deviceState: undefined,
        });

        expect(projected).toEqual({
            sustain_threshold: 0.6,
            cc_smoothing_ms: 40,
        });
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
