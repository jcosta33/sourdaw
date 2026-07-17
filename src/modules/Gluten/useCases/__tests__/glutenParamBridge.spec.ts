import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';

const { mockUpdateDeviceParam, mockPersistDeviceParam, mockTrackStoreValue } = vi.hoisted(() => ({
    mockUpdateDeviceParam: vi.fn(),
    mockPersistDeviceParam: vi.fn(),
    mockTrackStoreValue: { value: null as unknown },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: mockUpdateDeviceParam,
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return mockTrackStoreValue.value;
        },
    },
    persistDeviceParam: mockPersistDeviceParam,
}));

vi.mock('#/utils/DOM/createRafBatcher', () => ({
    createRafBatcher: () => ({
        schedule: (key: string, value: unknown, flush: (k: string, v: unknown) => void) => flush(key, value),
        cancel: (): void => {},
        cancelAll: (): void => {},
        pendingSize: 0,
    }),
}));

vi.mock('../../stores/glutenStore', () => ({
    setGlutenParam: vi.fn(),
    loadGlutenPatch: vi.fn(),
}));

import { DEFAULT_PATCH } from '../../models/GlutenPatch';
import { loadGlutenPatchWithAudio } from '../glutenParamBridge/loadGlutenPatchWithAudio';
import { setGlutenParamWithAudio } from '../glutenParamBridge/setGlutenParamWithAudio';

describe('glutenParamBridge', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('setGlutenParamWithAudio forwards numeric params to engine + persistence via rAF flush', () => {
        mockTrackStoreValue.value = { tracks: [{ id: 't1', devices: [{ id: 'd1' }] }] };

        setGlutenParamWithAudio('d1', 'threshold', -12);

        expect(mockUpdateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'threshold', -12);
        expect(mockPersistDeviceParam).toHaveBeenCalledWith('d1', 'threshold', -12);
    });

    it('setGlutenParamWithAudio noops when device cannot be found', () => {
        mockTrackStoreValue.value = { tracks: [] };

        setGlutenParamWithAudio('missing', 'threshold', -12);

        expect(mockUpdateDeviceParam).not.toHaveBeenCalled();
    });

    it('loadGlutenPatchWithAudio is callable without throwing on valid device', () => {
        mockTrackStoreValue.value = { tracks: [{ id: 't1', devices: [{ id: 'd1' }] }] };
        expect(() => loadGlutenPatchWithAudio('d1', DEFAULT_PATCH)).not.toThrow();
    });

    it('loadGlutenPatchWithAudio noops when device cannot be found', () => {
        mockTrackStoreValue.value = { tracks: [] };
        expect(() => loadGlutenPatchWithAudio('missing', DEFAULT_PATCH)).not.toThrow();
        expect(mockUpdateDeviceParam).not.toHaveBeenCalled();
    });
});
