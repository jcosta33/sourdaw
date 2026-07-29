import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../stores/fermenterStore', () => ({
    setFermenterParam: vi.fn(),
}));

import { clampDeviceParameterValue } from '#/modules/Arrangement/useCases';

import { setFermenterParam } from '../../../stores/fermenterStore';
import { setFermenterDependencies } from '../../fermenterDependencies';
import { setFermenterParamWithAudio } from '../setFermenterParamWithAudio';

describe('setFermenterParamWithAudio', () => {
    const updateDeviceParam = vi.fn();
    const persistDeviceParam = vi.fn();
    const updateDevicePatch = vi.fn();
    const persistDevicePatch = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn((callback: FrameRequestCallback) => {
                return window.setTimeout(() => callback(0), 16);
            })
        );
        vi.stubGlobal(
            'cancelAnimationFrame',
            vi.fn((id: number) => {
                window.clearTimeout(id);
            })
        );
        setFermenterDependencies({
            clampDeviceParameterValue,
            getAllTracks: () => [{ id: 't1', devices: [{ id: 'd1' }] }] as never,
            resolveEligibleDeviceWriteTarget: () => ({ status: 'eligible', trackId: 't1', deviceId: 'd1' }),
            updateDeviceParam,
            persistDeviceParam,
            updateDevicePatch,
            persistDevicePatch,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('updates the UI store with the TS key and sends the DSP key to the audio engine', () => {
        setFermenterParamWithAudio('d1', 'filterCutoff', 777);
        vi.advanceTimersByTime(16);

        expect(setFermenterParam).toHaveBeenCalledWith('d1', 'filterCutoff', 777);
        expect(updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'cutoff', 777);
        expect(persistDeviceParam).toHaveBeenCalledWith('d1', 'filterCutoff', 777);
    });

    it('resolves the declared range once on the store key and sends that same value under the DSP key', () => {
        // `updateDeviceParam` clamps by looking the paramId up on the
        // descriptor, and FERMENTER_DESCRIPTOR declares camelCase ids. It is
        // handed `cutoff`, which matches nothing, so the engine write escaped
        // the range while the store write (camelCase) was held to it — the
        // divergence inverted. The value is resolved here, on the key the
        // descriptor actually declares, and the same number goes to both.
        setFermenterParamWithAudio('d1', 'filterCutoff', 99999);
        vi.advanceTimersByTime(16);

        expect(setFermenterParam).toHaveBeenCalledWith('d1', 'filterCutoff', 20000);
        expect(updateDeviceParam).toHaveBeenCalledWith('t1', 'd1', 'cutoff', 20000);
        expect(persistDeviceParam).toHaveBeenCalledWith('d1', 'filterCutoff', 20000);
    });
});
