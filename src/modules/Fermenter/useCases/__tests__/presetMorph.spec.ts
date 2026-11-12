import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';

import { createPatchWriteHarness } from '../../__tests__/patchWriteHarness';
import { DEFAULT_PATCH, type FermenterPatch } from '../../models/FermenterPatch';
import { getFermenterState } from '../../stores/fermenterStore';
import { setFermenterDependencies } from '../fermenterDependencies';
import { applyMorphedPatch } from '../presetMorph/applyMorphedPatch';
import { bilinearPatch } from '../presetMorph/bilinearPatch';
import { lerpPatch } from '../presetMorph/lerpPatch';

function patch(name: string, overrides: Partial<FermenterPatch> = {}): FermenterPatch {
    return { ...DEFAULT_PATCH, name, ...overrides };
}
const harness = createPatchWriteHarness();
describe('presetMorph', () => {
    it('lerpPatch interpolates numeric fields linearly', () => {
        const a = patch('A', { masterGain: 0, compThreshold: -20 });
        const b = patch('B', { masterGain: 10, compThreshold: 0 });

        const mid = lerpPatch(a, b, 0.5);
        expect(mid.masterGain).toBe(5);
        expect(mid.compThreshold).toBe(-10);
    });

    it('lerpPatch picks discrete selectors from the nearest patch', () => {
        const a = patch('A', { oscEngine: 0, filterModel: 0, warpMode: 0, activeLayer: 0, numLayers: 1 });
        const b = patch('B', { oscEngine: 6, filterModel: 5, warpMode: 6, activeLayer: 3, numLayers: 4 });

        const nearA = lerpPatch(a, b, 0.49);
        const nearB = lerpPatch(a, b, 0.5);

        expect(nearA.oscEngine).toBe(0);
        expect(nearA.filterModel).toBe(0);
        expect(nearA.warpMode).toBe(0);
        expect(nearA.activeLayer).toBe(0);
        expect(nearA.numLayers).toBe(1);
        expect(nearB.oscEngine).toBe(6);
        expect(nearB.filterModel).toBe(5);
        expect(nearB.warpMode).toBe(6);
        expect(nearB.activeLayer).toBe(3);
        expect(nearB.numLayers).toBe(4);
    });

    it('lerpPatch picks name based on which half t lands in', () => {
        const a = patch('A', { masterGain: 0 });
        const b = patch('B', { masterGain: 10 });
        expect(lerpPatch(a, b, 0.2).name).toBe('A');
        expect(lerpPatch(a, b, 0.8).name).toBe('B');
    });

    it('lerpPatch clamps t to [0, 1]', () => {
        const a = patch('A', { masterGain: 0 });
        const b = patch('B', { masterGain: 10 });
        expect(lerpPatch(a, b, -1).masterGain).toBe(0);
        expect(lerpPatch(a, b, 2).masterGain).toBe(10);
    });

    it('bilinearPatch interpolates between four corners', () => {
        const tl = patch('TL', { masterGain: 0 });
        const tr = patch('TR', { masterGain: 10 });
        const bl = patch('BL', { masterGain: 20 });
        const br = patch('BR', { masterGain: 30 });
        expect(bilinearPatch(tl, tr, bl, br, 0.5, 0.5).masterGain).toBe(15);
    });

    it('bilinearPatch keeps discrete selectors on one corner value', () => {
        const tl = patch('TL', { oscEngine: 0, filterModel: 0 });
        const tr = patch('TR', { oscEngine: 1, filterModel: 1 });
        const bl = patch('BL', { oscEngine: 2, filterModel: 2 });
        const br = patch('BR', { oscEngine: 6, filterModel: 5 });
        const morphed = bilinearPatch(tl, tr, bl, br, 0.75, 0.75);

        expect(morphed.oscEngine).toBe(6);
        expect(morphed.filterModel).toBe(5);
        expect(Number.isInteger(morphed.oscEngine)).toBe(true);
        expect(Number.isInteger(morphed.filterModel)).toBe(true);
    });
});

describe('morph frame writes through Command', () => {
    beforeEach(() => harness.setup());
    afterEach(() => harness.teardown());

    it('updates the panel immediately and forwards every renamed DSP parameter after the project commit', async () => {
        const value = patch('Mapped', {
            oscEngine: 1,
            filterCutoff: 1234,
            filterResonance: 0.7,
            filterEnvAmount: 0.5,
            lfoPitchAmount: 0.3,
            oscDrift: 0.2,
            portamentoTime: 0.4,
        });
        applyMorphedPatch('d1', value);
        expect(getFermenterState('d1').patch).toEqual(value);
        expect(harness.updateDevicePatch).not.toHaveBeenCalled();
        expect(harness.persistPatch).not.toHaveBeenCalled();
        await harness.frame();
        expect(harness.patch()).toEqual(value);
        const sent = harness.updateDevicePatch.mock.lastCall?.[2];
        expect(sent).toMatchObject({
            engine: 1,
            cutoff: 1234,
            resonance: 0.7,
            mod_env_to_filter: 0.5,
            mod_lfo_to_pitch: 0.3,
            drift: 0.2,
            portamento: 0.4,
        });
        for (const key of [
            'oscEngine',
            'filterCutoff',
            'filterResonance',
            'filterEnvAmount',
            'lfoPitchAmount',
            'oscDrift',
            'portamentoTime',
            'osc_engine',
            'filter_cutoff',
            'filter_resonance',
            'filter_env_amount',
            'lfo_pitch_amount',
            'osc_drift',
            'portamento_time',
        ]) {
            expect(sent).not.toHaveProperty(key);
        }
    });

    it('coalesces a drag to one full project and engine write with the latest patch', async () => {
        for (const filterCutoff of [1000, 2000, 3000]) {
            applyMorphedPatch('d1', patch('Morph', { filterCutoff }));
        }
        await harness.frame();
        expect(harness.updateDevicePatch).toHaveBeenCalledOnce();
        expect(harness.persistParam).toHaveBeenCalledOnce();
        expect(harness.patch().filterCutoff).toBe(3000);
    });

    it.each(['missing', 'ineligible'] as const)('does not alter a %s target', async (kind) => {
        const state = trackStore.value!;
        if (kind === 'missing') {
            trackStore.set({ ...state, tracks: [] });
        } else {
            setFermenterDependencies({
                ...harness.deps(),
                resolveEligibleDeviceWriteTarget: () => ({ status: 'ineligible' }),
            });
        }
        applyMorphedPatch('d1', patch('Refused'));
        await harness.frame();
        expect(harness.updateDevicePatch).not.toHaveBeenCalled();
        expect(harness.persistPatch).not.toHaveBeenCalled();
        expect(getFermenterState('d1').patch).toEqual(DEFAULT_PATCH);
    });

    it('still commits project truth when the optional runtime executor is absent', async () => {
        setFermenterDependencies({ ...harness.deps(), updateDevicePatch: undefined });
        applyMorphedPatch('d1', patch('No runtime', { filterCutoff: 700 }));
        await harness.frame();
        expect(harness.patch().filterCutoff).toBe(700);
        expect(harness.updateDevicePatch).not.toHaveBeenCalled();
    });

    it('still writes full deviceState when the optional scalar persistence mirror is absent', async () => {
        setFermenterDependencies({ ...harness.deps(), persistDevicePatch: undefined });
        applyMorphedPatch('d1', patch('Full state', { filterCutoff: 900 }));
        await harness.frame();
        expect(harness.patch().filterCutoff).toBe(900);
        expect(harness.updateDevicePatch.mock.lastCall?.[2]).toHaveProperty('cutoff', 900);
        expect(harness.persistPatch).not.toHaveBeenCalled();
    });

    it('does not write or touch the engine after the deferred target becomes frozen', async () => {
        applyMorphedPatch('d1', patch('Stale', { filterCutoff: 700 }));
        const state = trackStore.value!;
        trackStore.set({ ...state, tracks: state.tracks.map((track) => ({ ...track, frozen: true })) });
        await harness.frame();
        expect(harness.patch()).toEqual(DEFAULT_PATCH);
        expect(harness.updateDevicePatch).not.toHaveBeenCalled();
        expect(harness.persistPatch).not.toHaveBeenCalled();
    });
});
