import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';

import { createPatchWriteHarness } from '../../../__tests__/patchWriteHarness';
import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { getFermenterState } from '../../../stores/fermenterStore';
import { loadFermenterPatchWithAudio } from '../loadFermenterPatchWithAudio';

const harness = createPatchWriteHarness();
describe('loadFermenterPatchWithAudio', () => {
    beforeEach(() => harness.setup());
    afterEach(() => {
        harness.teardown();
        vi.restoreAllMocks();
    });

    it('updates the panel immediately and commits complete project truth and DSP ids on the next frame', async () => {
        const patch = { ...DEFAULT_PATCH, filterCutoff: 777 };
        loadFermenterPatchWithAudio('d1', patch);
        expect(getFermenterState('d1').patch).toEqual(patch);
        expect(harness.patch()).toEqual(DEFAULT_PATCH);
        expect(harness.updateDevicePatch).not.toHaveBeenCalled();
        await harness.frame();
        expect(harness.patch()).toEqual(patch);
        expect(harness.updateDevicePatch).toHaveBeenCalledWith(
            't1',
            'd1',
            expect.objectContaining({
                engine: patch.oscEngine,
                cutoff: 777,
                resonance: patch.filterResonance,
                mod_env_to_filter: patch.filterEnvAmount,
            })
        );
        expect(harness.updateDevicePatch.mock.lastCall?.[2]).not.toHaveProperty('filterCutoff');
    });

    it('coalesces rapid successive loads into one committed engine flush carrying the latest patch', async () => {
        const publish = vi.spyOn(trackStore, 'set');
        for (const filterCutoff of [1000, 5000, 9000]) {
            loadFermenterPatchWithAudio('d1', { ...DEFAULT_PATCH, filterCutoff });
        }
        expect(harness.updateDevicePatch).not.toHaveBeenCalled();
        await harness.frame();
        expect(harness.updateDevicePatch).toHaveBeenCalledOnce();
        expect(publish).toHaveBeenCalledOnce();
        expect(harness.persistParam).not.toHaveBeenCalled();
        expect(harness.patch().filterCutoff).toBe(9000);
        expect(harness.updateDevicePatch.mock.lastCall?.[2]).toHaveProperty('cutoff', 9000);
    });
    it('reports a post-commit runtime failure while retaining the complete committed project patch', async () => {
        harness.updateDevicePatch.mockImplementation(() => {
            throw new Error('Engine unavailable');
        });
        const patch = { ...DEFAULT_PATCH, filterCutoff: 777 };
        loadFermenterPatchWithAudio('d1', patch);
        await harness.frame();
        expect(harness.patch()).toEqual(patch);
        expect(harness.notices).toContainEqual({
            level: 'warning',
            message: expect.stringContaining('Engine unavailable'),
        });
    });
});
