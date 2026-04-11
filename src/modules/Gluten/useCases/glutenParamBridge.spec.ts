import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { Container } from '#/infra/di/Container';
import { setGlutenParamWithAudio, loadGlutenPatchWithAudio } from './glutenParamBridge';
import { DEFAULT_PATCH } from '../models/GlutenPatch';

vi.mock('../stores/glutenStore', () => ({
    setGlutenParam: vi.fn(),
    loadGlutenPatch: vi.fn(),
}));

describe('glutenParamBridge', () => {
    beforeEach(() => {
        Container.clear();
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            cb(0);
            return 1;
        });
    });

    it('setGlutenParamWithAudio forwards numeric params to engine + persistence via rAF flush', () => {
        const updateDeviceParam = vi.fn();
        const persistDeviceParam = vi.fn();
        const getAllTracks = vi.fn(() => [
            { id: 't1', devices: [{ id: 'd1' }] } as never,
        ]);
        injectDependencies(setGlutenParamWithAudio, { updateDeviceParam, persistDeviceParam, getAllTracks });

        setGlutenParamWithAudio('d1', 'threshold', -12);

        expect(updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'threshold', -12);
        expect(persistDeviceParam).toHaveBeenCalledWith('d1', 'threshold', -12);
    });

    it('setGlutenParamWithAudio noops when device cannot be found', () => {
        const updateDeviceParam = vi.fn();
        const persistDeviceParam = vi.fn();
        const getAllTracks = vi.fn(() => []);
        injectDependencies(setGlutenParamWithAudio, { updateDeviceParam, persistDeviceParam, getAllTracks });

        setGlutenParamWithAudio('missing', 'threshold', -12);

        expect(updateDeviceParam).not.toHaveBeenCalled();
    });

    it('loadGlutenPatchWithAudio pushes every encodable patch field immediately', () => {
        const updateDeviceParam = vi.fn();
        const persistDeviceParam = vi.fn();
        const getAllTracks = vi.fn(() => [
            { id: 't1', devices: [{ id: 'd1' }] } as never,
        ]);
        injectDependencies(loadGlutenPatchWithAudio, { updateDeviceParam, persistDeviceParam, getAllTracks });

        loadGlutenPatchWithAudio('d1', DEFAULT_PATCH);

        expect(updateDeviceParam.mock.calls.length).toBeGreaterThan(0);
        expect(persistDeviceParam.mock.calls.length).toBe(updateDeviceParam.mock.calls.length);
    });
});
