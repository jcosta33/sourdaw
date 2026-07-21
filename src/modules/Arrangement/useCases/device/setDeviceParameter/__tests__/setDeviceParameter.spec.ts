import { describe, it, expect, vi, beforeEach } from 'vitest';

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
        mocks.transportStoreValue = { isPlaying: false };
        trackStore.set(defaultTrackState);
    });

    function makeTrack(id: string, deviceId = 'd1'): Track {
        const track = createTrack({ id, name: id, kind: 'audio' });
        track.devices = [
            { id: deviceId, name: 'Device', type: 'device', bypassed: false, parameterValues: { gain: 0.1 } },
        ];
        return track;
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
});
