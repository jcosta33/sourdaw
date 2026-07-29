import { describe, it, expect, vi, beforeEach } from 'vitest';

import { clampDeviceParamWrite } from '#/modules/Arrangement/stores';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { updateDeviceParam } from '../updateDeviceParam';

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        updateDeviceParam: vi.fn(),
    },
}));

// The law itself (descriptor lookup, min/max, pass-through when nothing is
// declared) is covered against real product descriptors in
// `Arrangement/stores/__tests__/clampDeviceParamWrite.spec.ts`. What is under
// test here is that this use case — the one door twenty call sites reach the
// DSP through — actually routes its value through that law instead of past it.
vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...mod,
        clampDeviceParamWrite: vi.fn(({ value }: { value: number }) => value),
    };
});

describe('updateDeviceParam', () => {
    beforeEach(() => {
        vi.mocked(audioEngine.updateDeviceParam).mockClear();
        vi.mocked(clampDeviceParamWrite).mockReset();
        vi.mocked(clampDeviceParamWrite).mockImplementation(({ value }) => value);
    });

    it('should forward to the audio engine', () => {
        updateDeviceParam('t1', 'd1', 'gain', 0.75);

        expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'gain', 0.75);
    });

    it('asks the declared-range law about the write it is making', () => {
        updateDeviceParam('t1', 'd1', 'mix', 4.2);

        expect(clampDeviceParamWrite).toHaveBeenCalledWith({ deviceId: 'd1', paramId: 'mix', value: 4.2 });
    });

    it('sends the DSP the value the law allowed, not the value the caller asked for', () => {
        vi.mocked(clampDeviceParamWrite).mockReturnValue(1);

        updateDeviceParam('t1', 'd1', 'mix', 4.2);

        // Clamping only the store twin (`persistDeviceParam`) would leave the
        // stored row inside the declared range and the audible value outside
        // it, so the two disagree about what the parameter is.
        expect(audioEngine.updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'mix', 1);
        expect(audioEngine.updateDeviceParam).not.toHaveBeenCalledWith('t1', 'd1', 'mix', 4.2);
    });
});
