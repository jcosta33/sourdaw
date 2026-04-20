import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUpdateDeviceParam, mockPersistDeviceParam, mockGetAllTracks } = vi.hoisted(() => ({
    mockUpdateDeviceParam: vi.fn(),
    mockPersistDeviceParam: vi.fn(),
    mockGetAllTracks: vi.fn(() => [] as Array<{ id: string; devices: Array<{ id: string }> }>),
}));

vi.mock('../crustParamBridge/helpers', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../crustParamBridge/helpers')>();
    const handlers = actual.createFlushHandlers({
        updateDeviceParam: mockUpdateDeviceParam,
        persistDeviceParam: mockPersistDeviceParam,
    });
    return {
        ...actual,
        flushCrustParam: handlers.flushParam,
        pushCrustParamImmediately: handlers.pushParamImmediately,
        findDeviceRefCrust: actual.createFindDeviceRef(mockGetAllTracks as never),
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

import { setCrustParamWithAudio } from '../crustParamBridge/setCrustParamWithAudio';
import { loadCrustPatchWithAudio } from '../crustParamBridge/loadCrustPatchWithAudio';
import { DEFAULT_CRUST_PATCH } from '../../models/CrustPatch';

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
