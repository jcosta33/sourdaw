import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, setActionHistoryMetadataPort } from '#/modules/Command/useCases';

import { handleSetDeviceParameter } from '../../../../handlers/device/handleSetDeviceParameter';
import { createTrack, type Track } from '../../../../models/Track';
import { defaultTrackState, trackStore } from '../../../../stores/trackStore';
import { setDeviceParameter } from '../setDeviceParameter';

import type { TrackState } from '../../../../repositories/track/getTrackState';

const mocks = vi.hoisted(() => {
    const transportStoreValue: unknown = { isPlaying: false };
    return {
        getTrackState: vi.fn<typeof import('../../../../repositories/track/getTrackState').getTrackState>(),
        updateTrack: vi.fn<typeof import('../../../../repositories/track/updateTrack').updateTrack>(),
        transportStoreValue,
        updateDeviceParam: vi.fn<typeof import('#/modules/AudioEngine/useCases').updateDeviceParam>(),
        recordAutomationValue: vi.fn<typeof import('#/modules/Automation/useCases').recordAutomationValue>(),
    };
});

const actionHistoryMetadataPort = {
    record: vi.fn(() => []),
    markReverted: vi.fn(() => ({ status: 'unavailable' as const })),
    clear: vi.fn(),
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

vi.mock('../../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: {
        get value() {
            return mocks.transportStoreValue;
        },
    },
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/useCases')>()),
    recordAutomationValue: mocks.recordAutomationValue,
}));

describe('setDeviceParameter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        registerHandlerMap({ setDeviceParameter: handleSetDeviceParameter });
        clearUndoHistory();
        macroStore.set({ macros: [], recording: true, currentRecording: [] });
        setActionHistoryMetadataPort(actionHistoryMetadataPort);
        mocks.transportStoreValue = { isPlaying: false };
        trackStore.set(defaultTrackState);
    });

    afterEach(() => {
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        clearUndoHistory();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
    });

    function makeTrack(id: string, deviceId = 'd1'): Track {
        const track = createTrack({ id, name: id, kind: 'audio' });
        track.devices = [
            { id: deviceId, name: 'Device', type: 'device', bypassed: false, parameterValues: { gain: 0.1 } },
        ];
        return track;
    }

    function makeTrackWithoutDevices(id: string): Track {
        return createTrack({ id, name: id, kind: 'audio' });
    }

    function setTrackState(tracks: Track[]): void {
        const state: TrackState = { tracks, selectedTrackId: null };
        trackStore.set({ ...defaultTrackState, tracks });
        mocks.getTrackState.mockReturnValue(state);
    }

    function setRuntimeKind(track: Track, kind: string): Track {
        Object.defineProperty(track, 'kind', { configurable: true, enumerable: true, value: kind });
        return track;
    }

    it('updates parameter in store and engine', () => {
        setTrackState([makeTrack('t1')]);

        const didWrite = setDeviceParameter('d1', 'gain', 0.5);

        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'gain', 0.5);
        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));

        const updater = mocks.updateTrack.mock.calls[0]![1];
        const result = updater(makeTrack('t1'));
        expect(result.devices[0]!.parameterValues.gain).toBe(0.5);
        expect(didWrite).toBe(true);
    });

    it('refuses writes to internal engine configuration', () => {
        const track = makeTrack('t1');
        track.devices[0] = {
            id: 'd1',
            name: 'Dutch Oven',
            type: 'dutch-oven',
            bypassed: false,
            parameterValues: { fdn_damping_version: 2, damping: 0.3 },
        };
        setTrackState([track]);

        expect(setDeviceParameter('d1', 'fdn_damping_version', 1)).toBe(false);
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('leaves sibling devices untouched while updating only the targeted device', () => {
        const track = makeTrack('t1', 'target');
        track.devices = [
            { id: 'sibling', name: 'Sibling', type: 'device', bypassed: false, parameterValues: { gain: 0.2 } },
            { id: 'target', name: 'Target', type: 'device', bypassed: false, parameterValues: { gain: 0.1 } },
        ];
        setTrackState([track]);

        const didWrite = setDeviceParameter('target', 'gain', 0.9);

        expect(didWrite).toBe(true);
        const updater = mocks.updateTrack.mock.calls[0]![1];
        const result = updater(track);
        // Sibling device keeps its value; only the target device changes.
        expect(result.devices[0]).toMatchObject({ id: 'sibling', parameterValues: { gain: 0.2 } });
        expect(result.devices[1]).toMatchObject({ id: 'target', parameterValues: { gain: 0.9 } });
    });

    it('records automation if playing and recording mode', () => {
        const track = makeTrack('t1');
        track.automationMode = 'write';
        setTrackState([track]);
        mocks.transportStoreValue = { isPlaying: true, playheadPosition: 8 };

        const didWrite = setDeviceParameter('d1', 'cutoff', 1000);

        expect(mocks.recordAutomationValue).toHaveBeenCalledWith('t1', 'd1:cutoff', 1000, 8);
        expect(didWrite).toBe(true);
    });

    it('bails if value is not finite', () => {
        const didWrite = setDeviceParameter('d1', 'gain', NaN);
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('rejects dormant VCA parameter updates before engine, project, or automation work', () => {
        const track = createTrack({ id: 'vca-1', name: 'VCA', kind: 'audio' });
        Object.defineProperty(track, 'kind', { configurable: true, enumerable: true, value: 'vca' });
        track.devices = [{ id: 'd1', name: 'Device', type: 'device', bypassed: false, parameterValues: {} }];
        track.automationMode = 'write';
        setTrackState([track]);
        mocks.transportStoreValue = { isPlaying: true, playheadPosition: 8 };

        const didWrite = setDeviceParameter('d1', 'gain', 0.5);

        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.recordAutomationValue).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it.each([
        ['eligible owner first', [makeTrack('track-1'), setRuntimeKind(makeTrack('vca-1'), 'vca')]],
        ['ineligible owner first', [setRuntimeKind(makeTrack('vca-1'), 'vca'), makeTrack('track-1')]],
    ])('rejects duplicate ownership with %s before engine, project, or automation work', (_label, tracks) => {
        setTrackState(tracks);
        mocks.transportStoreValue = { isPlaying: true, playheadPosition: 8 };

        const didWrite = setDeviceParameter('d1', 'gain', 0.5);

        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.recordAutomationValue).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it.each([
        ['an empty owner identity', () => [makeTrack('')]],
        [
            'a duplicate identity with the device owner first',
            () => [makeTrack('duplicate-track'), makeTrackWithoutDevices('duplicate-track')],
        ],
        [
            'a duplicate identity with the device owner second',
            () => [makeTrackWithoutDevices('duplicate-track'), makeTrack('duplicate-track')],
        ],
    ] as const)('rejects registered writes for %s with zero effects', async (_label, makeTracks) => {
        setTrackState(makeTracks());
        mocks.transportStoreValue = { isPlaying: true, playheadPosition: 8 };

        await executeAppAction({
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'gain', value: 0.5 },
        });

        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.recordAutomationValue).not.toHaveBeenCalled();
        expect(macroStore.value?.currentRecording).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
        expect(actionHistoryMetadataPort.record).not.toHaveBeenCalled();
    });

    function makeDescribedTrack(id: string, deviceId = 'd1'): Track {
        const track = createTrack({ id, name: id, kind: 'audio' });
        // A device type that actually carries a descriptor, so the declared
        // range is real rather than fixture-invented. `mix` is declared 0..1.
        track.devices = [
            {
                id: deviceId,
                name: 'Dutch Oven',
                type: 'dutch-oven',
                bypassed: false,
                parameterValues: { mix: 0.5 },
            },
        ];
        return track;
    }

    it('holds a write above the declared maximum to that maximum, in the engine and the store', () => {
        setTrackState([makeDescribedTrack('t1')]);

        expect(setDeviceParameter('d1', 'mix', 12)).toBe(true);

        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'mix', 1);

        const updater = mocks.updateTrack.mock.calls[0]![1];
        const updated = updater(makeDescribedTrack('t1'));
        expect(updated.devices[0]!.parameterValues.mix).toBe(1);
    });

    it('holds a write below the declared minimum to that minimum', () => {
        setTrackState([makeDescribedTrack('t1')]);

        expect(setDeviceParameter('d1', 'mix', -3)).toBe(true);

        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'mix', 0);
    });

    it('records the value that actually landed, not the one that was asked for', () => {
        mocks.transportStoreValue = { isPlaying: true, playheadPosition: 4 };
        const track = makeDescribedTrack('t1');
        track.automationMode = 'write';
        setTrackState([track]);

        setDeviceParameter('d1', 'mix', 12);

        // Recording the requested value would write a curve the engine can
        // never reproduce, and the lane would drift from the device on replay.
        expect(mocks.recordAutomationValue).toHaveBeenCalledWith('t1', 'd1:mix', 1, 4);
    });

    it('leaves a parameter with no declared range untouched', () => {
        setTrackState([makeTrack('t1')]);

        expect(setDeviceParameter('d1', 'gain', 4200)).toBe(true);

        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'gain', 4200);
    });
});
