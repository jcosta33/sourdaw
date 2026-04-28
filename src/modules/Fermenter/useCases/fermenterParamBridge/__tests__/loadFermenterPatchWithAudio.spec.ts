import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../stores/fermenterStore', () => ({
    loadFermenterPatch: vi.fn(),
}));

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
        vi.clearAllMocks();
        setFermenterDependencies({
            getAllTracks: () => [{ id: 't1', devices: [{ id: 'd1' }] }] as never,
            updateDeviceParam,
            persistDeviceParam,
            updateDevicePatch,
            persistDevicePatch,
        });
    });

    it('updates the UI store with the original patch but sends DSP ids to the audio engine', () => {
        loadFermenterPatchWithAudio('d1', DEFAULT_PATCH);

        expect(loadFermenterPatch).toHaveBeenCalledWith('d1', DEFAULT_PATCH);
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
});
