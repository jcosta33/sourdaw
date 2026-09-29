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

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type Track, trackStore } from '#/modules/Arrangement/stores';
import {
    createGrandBouleStore,
    createDefaultGrandBouleState,
    resetGrandBouleStores,
} from '#/modules/GrandBoule/stores';
import { reconcileGrandBouleDevicesFromProject } from '#/modules/GrandBoule/useCases';

import { projectNativeDeviceState } from '../projectNativeDeviceState';

// The reconcile's engine half addresses the live AudioContext through
// `ensureTrackStrip`, which does not exist under Vitest. Answering an empty
// strip sends `resolveGrandBouleEngine` down its disconnected-handle branch, so
// the sweep exercises the store fold this spec asserts and skips the engine;
// the ready-engine sync is the module spec's subject.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return { ...actual, ensureTrackStrip: () => ({ deviceNodes: [] }) };
});

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
        // only catches up at commit. Before #4894's document-origin reconcile
        // a peer's commit left the two genuinely diverged until reload; the
        // projection still follows the store, the same source the live web
        // carrier plays from — which is why the reconcile, not this arm, is
        // what closes the window.
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

    it('projects the peer-committed temperament once the document-origin reconcile has closed the window (#4894)', () => {
        // The store holds temperament 1 from load; the chunk holds the peer's
        // 5. Store-wins alone would keep projecting 1 forever — this is the
        // stale-mirror window #4894 filed. The document-origin reconcile (the
        // subscription's sweep) folds the chunk back into the store, and the
        // same capture this arm performs then projects the peer's temperament.
        const deviceId = 'grand-boule-reconciled';
        const deviceState = {
            version: 1,
            data: {
                modelA: 'balanced-grand',
                modelB: 'clear-grand',
                morphPosition: 0.3,
                layerBalance: 0,
                enabled: true,
                temperament: 5,
                hammerHardness: -0.4,
                velocityCurve: 1.1,
                stereoWidth: 0.9,
                toneTilt: 0.25,
            },
        };
        const store = createGrandBouleStore(deviceId);
        const state = createDefaultGrandBouleState();
        store.set({ ...state, temperament: 1 });
        trackStore.set({ tracks: [trackCarrying(deviceId, deviceState)], selectedTrackId: null, ghostClips: [] });
        try {
            expect(projectNativeDeviceState({ deviceId, deviceType: 'grand-boule', deviceState })?.temperament).toBe(1);

            reconcileGrandBouleDevicesFromProject();

            expect(projectNativeDeviceState({ deviceId, deviceType: 'grand-boule', deviceState })).toEqual({
                temperament: 5,
                hammer_hardness: -0.4,
                tone_tilt: 0.25,
                stereo_width: 0.9,
                velocity_curve: 1.1,
                sustain_threshold: 0.15,
                cc_smoothing_ms: 5,
            });
        } finally {
            trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        }
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

/**
 * Built here rather than imported from Arrangement's `TrackDummy`: an app-level
 * spec reaches Arrangement only through its contract barrel, and the reconcile
 * reads the device — id, type and `deviceState` chunk — off this strip.
 */
function trackCarrying(deviceId: string, deviceState: NonNullable<Track['devices'][number]['deviceState']>): Track {
    return {
        id: 'track-with-grand',
        name: 'Piano',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#0000ff',
        clips: [],
        devices: [
            {
                id: deviceId,
                name: 'Grand Boule',
                type: 'grand-boule',
                bypassed: false,
                parameterValues: {},
                deviceState,
            },
        ],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
}
