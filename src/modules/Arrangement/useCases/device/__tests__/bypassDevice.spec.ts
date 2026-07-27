import { describe, it, expect, vi, beforeEach } from 'vitest';

import { bypassDevice } from '../bypassDevice';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    mapAllTracks: vi.fn(),
    updateDeviceBypass: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/mapAllTracks', () => ({
    mapAllTracks: mocks.mapAllTracks,
}));

// Mock dynamic import
vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceBypass: mocks.updateDeviceBypass,
}));

describe('bypassDevice', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates bypass state in store and engine before returning', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', devices: [{ id: 'd1' }] }],
        });

        const didWrite = bypassDevice('d1', true);

        expect(mocks.mapAllTracks).toHaveBeenCalled();
        const call = mocks.mapAllTracks.mock.calls[0];
        if (!call) {
            throw new Error('expected mapAllTracks to be called');
        }
        const updater = call[0];
        expect(updater({ devices: [{ id: 'd1', bypassed: false }] })).toEqual({
            devices: [{ id: 'd1', bypassed: true }],
        });

        expect(mocks.updateDeviceBypass).toHaveBeenCalledWith('t1', 'd1', true);
        expect(didWrite).toBe(true);
    });

    it('rejects dormant VCA bypass before project or engine mutation', async () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'vca-1', kind: 'vca', devices: [{ id: 'd1' }] }],
        });

        const didWrite = bypassDevice('d1', true);

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        await Promise.resolve();
        expect(mocks.updateDeviceBypass).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('skips engine lookup and still maps the store when track state is absent', async () => {
        // No project tracks -> the engine forwarding loop is skipped entirely,
        // but the device record is still updated in project truth.
        mocks.getTrackState.mockReturnValue(null);

        const didWrite = bypassDevice('d1', true);

        expect(mocks.mapAllTracks).toHaveBeenCalled();
        await Promise.resolve();
        expect(mocks.updateDeviceBypass).not.toHaveBeenCalled();
        expect(didWrite).toBe(true);
    });

    it('leaves sibling devices unchanged while toggling only the target', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', devices: [{ id: 'd1' }, { id: 'd2' }] }],
        });

        bypassDevice('d1', true);

        const updater = mocks.mapAllTracks.mock.calls[0]![0] as (track: {
            devices: { id: string; bypassed: boolean }[];
        }) => { devices: { id: string; bypassed: boolean }[] };
        const result = updater({
            devices: [
                { id: 'd1', bypassed: false },
                { id: 'd2', bypassed: false },
            ],
        });
        expect(result.devices).toEqual([
            { id: 'd1', bypassed: true },
            { id: 'd2', bypassed: false },
        ]);
    });
});
