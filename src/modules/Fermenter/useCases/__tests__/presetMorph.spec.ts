import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../stores/fermenterStore', () => ({
    loadFermenterPatch: vi.fn(),
}));

import { clampDeviceParameterValue } from '#/modules/Arrangement/useCases';

import { DEFAULT_PATCH, type FermenterPatch } from '../../models/FermenterPatch';
import { loadFermenterPatch } from '../../stores/fermenterStore';
import { setFermenterDependencies } from '../fermenterDependencies';
import { applyMorphedPatch } from '../presetMorph/applyMorphedPatch';
import { bilinearPatch } from '../presetMorph/bilinearPatch';
import { lerpPatch } from '../presetMorph/lerpPatch';

function patch(name: string, overrides: Partial<FermenterPatch> = {}): FermenterPatch {
    return { ...DEFAULT_PATCH, name, ...overrides };
}

describe('presetMorph', () => {
    const getAllTracks = vi.fn(() => [{ id: 't1', devices: [{ id: 'd1' }] }] as never);
    const updateDevicePatch = vi.fn();
    const persistDevicePatch = vi.fn();
    const updateDeviceParam = vi.fn();
    const persistDeviceParam = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
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
        vi.mocked(loadFermenterPatch).mockClear();
        updateDevicePatch.mockClear();
        persistDevicePatch.mockClear();
        getAllTracks.mockReturnValue([{ id: 't1', devices: [{ id: 'd1' }] }] as never);
        setFermenterDependencies({
            clampDeviceParameterValue,
            getAllTracks,
            resolveEligibleDeviceWriteTarget: () => ({ status: 'eligible', trackId: 't1', deviceId: 'd1' }),
            updateDeviceParam: updateDeviceParam as never,
            persistDeviceParam: persistDeviceParam as never,
            updateDevicePatch: updateDevicePatch as never,
            persistDevicePatch: persistDevicePatch as never,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

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

    it('applyMorphedPatch updates store immediately and forwards the DSP-mapped patch to engine + raw patch to persistence on the next frame', () => {
        const p = patch('P', { masterGain: 5, compThreshold: -8 });
        applyMorphedPatch('d1', p);

        // Store write is synchronous; engine/persist are deferred to the rAF flush.
        expect(loadFermenterPatch).toHaveBeenCalledWith('d1', p);
        expect(updateDevicePatch).not.toHaveBeenCalled();
        expect(persistDevicePatch).not.toHaveBeenCalled();

        vi.advanceTimersByTime(16);

        // The engine consumes snake_case DSP ids (layer.rs silently ignores
        // unknown params), so the flush must send the mapped patch — like the
        // sibling loadFermenterPatchWithAudio path — while persistence keeps
        // the raw camelCase patch.
        expect(updateDevicePatch).toHaveBeenCalledWith(
            't1',
            'd1',
            expect.objectContaining({ master_gain: 5, comp_threshold: -8 })
        );
        const sent = updateDevicePatch.mock.calls[0]?.[2] as Record<string, number>;
        expect(sent).not.toHaveProperty('masterGain');
        expect(sent).not.toHaveProperty('compThreshold');
        expect(persistDevicePatch).toHaveBeenCalledWith('d1', p);
    });

    it('applyMorphedPatch maps the 7 DSP-renamed params so the engine does not silently drop them', () => {
        const p = patch('P', {
            oscEngine: 1,
            filterCutoff: 1234,
            filterResonance: 0.7,
            filterEnvAmount: 0.5,
            lfoPitchAmount: 0.3,
            oscDrift: 0.2,
            portamentoTime: 0.4,
        });
        applyMorphedPatch('d1', p);

        vi.advanceTimersByTime(16);

        expect(updateDevicePatch).toHaveBeenCalledWith(
            't1',
            'd1',
            expect.objectContaining({
                engine: 1,
                cutoff: 1234,
                resonance: 0.7,
                mod_env_to_filter: 0.5,
                mod_lfo_to_pitch: 0.3,
                drift: 0.2,
                portamento: 0.4,
            })
        );
        const sent = updateDevicePatch.mock.calls[0]?.[2] as Record<string, number>;
        expect(sent).not.toHaveProperty('oscEngine');
        expect(sent).not.toHaveProperty('filterCutoff');
        expect(sent).not.toHaveProperty('filterResonance');
        expect(sent).not.toHaveProperty('filterEnvAmount');
        expect(sent).not.toHaveProperty('lfoPitchAmount');
        expect(sent).not.toHaveProperty('oscDrift');
        expect(sent).not.toHaveProperty('portamentoTime');
        // …and the naive camelCase→snake_case names the worklet would derive.
        expect(sent).not.toHaveProperty('osc_engine');
        expect(sent).not.toHaveProperty('filter_cutoff');
        expect(sent).not.toHaveProperty('filter_resonance');
        expect(sent).not.toHaveProperty('filter_env_amount');
        expect(sent).not.toHaveProperty('lfo_pitch_amount');
        expect(sent).not.toHaveProperty('osc_drift');
        expect(sent).not.toHaveProperty('portamento_time');
    });

    it('applyMorphedPatch coalesces a rapid drag to one engine + persist flush with the latest patch', () => {
        const a = patch('A', { masterGain: 1 });
        const b = patch('B', { masterGain: 2 });
        const c = patch('C', { masterGain: 3 });

        applyMorphedPatch('d1', a);
        applyMorphedPatch('d1', b);
        applyMorphedPatch('d1', c);

        expect(updateDevicePatch).not.toHaveBeenCalled();
        expect(persistDevicePatch).not.toHaveBeenCalled();

        vi.advanceTimersByTime(16);

        expect(updateDevicePatch).toHaveBeenCalledTimes(1);
        expect(persistDevicePatch).toHaveBeenCalledTimes(1);
        expect(updateDevicePatch).toHaveBeenCalledWith('t1', 'd1', expect.objectContaining({ master_gain: 3 }));
        expect(persistDevicePatch).toHaveBeenCalledWith('d1', c);
    });

    it('applyMorphedPatch is a no-op when the device write target is ineligible', () => {
        setFermenterDependencies({
            clampDeviceParameterValue,
            getAllTracks,
            resolveEligibleDeviceWriteTarget: () => ({ status: 'ineligible' }),
            updateDeviceParam: updateDeviceParam as never,
            persistDeviceParam: persistDeviceParam as never,
            updateDevicePatch: updateDevicePatch as never,
            persistDevicePatch: persistDevicePatch as never,
        });

        applyMorphedPatch('d1', patch('P'));

        // Ineligible target → no store write, no batched flush.
        expect(loadFermenterPatch).not.toHaveBeenCalled();
        vi.advanceTimersByTime(16);
        expect(updateDevicePatch).not.toHaveBeenCalled();
        expect(persistDevicePatch).not.toHaveBeenCalled();
    });

    it('applyMorphedPatch is a no-op when the device write target is missing', () => {
        setFermenterDependencies({
            clampDeviceParameterValue,
            getAllTracks,
            resolveEligibleDeviceWriteTarget: () => ({ status: 'missing' }),
            updateDeviceParam: updateDeviceParam as never,
            persistDeviceParam: persistDeviceParam as never,
            updateDevicePatch: updateDevicePatch as never,
            persistDevicePatch: persistDevicePatch as never,
        });

        applyMorphedPatch('d1', patch('P'));

        expect(loadFermenterPatch).not.toHaveBeenCalled();
        vi.advanceTimersByTime(16);
        expect(updateDevicePatch).not.toHaveBeenCalled();
    });

    it('flushMorph skips the engine write when updateDevicePatch is not provided', () => {
        // Only persistence is wired (updateDevicePatch omitted) — the flush must
        // still persist the raw patch but skip the engine write.
        setFermenterDependencies({
            clampDeviceParameterValue,
            getAllTracks,
            resolveEligibleDeviceWriteTarget: () => ({ status: 'eligible', trackId: 't1', deviceId: 'd1' }),
            updateDeviceParam: updateDeviceParam as never,
            persistDeviceParam: persistDeviceParam as never,
            persistDevicePatch: persistDevicePatch as never,
        });

        applyMorphedPatch('d1', patch('P', { masterGain: 7 }));
        vi.advanceTimersByTime(16);

        expect(updateDevicePatch).not.toHaveBeenCalled();
        expect(persistDevicePatch).toHaveBeenCalledWith('d1', expect.objectContaining({ masterGain: 7 }));
    });

    it('flushMorph skips persistence when persistDevicePatch is not provided', () => {
        setFermenterDependencies({
            clampDeviceParameterValue,
            getAllTracks,
            resolveEligibleDeviceWriteTarget: () => ({ status: 'eligible', trackId: 't1', deviceId: 'd1' }),
            updateDeviceParam: updateDeviceParam as never,
            persistDeviceParam: persistDeviceParam as never,
            updateDevicePatch: updateDevicePatch as never,
        });

        applyMorphedPatch('d1', patch('P', { masterGain: 9 }));
        vi.advanceTimersByTime(16);

        expect(updateDevicePatch).toHaveBeenCalledWith('t1', 'd1', expect.objectContaining({ master_gain: 9 }));
        expect(persistDevicePatch).not.toHaveBeenCalled();
    });

    it('flushMorph is a no-op when the deferred target becomes ineligible at flush time', () => {
        // The applyMorphedPatch call resolves eligible (so the batch is scheduled),
        // but by the time the rAF flush runs the target is ineligible.
        let callCount = 0;
        setFermenterDependencies({
            clampDeviceParameterValue,
            getAllTracks,
            resolveEligibleDeviceWriteTarget: () => {
                callCount++;
                return callCount <= 1
                    ? { status: 'eligible', trackId: 't1', deviceId: 'd1' }
                    : { status: 'ineligible' };
            },
            updateDeviceParam: updateDeviceParam as never,
            persistDeviceParam: persistDeviceParam as never,
            updateDevicePatch: updateDevicePatch as never,
            persistDevicePatch: persistDevicePatch as never,
        });

        applyMorphedPatch('d1', patch('P'));
        vi.advanceTimersByTime(16);

        // Store was still written (the eligibility check in applyMorphedPatch passed),
        // but the flush wrote nothing.
        expect(loadFermenterPatch).toHaveBeenCalledWith('d1', expect.any(Object));
        expect(updateDevicePatch).not.toHaveBeenCalled();
        expect(persistDevicePatch).not.toHaveBeenCalled();
    });
});
