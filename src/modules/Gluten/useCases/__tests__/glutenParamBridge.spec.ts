import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';

const { mockUpdateDeviceParam, mockPersistDeviceParam, mockGetAllTracks } = vi.hoisted(() => ({
    mockUpdateDeviceParam: vi.fn(),
    mockPersistDeviceParam: vi.fn(),
    mockGetAllTracks: vi.fn(),
}));

vi.mock('../glutenParamBridge/helpers', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../glutenParamBridge/helpers')>();
    const handlers = actual.createFlushHandlers({
        updateDeviceParam: mockUpdateDeviceParam,
        persistDeviceParam: mockPersistDeviceParam,
    });
    return {
        ...actual,
        flushParam: handlers.flushParam,
        pushParamImmediately: handlers.pushParamImmediately,
        findDeviceRefGluten: actual.createFindDeviceRef(mockGetAllTracks),
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

vi.mock('../../stores/glutenStore', () => ({
    setGlutenParam: vi.fn(),
    loadGlutenPatch: vi.fn(),
}));

import { setGlutenParamWithAudio } from '../glutenParamBridge/setGlutenParamWithAudio';
import { loadGlutenPatchWithAudio } from '../glutenParamBridge/loadGlutenPatchWithAudio';
import { DEFAULT_PATCH } from '../../models/GlutenPatch';

describe('glutenParamBridge', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('setGlutenParamWithAudio forwards numeric params to engine + persistence via rAF flush', () => {
        mockGetAllTracks.mockReturnValue([{ id: 't1', devices: [{ id: 'd1' }] } as never]);

        setGlutenParamWithAudio('d1', 'threshold', -12);

        expect(mockUpdateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'threshold', -12);
        expect(mockPersistDeviceParam).toHaveBeenCalledWith('d1', 'threshold', -12);
    });

    it('setGlutenParamWithAudio noops when device cannot be found', () => {
        mockGetAllTracks.mockReturnValue([]);

        setGlutenParamWithAudio('missing', 'threshold', -12);

        expect(mockUpdateDeviceParam).not.toHaveBeenCalled();
    });

    it('loadGlutenPatchWithAudio pushes every encodable patch field immediately', () => {
        mockGetAllTracks.mockReturnValue([{ id: 't1', devices: [{ id: 'd1' }] } as never]);

        loadGlutenPatchWithAudio('d1', DEFAULT_PATCH);

        expect(mockUpdateDeviceParam.mock.calls.length).toBeGreaterThan(0);
        expect(mockPersistDeviceParam.mock.calls.length).toBe(mockUpdateDeviceParam.mock.calls.length);
    });
});
