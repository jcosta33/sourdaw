import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPatchWriteHarness } from '../../../__tests__/patchWriteHarness';
import { getFermenterState } from '../../../stores/fermenterStore';
import { cancelPendingFermenterParam } from '../cancelPendingFermenterParam';
import { setFermenterParamWithAudio } from '../setFermenterParamWithAudio';

const harness = createPatchWriteHarness();
describe('setFermenterParamWithAudio', () => {
    beforeEach(() => harness.setup());
    afterEach(() => harness.teardown());

    it('updates the panel with the TS key and commits its DSP translation through the patch action', async () => {
        setFermenterParamWithAudio('d1', 'filterCutoff', 777);
        expect(getFermenterState('d1').patch.filterCutoff).toBe(777);
        await harness.frame();
        expect(harness.patch().filterCutoff).toBe(777);
        expect(harness.updateDevicePatch.mock.lastCall?.[2]).toHaveProperty('cutoff', 777);
    });

    it('cancels only the selected device parameter while other pending values and devices still commit', async () => {
        setFermenterParamWithAudio('d1', 'filterModel', 4);
        setFermenterParamWithAudio('d1', 'filterMode', 2);
        setFermenterParamWithAudio('d2', 'filterModel', 3);
        cancelPendingFermenterParam('d1', 'filterModel');
        await harness.frame();
        expect(harness.patch('d1').filterModel).toBe(0);
        expect(harness.patch('d1').filterMode).toBe(2);
        expect(harness.patch('d2').filterModel).toBe(3);
        expect(
            harness.updateDevicePatch.mock.calls.map((call) => [call[1], call[2].filter_model, call[2].filter_mode])
        ).toEqual([
            ['d1', 0, 2],
            ['d2', 3, 0],
        ]);
    });

    it('resolves the descriptor range before mapping so panel, raw project and DSP receive the same number', async () => {
        setFermenterParamWithAudio('d1', 'filterCutoff', 99999);
        expect(getFermenterState('d1').patch.filterCutoff).toBe(20000);
        await harness.frame();
        expect(harness.patch().filterCutoff).toBe(20000);
        expect(harness.updateDevicePatch.mock.lastCall?.[2]).toHaveProperty('cutoff', 20000);
    });
});
