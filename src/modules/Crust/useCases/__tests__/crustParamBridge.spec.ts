import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { setCrustParamWithAudio } from '../crustParamBridge/setCrustParamWithAudio';
import { loadCrustPatchWithAudio } from '../crustParamBridge/loadCrustPatchWithAudio';
import { DEFAULT_CRUST_PATCH } from '../../models/CrustPatch';

import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { persistDeviceParam, getAllTracks } from '#/modules/Arrangement/useCases';

vi.mock('../../stores/crustStore', () => ({
    setCrustParam: vi.fn(),
    loadCrustPatch: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: vi.fn(),
}));
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    persistDeviceParam: vi.fn(),
    getAllTracks: vi.fn(),
}));

describe('crustParamBridge', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
        vi.useFakeTimers();
        // jsdom needs a rAF stub that fires synchronously for the test
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            cb(0);
            return 1;
        });
    });

    it('setCrustParamWithAudio forwards numeric params to engine + persistence via rAF flush', () => {
        vi.mocked(getAllTracks).mockReturnValue([
            { id: 't1', devices: [{ id: 'd1' }] } as never,
        ]);

        setCrustParamWithAudio('d1', 'gain', 0.5);

        expect(updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'gain', 0.5);
        expect(persistDeviceParam).toHaveBeenCalledWith('d1', 'gain', 0.5);
    });

    it('setCrustParamWithAudio noops when device cannot be found', () => {
        vi.mocked(getAllTracks).mockReturnValue([]);

        setCrustParamWithAudio('missing', 'gain', 0.5);

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });

    it('loadCrustPatchWithAudio pushes every encodable patch field immediately', () => {
        vi.mocked(getAllTracks).mockReturnValue([
            { id: 't1', devices: [{ id: 'd1' }] } as never,
        ]);

        loadCrustPatchWithAudio('d1', DEFAULT_CRUST_PATCH);

        expect(vi.mocked(updateDeviceParam).mock.calls.length).toBeGreaterThan(0);
        expect(vi.mocked(persistDeviceParam).mock.calls.length).toBe(vi.mocked(updateDeviceParam).mock.calls.length);
    });
});
