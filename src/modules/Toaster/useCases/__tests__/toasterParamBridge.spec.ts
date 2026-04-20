import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindDeviceRef, mockGetTrackStrip, mockGetAllTracks } = vi.hoisted(() => ({
    mockFindDeviceRef: vi.fn(() => null as { trackId: string; deviceId: string } | null),
    mockGetTrackStrip: vi.fn(),
    mockGetAllTracks: vi.fn(() => [] as never),
}));

vi.mock('../toasterParamBridge/helpers', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../toasterParamBridge/helpers')>();
    return {
        ...actual,
        findDeviceRef: mockFindDeviceRef,
    };
});

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getTrackStrip: mockGetTrackStrip,
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    getAllTracks: mockGetAllTracks,
}));

import { getFirstToasterDeviceId } from '../toasterParamBridge/getFirstToasterDeviceId';
import { setPadEngineImmediate } from '../toasterParamBridge/setPadEngineImmediate';

describe('getFirstToasterDeviceId', () => {
    beforeEach(() => {
        mockGetAllTracks.mockReturnValue([] as never);
    });

    it('returns null when there are no tracks', () => {
        expect(getFirstToasterDeviceId()).toBeNull();
    });
});

describe('setPadEngineImmediate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFindDeviceRef.mockReturnValue(null);
    });

    it('does not touch the strip when the device is not on any track', () => {
        setPadEngineImmediate('unknown-device', 0, 0);
        expect(mockGetTrackStrip).not.toHaveBeenCalled();
    });
});
