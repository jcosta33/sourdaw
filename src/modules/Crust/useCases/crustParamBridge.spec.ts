import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { Container } from '#/infra/di/Container';
import { setCrustParamWithAudio } from './crustParamBridge/setCrustParamWithAudio';
import { loadCrustPatchWithAudio } from './crustParamBridge/loadCrustPatchWithAudio';
import { DEFAULT_CRUST_PATCH } from '../models/CrustPatch';

vi.mock('../stores/crustStore', () => ({
    setCrustParam: vi.fn(),
    loadCrustPatch: vi.fn(),
}));

describe('crustParamBridge', () => {
    beforeEach(() => {
        Container.clear();
        vi.useFakeTimers();
        // jsdom needs a rAF stub that fires synchronously for the test
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            cb(0);
            return 1;
        });
    });

    it('setCrustParamWithAudio forwards numeric params to engine + persistence via rAF flush', () => {
        const updateDeviceParam = vi.fn();
        const persistDeviceParam = vi.fn();
        const getAllTracks = vi.fn(() => [
            { id: 't1', devices: [{ id: 'd1' }] } as never,
        ]);
        injectDependencies(setCrustParamWithAudio, { updateDeviceParam, persistDeviceParam, getAllTracks });

        setCrustParamWithAudio('d1', 'gain', 0.5);

        expect(updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'gain', 0.5);
        expect(persistDeviceParam).toHaveBeenCalledWith('d1', 'gain', 0.5);
    });

    it('setCrustParamWithAudio noops when device cannot be found', () => {
        const updateDeviceParam = vi.fn();
        const persistDeviceParam = vi.fn();
        const getAllTracks = vi.fn(() => []);
        injectDependencies(setCrustParamWithAudio, { updateDeviceParam, persistDeviceParam, getAllTracks });

        setCrustParamWithAudio('missing', 'gain', 0.5);

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });

    it('loadCrustPatchWithAudio pushes every encodable patch field immediately', () => {
        const updateDeviceParam = vi.fn();
        const persistDeviceParam = vi.fn();
        const getAllTracks = vi.fn(() => [
            { id: 't1', devices: [{ id: 'd1' }] } as never,
        ]);
        injectDependencies(loadCrustPatchWithAudio, { updateDeviceParam, persistDeviceParam, getAllTracks });

        loadCrustPatchWithAudio('d1', DEFAULT_CRUST_PATCH);

        expect(updateDeviceParam.mock.calls.length).toBeGreaterThan(0);
        expect(persistDeviceParam.mock.calls.length).toBe(updateDeviceParam.mock.calls.length);
    });
});
