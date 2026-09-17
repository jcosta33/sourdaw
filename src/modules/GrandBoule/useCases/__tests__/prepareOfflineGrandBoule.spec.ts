import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toGrandBouleDeviceState } from '../../models/GrandBouleDeviceState';
import { projectGrandBouleMorphState } from '../../models/ProjectGrandBouleMorphState';
import {
    createGrandBouleStore,
    createDefaultGrandBouleState,
    resetGrandBouleStores,
} from '../../stores/grandBouleStore';
import { prepareOfflineGrandBoule } from '../prepareOfflineGrandBoule';

describe('prepareOfflineGrandBoule', () => {
    beforeEach(() => {
        resetGrandBouleStores();
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
