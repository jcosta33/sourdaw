import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toGrandBouleDeviceState } from '../../models/GrandBouleDeviceState';
import { projectGrandBouleMorphState } from '../../models/ProjectGrandBouleMorphState';
import {
    createGrandBouleStore,
    createDefaultGrandBouleState,
    resetGrandBouleStores,
} from '../../stores/grandBouleStore';
import { captureOfflineGrandBoule } from '../captureOfflineGrandBoule';
import { prepareOfflineGrandBoule } from '../prepareOfflineGrandBoule';

describe('prepareOfflineGrandBoule', () => {
    beforeEach(() => {
        resetGrandBouleStores();
    });

    it('keeps captured calibration independent of a replaced same-id store', () => {
        const morph = {
            modelA: 'mellow-grand',
            modelB: 'singing-grand',
            morphPosition: 0.4,
            layerBalance: 0.2,
            enabled: true,
        };
        const original = createDefaultGrandBouleState();
        original.midiCalibration.sustainThreshold = 0.61;
        original.midiCalibration.ccSmoothingMs = 41;
        createGrandBouleStore('same-id').set(original);
        const captured = captureOfflineGrandBoule({ deviceId: 'same-id', deviceState: toGrandBouleDeviceState(morph) });
        original.midiCalibration.sustainThreshold = 0.02;
        createGrandBouleStore('same-id').set(createDefaultGrandBouleState());
        const postMessage = vi.fn();

        prepareOfflineGrandBoule({
            deviceId: 'same-id',
            deviceState: undefined,
            port: { postMessage } as unknown as MessagePort,
            captured,
        });

        expect(postMessage).toHaveBeenCalledWith({ type: 'param', name: 'sustain_threshold', value: 0.61 });
        expect(postMessage).toHaveBeenCalledWith({ type: 'param', name: 'cc_smoothing_ms', value: 41 });
        for (const parameter of projectGrandBouleMorphState(morph)) {
            expect(postMessage).toHaveBeenCalledWith({ type: 'param', ...parameter });
        }
    });

    it('captures explicit calibration without writing the live store and preserves explicit absence', () => {
        const state = createDefaultGrandBouleState();
        createGrandBouleStore('same-id').set(state);
        const before = structuredClone(createGrandBouleStore('same-id').value);
        const calibration = { sustain_threshold: 0.49, cc_smoothing_ms: 33 };
        const alternate = captureOfflineGrandBoule({ deviceId: 'same-id', deviceState: undefined, calibration });
        const absent = captureOfflineGrandBoule({ deviceId: 'same-id', deviceState: undefined, calibration: null });
        calibration.sustain_threshold = 0.03;
        const postMessage = vi.fn();

        prepareOfflineGrandBoule({
            deviceId: 'same-id',
            deviceState: undefined,
            port: { postMessage } as unknown as MessagePort,
            captured: alternate,
        });
        expect(postMessage).toHaveBeenCalledWith({ type: 'param', name: 'sustain_threshold', value: 0.49 });
        postMessage.mockClear();
        prepareOfflineGrandBoule({
            deviceId: 'same-id',
            deviceState: undefined,
            port: { postMessage } as unknown as MessagePort,
            captured: absent,
        });
        expect(postMessage.mock.calls.map(([message]) => message.name)).not.toContain('sustain_threshold');
        expect(createGrandBouleStore('same-id').value).toEqual(before);
    });

    it('projects the immutable render snapshot when live project state differs', () => {
        const snapshotMorph = {
            modelA: 'mellow-grand',
            modelB: 'singing-grand',
            morphPosition: 0.4,
            layerBalance: 0.2,
            enabled: true,
        };
        const liveMorph = { ...snapshotMorph, morphPosition: 0.9, layerBalance: -0.7 };
        const postMessage = vi.fn();

        prepareOfflineGrandBoule({
            deviceId: 'grand-boule-offline-no-store',
            deviceState: toGrandBouleDeviceState(snapshotMorph),
            port: { postMessage } as unknown as MessagePort,
        });

        const posted = postMessage.mock.calls.map(([message]) => message);
        expect(posted).toEqual(
            projectGrandBouleMorphState(snapshotMorph).map((parameter) => ({ type: 'param', ...parameter }))
        );
        expect(posted).not.toEqual(
            projectGrandBouleMorphState(liveMorph).map((parameter) => ({ type: 'param', ...parameter }))
        );
    });

    it('posts the calibration params after the morph ones for a calibrated store', () => {
        const deviceId = 'grand-boule-offline-calibrated';
        const state = createDefaultGrandBouleState();
        createGrandBouleStore(deviceId).set({
            ...state,
            midiCalibration: { ...state.midiCalibration, sustainThreshold: 0.6, ccSmoothingMs: 40 },
        });
        const morph = {
            modelA: 'mellow-grand',
            modelB: 'singing-grand',
            morphPosition: 0.4,
            layerBalance: 0.2,
            enabled: true,
        };
        const postMessage = vi.fn();

        prepareOfflineGrandBoule({
            deviceId,
            deviceState: toGrandBouleDeviceState(morph),
            port: { postMessage } as unknown as MessagePort,
        });

        const posted = postMessage.mock.calls.map(([message]) => message);
        const morphMessages = projectGrandBouleMorphState(morph).map((parameter) => ({ type: 'param', ...parameter }));
        expect(posted).toEqual([
            ...morphMessages,
            { type: 'param', name: 'sustain_threshold', value: 0.6 },
            { type: 'param', name: 'cc_smoothing_ms', value: 40 },
        ]);
    });

    it('posts no calibration params for a device with no store', () => {
        const morph = {
            modelA: 'mellow-grand',
            modelB: 'singing-grand',
            morphPosition: 0.4,
            layerBalance: 0.2,
            enabled: true,
        };
        const postMessage = vi.fn();

        prepareOfflineGrandBoule({
            deviceId: 'grand-boule-offline-untouched',
            deviceState: toGrandBouleDeviceState(morph),
            port: { postMessage } as unknown as MessagePort,
        });

        const posted = postMessage.mock.calls.map(([message]) => message);
        expect(posted).toEqual(
            projectGrandBouleMorphState(morph).map((parameter) => ({ type: 'param', ...parameter }))
        );
    });
});
