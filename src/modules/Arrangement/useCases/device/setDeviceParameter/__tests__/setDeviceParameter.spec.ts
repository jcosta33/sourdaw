import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTrack } from '../../../../models/Track';
import { setDeviceParameter } from '../setDeviceParameter';

import type { Track } from '#/modules/Arrangement/models/Track';
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
    });

    it('updates parameter in store and engine', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', parameterValues: { gain: 0.1 } }] }],
        } as unknown as TrackState);

        setDeviceParameter('d1', 'gain', 0.5);

        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'gain', 0.5);
        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));

        const updater = mocks.updateTrack.mock.calls[0]![1];
        const result = updater({ devices: [{ id: 'd1', parameterValues: { gain: 0.1 } }] } as unknown as Track);
        expect(result.devices[0]!.parameterValues.gain).toBe(0.5);
    });

    it('records automation if playing and recording mode', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', automationMode: 'write', devices: [{ id: 'd1' }] }],
        } as unknown as TrackState);
        mocks.transportStoreValue = { isPlaying: true, playheadPosition: 8 };

        setDeviceParameter('d1', 'cutoff', 1000);

        expect(mocks.recordAutomationValue).toHaveBeenCalledWith('t1', 'd1:cutoff', 1000, 8);
    });

    it('bails if value is not finite', () => {
        setDeviceParameter('d1', 'gain', NaN);
        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
    });

    it('rejects dormant VCA parameter updates before engine, project, or automation work', () => {
        const track = createTrack({ id: 'vca-1', name: 'VCA', kind: 'audio' });
        Object.defineProperty(track, 'kind', { value: 'vca' });
        track.devices = [{ id: 'd1', name: 'Device', type: 'device', bypassed: false, parameterValues: {} }];
        track.automationMode = 'write';
        mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: null });
        mocks.transportStoreValue = { isPlaying: true, playheadPosition: 8 };

        setDeviceParameter('d1', 'gain', 0.5);

        expect(mocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.recordAutomationValue).not.toHaveBeenCalled();
    });
});
