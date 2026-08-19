import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';

const {
    mockUpdateDeviceParam,
    mockPersistDeviceParam,
    mockSetGlutenParam,
    mockResolveDeviceTarget,
    mockTrackStoreValue,
    mockExecuteAppAction,
} = vi.hoisted(() => {
    const mockTrackStoreValue: { value: unknown } = { value: null };
    return {
        mockUpdateDeviceParam: vi.fn(),
        mockPersistDeviceParam: vi.fn(),
        mockSetGlutenParam: vi.fn(),
        mockResolveDeviceTarget: vi.fn(),
        mockTrackStoreValue,
        mockExecuteAppAction: vi.fn(() => Promise.resolve()),
    };
});

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mockExecuteAppAction,
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
    resolveEligibleDeviceWriteTarget: mockResolveDeviceTarget,
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
    setGlutenParam: mockSetGlutenParam,
    loadGlutenPatch: vi.fn(),
}));

import { DEFAULT_PATCH } from '../../models/GlutenPatch';
import { loadGlutenPatchWithAudio } from '../glutenParamBridge/loadGlutenPatchWithAudio';
import { setGlutenParamWithAudio } from '../glutenParamBridge/setGlutenParamWithAudio';

describe('glutenParamBridge', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
        mockResolveDeviceTarget.mockImplementation((deviceId: string) => {
            if (deviceId === 'd1') {
                return { status: 'eligible', trackId: 't1', deviceId };
            }
            return { status: 'missing' };
        });
    });

    it('commits a settled numeric param through the undoable action, not a bare store write', () => {
        mockTrackStoreValue.value = { tracks: [{ id: 't1', devices: [{ id: 'd1' }] }] };

        setGlutenParamWithAudio('d1', 'threshold', -12);

        expect(mockExecuteAppAction).toHaveBeenCalledWith({
            type: 'setDeviceParameter',
            payload: { deviceId: 'd1', paramId: 'threshold', value: -12 },
        });
        // `setDeviceParameter` owns the engine write and the project-truth write
        // on the commit path; going round it would be the write with no history.
        expect(mockPersistDeviceParam).not.toHaveBeenCalled();
    });

    it('previews a transient param on the engine and keeps it out of project truth and history', () => {
        mockTrackStoreValue.value = { tracks: [{ id: 't1', devices: [{ id: 'd1' }] }] };

        setGlutenParamWithAudio('d1', 'threshold', -12, true);

        expect(mockUpdateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'threshold', -12);
        expect(mockPersistDeviceParam).not.toHaveBeenCalled();
        expect(mockExecuteAppAction).not.toHaveBeenCalled();
    });

    it('emits the GlutenPanel knee control on the live engine preview path', () => {
        mockTrackStoreValue.value = { tracks: [{ id: 't1', devices: [{ id: 'd1' }] }] };

        setGlutenParamWithAudio('d1', 'knee', 6, true);

        expect(mockUpdateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'knee', 6);
    });

    it('setGlutenParamWithAudio noops when device cannot be found', () => {
        mockTrackStoreValue.value = { tracks: [] };

        setGlutenParamWithAudio('missing', 'threshold', -12);

        expect(mockUpdateDeviceParam).not.toHaveBeenCalled();
        expect(mockSetGlutenParam).not.toHaveBeenCalled();
    });

    it('setGlutenParamWithAudio rejects an ineligible owner before store or engine effects', () => {
        mockResolveDeviceTarget.mockReturnValue({ status: 'ineligible' });

        setGlutenParamWithAudio('d1', 'threshold', -12);

        expect(mockSetGlutenParam).not.toHaveBeenCalled();
        expect(mockUpdateDeviceParam).not.toHaveBeenCalled();
        expect(mockPersistDeviceParam).not.toHaveBeenCalled();
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
