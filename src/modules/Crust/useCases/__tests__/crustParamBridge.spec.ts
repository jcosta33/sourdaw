import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';

// §33.2 / §57.1 moved bridge deps into a module-load-time capture
// (`crustBridgeDeps = { updateDeviceParam, persistDeviceParam }`) and
// batched flushes through an rAF-scheduler primitive. Neither plays
// well with an async `importOriginal` factory, so mock the helpers
// module directly with hoisted refs and replace `paramBatcher.schedule`
// with a synchronous flush so tests don't have to wrestle with rAF
// timing in jsdom.
const { mockUpdateDeviceParam, mockPersistDeviceParam, mockGetAllTracks } = vi.hoisted(() => ({
    mockUpdateDeviceParam: vi.fn(),
    mockPersistDeviceParam: vi.fn(),
    mockGetAllTracks: vi.fn(),
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
        findDeviceRefCrust: actual.createFindDeviceRef(mockGetAllTracks),
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
        Container.clear();
        vi.clearAllMocks();
    });

    it('setCrustParamWithAudio forwards numeric params to engine + persistence via rAF flush', () => {
        mockGetAllTracks.mockReturnValue([{ id: 't1', devices: [{ id: 'd1' }] } as never]);

        setCrustParamWithAudio('d1', 'gain', 0.5);

        expect(mockUpdateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'gain', 0.5);
        expect(mockPersistDeviceParam).toHaveBeenCalledWith('d1', 'gain', 0.5);
    });

    it('setCrustParamWithAudio noops when device cannot be found', () => {
        mockGetAllTracks.mockReturnValue([]);

        setCrustParamWithAudio('missing', 'gain', 0.5);

        expect(mockUpdateDeviceParam).not.toHaveBeenCalled();
        expect(mockPersistDeviceParam).not.toHaveBeenCalled();
    });

    it('loadCrustPatchWithAudio pushes every encodable patch field immediately', () => {
        mockGetAllTracks.mockReturnValue([{ id: 't1', devices: [{ id: 'd1' }] } as never]);

        loadCrustPatchWithAudio('d1', DEFAULT_CRUST_PATCH);

        expect(mockUpdateDeviceParam.mock.calls.length).toBeGreaterThan(0);
        expect(mockPersistDeviceParam.mock.calls.length).toBe(mockUpdateDeviceParam.mock.calls.length);
    });
});
