import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../stores/fermenterStore', () => ({
    loadFermenterPatch: vi.fn(),
}));

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
            getAllTracks: getAllTracks as never,
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

    it('applyMorphedPatch updates store immediately and forwards the patch to engine + persistence on the next frame', () => {
        const p = patch('P', { masterGain: 5, compThreshold: -8 });
        applyMorphedPatch('d1', p);

        // Store write is synchronous; engine/persist are deferred to the rAF flush.
        expect(loadFermenterPatch).toHaveBeenCalledWith('d1', p);
        expect(updateDevicePatch).not.toHaveBeenCalled();
        expect(persistDevicePatch).not.toHaveBeenCalled();

        vi.advanceTimersByTime(16);

        expect(updateDevicePatch).toHaveBeenCalledWith('t1', 'd1', p);
        expect(persistDevicePatch).toHaveBeenCalledWith('d1', p);
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
        expect(updateDevicePatch).toHaveBeenCalledWith('t1', 'd1', c);
        expect(persistDevicePatch).toHaveBeenCalledWith('d1', c);
    });
});
