import { describe, it, expect, vi, beforeEach } from 'vitest';

type TestTrack = { id: string; devices: Array<{ id: string }> };

const { mockUpdateDeviceParam, mockPersistDeviceParam, mockGetAllTracks } = vi.hoisted(() => ({
    mockUpdateDeviceParam: vi.fn(),
    mockPersistDeviceParam: vi.fn(),
    mockGetAllTracks: vi.fn<() => TestTrack[]>(() => []),
}));

vi.mock('../crustParamBridge/helpers', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../crustParamBridge/helpers')>();
    return {
        ...actual,
        crustBridgeDeps: {
            updateDeviceParam: mockUpdateDeviceParam,
            persistDeviceParam: mockPersistDeviceParam,
        },
        findDeviceRefCrust: (deviceId: string) => {
            for (const track of mockGetAllTracks()) {
                if (track.devices.some((device) => device.id === deviceId)) {
                    return { trackId: track.id, deviceId };
                }
            }
            return null;
        },
        paramBatcher: {
            schedule: (key: string, value: unknown, flush: (k: string, v: unknown) => void) => {
                flush(key, value);
            },
            cancel: (): void => {},
            cancelAll: (): void => {},
            pendingSize: 0,
        },
    };
});

vi.mock('../../stores/crustStore', () => ({
    setCrustParam: vi.fn(),
    loadCrustPatch: vi.fn(),
}));

import { DEFAULT_CRUST_PATCH, type CrustPatch } from '../../models/CrustPatch';
import { setCrustParam } from '../../stores/crustStore';
import { loadCrustPatchWithAudio } from '../crustParamBridge/loadCrustPatchWithAudio';
import { setCrustParamWithAudio } from '../crustParamBridge/setCrustParamWithAudio';

describe('crustParamBridge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetAllTracks.mockReturnValue([]);
    });

    it('setCrustParamWithAudio noops when device cannot be found', () => {
        mockGetAllTracks.mockReturnValue([]);

        setCrustParamWithAudio('missing', 'gain', 0.5);

        expect(mockUpdateDeviceParam).not.toHaveBeenCalled();
        expect(mockPersistDeviceParam).not.toHaveBeenCalled();
    });

    it('does not write the store for an unencodable enum value, keeping store and engine in sync', () => {
        mockGetAllTracks.mockReturnValue([{ id: 't1', devices: [{ id: 'd1' }] }]);

        // A corrupt patch could carry an enum string outside the known set. The
        // bridge must skip both the store write and the engine write so the two
        // never diverge — not write the bad value to the store and skip only the
        // engine push.
        const corruptAlgorithm = 'bogus' as CrustPatch['algorithm'];
        setCrustParamWithAudio('d1', 'algorithm', corruptAlgorithm);

        expect(setCrustParam).not.toHaveBeenCalled();
        expect(mockUpdateDeviceParam).not.toHaveBeenCalled();
    });

    it('writes the store for a valid enum value', () => {
        mockGetAllTracks.mockReturnValue([{ id: 't1', devices: [{ id: 'd1' }] }]);

        setCrustParamWithAudio('d1', 'algorithm', 'aggressive');

        expect(setCrustParam).toHaveBeenCalledWith('algorithm', 'aggressive');
        expect(mockUpdateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'algorithm', 4);
        expect(mockPersistDeviceParam).toHaveBeenCalledWith('d1', 'algorithm', 4);
    });

    it('writes the store for a store-only key (streamingPreset) that has no engine encoding', () => {
        mockGetAllTracks.mockReturnValue([{ id: 't1', devices: [{ id: 'd1' }] }]);

        // streamingPreset is a valid patch field with no engine index table.
        // Selecting a loudness target (e.g. 'ebu_r128') must still reach
        // patch.streamingPreset in the store — only the engine push is skipped.
        // The previous null-vs-undefined collapse dropped this store write,
        // breaking the Target tile/chip/menu, getLufsTarget() and the waveform
        // target line.
        setCrustParamWithAudio('d1', 'streamingPreset', 'ebu_r128');

        expect(setCrustParam).toHaveBeenCalledWith('streamingPreset', 'ebu_r128');
        // No engine index table for streamingPreset → no engine write.
        expect(mockUpdateDeviceParam).not.toHaveBeenCalled();
    });

    it('loadCrustPatchWithAudio noops when device cannot be found', () => {
        mockGetAllTracks.mockReturnValue([]);

        // Shouldn't throw
        expect(() => loadCrustPatchWithAudio('missing', DEFAULT_CRUST_PATCH)).not.toThrow();
        expect(mockUpdateDeviceParam).not.toHaveBeenCalled();
    });

    it('loadCrustPatchWithAudio is callable without throwing on valid device', () => {
        mockGetAllTracks.mockReturnValue([{ id: 't1', devices: [{ id: 'd1' }] }]);

        expect(() => loadCrustPatchWithAudio('d1', DEFAULT_CRUST_PATCH)).not.toThrow();
    });
});
