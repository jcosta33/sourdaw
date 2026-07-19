import { describe, it, expect, vi } from 'vitest';

import { createFindDeviceRef, type GetAllTracksFn } from '../createFindDeviceRef';

describe('createFindDeviceRef', () => {
    it('should return null when no track contains the device', () => {
        const getAllTracks = vi.fn((): ReturnType<GetAllTracksFn> => []);
        const findDeviceRef = createFindDeviceRef(getAllTracks);
        expect(findDeviceRef('missing')).toBeNull();
    });

    it('should return track and device ids when a track owns the device', () => {
        const getAllTracks = vi.fn((): ReturnType<GetAllTracksFn> => [
            {
                id: 'track-1',
                devices: [{ id: 'device-x' }],
            },
        ]);
        const findDeviceRef = createFindDeviceRef(getAllTracks);
        expect(findDeviceRef('device-x')).toEqual({ trackId: 'track-1', deviceId: 'device-x' });
    });

    it('should scan tracks in order and return the first match', () => {
        const getAllTracks = vi.fn((): ReturnType<GetAllTracksFn> => [
            {
                id: 'a',
                devices: [{ id: 'shared' }],
            },
            {
                id: 'b',
                devices: [{ id: 'shared' }],
            },
        ]);
        const findDeviceRef = createFindDeviceRef(getAllTracks);
        expect(findDeviceRef('shared')).toEqual({ trackId: 'a', deviceId: 'shared' });
    });
});
