import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../stores/fermenterStore', () => ({
    loadFermenterPatch: vi.fn(),
}));

vi.mock('../fermenterParamBridge/setFermenterParamWithAudio', () => ({
    setFermenterParamWithAudio: vi.fn(),
}));

import { lerpPatch, bilinearPatch } from '../presetMorph/bilinearPatch';
import { applyMorphedPatch } from '../presetMorph/applyMorphedPatch';
import { loadFermenterPatch } from '../../stores/fermenterStore';
import { setFermenterParamWithAudio } from '../fermenterParamBridge/setFermenterParamWithAudio';
import { type FermenterPatch } from '../../models/FermenterPatch';

function patch(name: string, overrides: Partial<FermenterPatch>): FermenterPatch {
    return { name, version: 1, gain: 0, threshold: 0, ratio: 1, ...overrides } as unknown as FermenterPatch;
}

describe('presetMorph', () => {
    beforeEach(() => {
        vi.mocked(loadFermenterPatch).mockClear();
        vi.mocked(setFermenterParamWithAudio).mockClear();
    });

    it('lerpPatch interpolates numeric fields linearly', () => {
        const a = patch('A', { gain: 0, threshold: -20 });
        const b = patch('B', { gain: 10, threshold: 0 });

        const mid = lerpPatch(a, b, 0.5);
        expect(mid.gain).toBe(5);
        expect(mid.threshold).toBe(-10);
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
        // center: avg of all four corners = 15
        expect(bilinearPatch(tl, tr, bl, br, 0.5, 0.5).gain).toBe(15);
    });

    it('applyMorphedPatch updates store and forwards numeric params', () => {
        const p = patch('P', { gain: 5, threshold: -8 });
        applyMorphedPatch('d1', p);

        expect(loadFermenterPatch).toHaveBeenCalledWith('d1', p);
        expect(setFermenterParamWithAudio).toHaveBeenCalledWith('d1', 'gain', 5);
        expect(setFermenterParamWithAudio).toHaveBeenCalledWith('d1', 'threshold', -8);
    });
});
