import { beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreDevice } from '../restoreDevice';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateTrack: vi.fn(),
    projectTrackToLiveStrip: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/updateTrack', () => ({ updateTrack: mocks.updateTrack }));
vi.mock('../../projectTrackToLiveStrip', () => ({ projectTrackToLiveStrip: mocks.projectTrackToLiveStrip }));

describe('restoreDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('restores the exact snapshot at its original chain index and projects the live strip', () => {
        const track = {
            id: 'track-1',
            kind: 'audio',
            parentId: null,
            devices: [
                { id: 'before', type: 'builtin-gain' },
                { id: 'after', type: 'builtin-delay' },
            ],
        };
        mocks.getTrackState.mockReturnValue({ tracks: [track] });
        const snapshot = {
            id: 'restored',
            name: 'EQ',
            type: 'builtin-eq',
            bypassed: true,
            parameterValues: { frequency: 2400 },
        };

        const outcome = restoreDevice({ trackId: track.id, deviceSnapshot: snapshot, deviceIndex: 1 });
        const updater = mocks.updateTrack.mock.calls[0]?.[1];
        const updated = updater(track);

        expect(outcome).toBe('written');
        expect(updated.devices).toEqual([track.devices[0], snapshot, track.devices[1]]);
        expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledWith({
            trackId: track.id,
            activateDormantExternalPlugins: true,
        });
    });

    it('rejects a stale inverse when the device identity already exists', () => {
        const snapshot = {
            id: 'restored',
            name: 'EQ',
            type: 'builtin-eq',
            bypassed: false,
            parameterValues: {},
        };
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'track-1', kind: 'audio', parentId: null, devices: [snapshot] }],
        });

        expect(restoreDevice({ trackId: 'track-1', deviceSnapshot: snapshot, deviceIndex: 0 })).toBe('conflict');
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });
});
