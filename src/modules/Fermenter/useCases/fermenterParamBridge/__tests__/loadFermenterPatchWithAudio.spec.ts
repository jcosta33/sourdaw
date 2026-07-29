import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../stores/fermenterStore', () => ({
    loadFermenterPatch: vi.fn(),
}));

import { clampDeviceParameterValue } from '#/modules/Arrangement/useCases';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { loadFermenterPatch } from '../../../stores/fermenterStore';
import { setFermenterDependencies } from '../../fermenterDependencies';
import { loadFermenterPatchWithAudio } from '../loadFermenterPatchWithAudio';

describe('loadFermenterPatchWithAudio', () => {
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

    it('updates the UI store immediately but sends DSP ids to the audio engine on the next frame', () => {
        loadFermenterPatchWithAudio('d1', DEFAULT_PATCH);

        // Store write is synchronous; engine/persist are deferred to the rAF flush.
        expect(loadFermenterPatch).toHaveBeenCalledWith('d1', DEFAULT_PATCH);
        expect(updateDevicePatch).not.toHaveBeenCalled();
        expect(persistDevicePatch).not.toHaveBeenCalled();

        vi.advanceTimersByTime(16);

        expect(updateDevicePatch).toHaveBeenCalledWith(
            't1',
            'd1',
            expect.objectContaining({
                engine: DEFAULT_PATCH.oscEngine,
                cutoff: DEFAULT_PATCH.filterCutoff,
                resonance: DEFAULT_PATCH.filterResonance,
                mod_env_to_filter: DEFAULT_PATCH.filterEnvAmount,
            })
        );
        expect(updateDevicePatch).not.toHaveBeenCalledWith('t1', 'd1', expect.objectContaining({ oscEngine: 0 }));
        expect(persistDevicePatch).toHaveBeenCalledWith('d1', DEFAULT_PATCH);
    });

    it('coalesces rapid successive loads to a single engine + persist flush carrying the latest patch', () => {
        const first = { ...DEFAULT_PATCH, filterCutoff: 1000 };
        const second = { ...DEFAULT_PATCH, filterCutoff: 5000 };
        const third = { ...DEFAULT_PATCH, filterCutoff: 9000 };

        loadFermenterPatchWithAudio('d1', first);
        loadFermenterPatchWithAudio('d1', second);
        loadFermenterPatchWithAudio('d1', third);

        // Three pointer-rate writes within one frame.
        expect(updateDevicePatch).not.toHaveBeenCalled();
        expect(persistDevicePatch).not.toHaveBeenCalled();

        vi.advanceTimersByTime(16);

        expect(updateDevicePatch).toHaveBeenCalledTimes(1);
        expect(persistDevicePatch).toHaveBeenCalledTimes(1);
        expect(updateDevicePatch).toHaveBeenCalledWith('t1', 'd1', expect.objectContaining({ cutoff: 9000 }));
        expect(persistDevicePatch).toHaveBeenCalledWith('d1', expect.objectContaining({ filterCutoff: 9000 }));
    });
});
