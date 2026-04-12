import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { setGlutenParamWithAudio } from '../glutenParamBridge/setGlutenParamWithAudio';
import { loadGlutenPatchWithAudio } from '../glutenParamBridge/loadGlutenPatchWithAudio';
import { DEFAULT_PATCH } from '../../models/GlutenPatch';

import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { persistDeviceParam, getAllTracks } from '#/modules/Arrangement/useCases';

vi.mock('../../stores/glutenStore', () => ({
    setGlutenParam: vi.fn(),
    loadGlutenPatch: vi.fn(),
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
describe('glutenParamBridge', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            cb(0);
            return 1;
        });
    });

    it('setGlutenParamWithAudio forwards numeric params to engine + persistence via rAF flush', () => {
        vi.mocked(getAllTracks).mockReturnValue([
            { id: 't1', devices: [{ id: 'd1' }] } as never,
        ]);

        setGlutenParamWithAudio('d1', 'threshold', -12);

        expect(updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'threshold', -12);
        expect(persistDeviceParam).toHaveBeenCalledWith('d1', 'threshold', -12);
    });

    it('setGlutenParamWithAudio noops when device cannot be found', () => {
        vi.mocked(getAllTracks).mockReturnValue([]);

        setGlutenParamWithAudio('missing', 'threshold', -12);

        expect(updateDeviceParam).not.toHaveBeenCalled();
    });

    it('loadGlutenPatchWithAudio pushes every encodable patch field immediately', () => {
        vi.mocked(getAllTracks).mockReturnValue([
            { id: 't1', devices: [{ id: 'd1' }] } as never,
        ]);

        loadGlutenPatchWithAudio('d1', DEFAULT_PATCH);

        expect(vi.mocked(updateDeviceParam).mock.calls.length).toBeGreaterThan(0);
        expect(vi.mocked(persistDeviceParam).mock.calls.length).toBe(vi.mocked(updateDeviceParam).mock.calls.length);
    });
});
