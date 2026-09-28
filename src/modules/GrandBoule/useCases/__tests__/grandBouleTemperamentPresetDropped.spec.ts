import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Grand Boule's temperament and preset voicing reach the live piano and
 * nowhere else: no project write records them, and the offline render that
 * exports the track never hears them. The live piano plays Werckmeister III
 * while the bounce plays Equal temperament, and a reload forgets it.
 *
 * The controls prove the observables can see what they claim: a morph-model
 * pick on the same device dispatches a project write, and the calibration kept
 * in the same per-device store reaches the same offline preparation.
 */

const mocks = vi.hoisted(() => ({
    engine: {
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        noteOnMidi2: vi.fn(),
        setParam: vi.fn(),
        setCalibration: vi.fn(),
        setSustain: vi.fn(),
        setUnaCorda: vi.fn(),
        setSostenuto: vi.fn(),
        setTemperament: vi.fn(),
        allNotesOff: vi.fn(),
        isReady: () => true,
        getAnalyserNode: () => null,
        sampleRate: () => 48000,
    },
    executeAppAction: vi.fn((_action: unknown) => Promise.resolve(undefined)),
    executeUserAppAction: vi.fn((_action: unknown) => Promise.resolve(undefined)),
    trackStore: {
        value: {
            tracks: [
                {
                    id: 'track-piano',
                    kind: 'midi',
                    devices: [{ id: 'grand-1', type: 'grand-boule', deviceState: undefined, parameterValues: {} }],
                },
            ],
        },
    },
}));

vi.mock('../resolveGrandBouleEngine', () => ({ resolveGrandBouleEngine: () => mocks.engine }));
vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    executeUserAppAction: mocks.executeUserAppAction,
}));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));

import { createGrandBouleStore, resetGrandBouleStores } from '../../stores/grandBouleStore';
import { loadGrandBoulePreset } from '../loadGrandBoulePreset';
import { prepareOfflineGrandBoule } from '../prepareOfflineGrandBoule';
import { setGrandBouleMorphModel } from '../setGrandBouleMorphModel';
import { setGrandBouleTemperament } from '../setGrandBouleTemperament';

const DEVICE_ID = 'grand-1';
const WERCKMEISTER_III = 1;

type PostedMessage = { type: string; name?: string; value?: number; index?: number };

function offlineMessages(): PostedMessage[] {
    const postMessage = vi.fn();
    prepareOfflineGrandBoule({
        deviceId: DEVICE_ID,
        deviceState: undefined,
        port: { postMessage } as unknown as MessagePort,
    });
    return postMessage.mock.calls.map(([message]) => message as PostedMessage);
}

function deviceAddressedDispatches(): unknown[] {
    return [...mocks.executeAppAction.mock.calls, ...mocks.executeUserAppAction.mock.calls]
        .map(([action]) => action)
        .filter((action) => JSON.stringify(action).includes(`"${DEVICE_ID}"`));
}

function carriesTemperament(message: PostedMessage, index: number): boolean {
    if (message.type === 'temperament') {
        return message.index === index;
    }
    return message.type === 'param' && message.name === 'temperament' && message.value === index;
}

describe('Grand Boule temperament and preset reach project truth and the offline render', () => {
    beforeEach(() => {
        resetGrandBouleStores();
        vi.clearAllMocks();
    });

    afterEach(() => {
        resetGrandBouleStores();
    });

    it('control: calibration held in the per-device store reaches offline preparation', () => {
        const store = createGrandBouleStore(DEVICE_ID);
        const state = store.value;
        if (state === null) {
            throw new Error('Expected a live Grand Boule store');
        }
        store.set({ ...state, midiCalibration: { ...state.midiCalibration, sustainThreshold: 0.61 } });

        expect(offlineMessages()).toContainEqual({ type: 'param', name: 'sustain_threshold', value: 0.61 });
    });

    it('control: a morph-model pick on the same device dispatches a project write', () => {
        const store = createGrandBouleStore(DEVICE_ID);
        setGrandBouleMorphModel({
            deviceId: DEVICE_ID,
            engine: mocks.engine,
            store,
            slot: 'modelA',
            modelId: 'mellow-grand',
        });

        expect(deviceAddressedDispatches()).not.toHaveLength(0);
    });

    it('renders offline in the temperament the live piano plays', () => {
        const store = createGrandBouleStore(DEVICE_ID);
        setGrandBouleTemperament({ deviceId: DEVICE_ID, temperament: WERCKMEISTER_III, store });

        expect(mocks.engine.setTemperament).toHaveBeenCalledWith({ index: WERCKMEISTER_III });
        expect(offlineMessages().some((message) => carriesTemperament(message, WERCKMEISTER_III))).toBe(true);
    });

    it('records a temperament change in project truth so a reload keeps it', () => {
        const store = createGrandBouleStore(DEVICE_ID);
        setGrandBouleTemperament({ deviceId: DEVICE_ID, temperament: WERCKMEISTER_III, store });

        expect(store.value?.temperament).toBe(WERCKMEISTER_III);
        expect(deviceAddressedDispatches()).not.toHaveLength(0);
    });

    it('renders offline with the preset voicing the live piano plays', () => {
        const store = createGrandBouleStore(DEVICE_ID);
        expect(loadGrandBoulePreset({ engine: mocks.engine, presetId: 'grand-boule-bright', store })).toBe(true);
        const hammerHardness = store.value?.parameters.hammerHardness;

        expect(mocks.engine.setParam).toHaveBeenCalledWith({ name: 'hammer_hardness', value: hammerHardness });
        expect(offlineMessages()).toContainEqual({ type: 'param', name: 'hammer_hardness', value: hammerHardness });
    });
});
