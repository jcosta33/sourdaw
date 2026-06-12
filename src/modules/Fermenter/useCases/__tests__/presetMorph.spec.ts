import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../stores/fermenterStore', () => ({
    loadFermenterPatch: vi.fn(),
}));

import { type FermenterPatch } from '../../models/FermenterPatch';
import { loadFermenterPatch } from '../../stores/fermenterStore';
import { setFermenterDependencies } from '../fermenterDependencies';
import { applyMorphedPatch } from '../presetMorph/applyMorphedPatch';
import { lerpPatch, bilinearPatch } from '../presetMorph/bilinearPatch';

function patch(name: string, overrides: Partial<FermenterPatch>): FermenterPatch {
    return { name, version: 1, gain: 0, threshold: 0, ratio: 1, ...overrides } as unknown as FermenterPatch;
}

describe('presetMorph', () => {
    const getAllTracks = vi.fn(() => [{ id: 't1', devices: [{ id: 'd1' }] }] as never);
    const updateDevicePatch = vi.fn();
    const persistDevicePatch = vi.fn();
    const updateDeviceParam = vi.fn();
    const persistDeviceParam = vi.fn();

    beforeEach(() => {
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

    it('lerpPatch interpolates numeric fields linearly', () => {
        const a = patch('A', { gain: 0, threshold: -20 });
        const b = patch('B', { gain: 10, threshold: 0 });

        const mid = lerpPatch(a, b, 0.5);
        expect(mid.gain).toBe(5);
        expect(mid.threshold).toBe(-10);
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
        const a = patch('A', { gain: 0 });
        const b = patch('B', { gain: 10 });
        expect(lerpPatch(a, b, 0.2).name).toBe('A');
        expect(lerpPatch(a, b, 0.8).name).toBe('B');
    });

    it('lerpPatch clamps t to [0, 1]', () => {
        const a = patch('A', { gain: 0 });
        const b = patch('B', { gain: 10 });
        expect(lerpPatch(a, b, -1).gain).toBe(0);
        expect(lerpPatch(a, b, 2).gain).toBe(10);
    });

    it('bilinearPatch interpolates between four corners', () => {
        const tl = patch('TL', { gain: 0 });
        const tr = patch('TR', { gain: 10 });
        const bl = patch('BL', { gain: 20 });
        const br = patch('BR', { gain: 30 });
        expect(bilinearPatch(tl, tr, bl, br, 0.5, 0.5).gain).toBe(15);
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

    it('applyMorphedPatch updates store and forwards the whole patch to engine + persistence', () => {
        const p = patch('P', { gain: 5, threshold: -8 });
        applyMorphedPatch('d1', p);

        expect(loadFermenterPatch).toHaveBeenCalledWith('d1', p);
        expect(updateDevicePatch).toHaveBeenCalledWith('t1', 'd1', p);
        expect(persistDevicePatch).toHaveBeenCalledWith('d1', p);
    });
});
