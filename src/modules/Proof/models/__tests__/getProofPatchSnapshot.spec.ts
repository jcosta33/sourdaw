import { describe, it, expect } from 'vitest';

import { type ProofPatch } from '../ProofPatch';
import { getProofPatchSnapshot } from '../ProofPatch';

function minimalPatch(overrides: Partial<ProofPatch> = {}): ProofPatch {
    return {
        name: 'test',
        chainOrder: [0, 1, 2, 3, 4],
        inputGain: 1.5,
        outputGain: -0.5,
        eqBypassed: false,
        eqBands: [{ enabled: true, type: 0, channel: 0, freq: 1000, gain: 2, q: 0.7 }],
        dynBypassed: false,
        dynCrossoverFreqs: [120, 800, 5000],
        dynBands: [
            {
                threshold: -20,
                ratio: 2,
                attack: 10,
                release: 100,
                knee: 6,
                makeup: 3,
                autoMakeup: true,
                bypassed: false,
            },
        ],
        imgBypassed: false,
        imgBandWidth: [1, 1, 1, 1],
        imgAutoMonoBass: true,
        imgMonoBassFreq: 80,
        excBypassed: false,
        excBands: [{ type: 1, drive: 0.4, blend: 0.3, enabled: true }],
        limBypassed: false,
        limCeiling: -1,
        limRelease: 50,
        limLookahead: 5,
        ditherMode: 'tpdf',
        ditherBits: 16,
        target: 'streaming',
        targetLufs: -14,
        ...overrides,
    };
}

describe('getProofPatchSnapshot', () => {
    it('produces identical snapshots for identical patches', () => {
        const a = minimalPatch();
        const b = minimalPatch();
        expect(getProofPatchSnapshot(a)).toBe(getProofPatchSnapshot(b));
    });

    it('produces different snapshots when any scalar field changes', () => {
        const base = minimalPatch();
        const changed = minimalPatch({ inputGain: 2.0 });
        expect(getProofPatchSnapshot(base)).not.toBe(getProofPatchSnapshot(changed));
    });

    it('produces different snapshots when a band value changes', () => {
        const base = minimalPatch();
        const changed = minimalPatch({
            eqBands: [{ enabled: true, type: 0, channel: 0, freq: 2000, gain: 2, q: 0.7 }],
        });
        expect(getProofPatchSnapshot(base)).not.toBe(getProofPatchSnapshot(changed));
    });

    it('produces different snapshots when presetId changes', () => {
        const base = minimalPatch();
        const withPreset = minimalPatch({ presetId: 'preset-1' });
        expect(getProofPatchSnapshot(base)).not.toBe(getProofPatchSnapshot(withPreset));
    });

    it('normalizes undefined presetId to null in the snapshot', () => {
        const snapshot = getProofPatchSnapshot(minimalPatch());
        const parsed = JSON.parse(snapshot) as unknown[];
        // The second element is presetId ?? null.
        expect(parsed[1]).toBeNull();
    });

    it('serializes to a JSON array string', () => {
        const snapshot = getProofPatchSnapshot(minimalPatch());
        const parsed = JSON.parse(snapshot) as unknown[];
        expect(Array.isArray(parsed)).toBe(true);
        // First element is the name.
        expect(parsed[0]).toBe('test');
    });

    it('survives reference identity: new object instances with same values → same snapshot', () => {
        const a = minimalPatch({ eqBands: [{ enabled: true, type: 0, channel: 0, freq: 1000, gain: 2, q: 0.7 }] });
        const b = minimalPatch({ eqBands: [{ enabled: true, type: 0, channel: 0, freq: 1000, gain: 2, q: 0.7 }] });
        // Different array/object references, same values.
        expect(a.eqBands).not.toBe(b.eqBands);
        expect(getProofPatchSnapshot(a)).toBe(getProofPatchSnapshot(b));
    });

    it('pins the exact golden-master output for the minimal fixture', () => {
        // Lock the full serialized shape so a dropped/reordered field is caught.
        const snapshot = getProofPatchSnapshot(minimalPatch());
        expect(snapshot).toBe(
            JSON.stringify([
                'test',
                null,
                [0, 1, 2, 3, 4],
                1.5,
                -0.5,
                false,
                [[true, 0, 0, 1000, 2, 0.7]],
                false,
                [120, 800, 5000],
                [[-20, 2, 10, 100, 6, 3, true, false]],
                false,
                [1, 1, 1, 1],
                true,
                80,
                false,
                [[1, 0.4, 0.3, true]],
                false,
                -1,
                50,
                5,
                'tpdf',
                16,
                'streaming',
                -14,
            ])
        );
    });

    it('produces a different snapshot when each top-level field changes', () => {
        const base = getProofPatchSnapshot(minimalPatch());
        // Toggle every top-level scalar/array field; each must change the snapshot.
        const mutations: Partial<ProofPatch>[] = [
            { name: 'other' },
            { presetId: 'preset-x' },
            { chainOrder: [4, 3, 2, 1, 0] },
            { inputGain: 0 },
            { outputGain: 0 },
            { eqBypassed: true },
            { eqBands: [] },
            { dynBypassed: true },
            { dynCrossoverFreqs: [100, 1000, 10000] },
            { dynBands: [] },
            { imgBypassed: true },
            { imgBandWidth: [2, 2, 2, 2] },
            { imgAutoMonoBass: false },
            { imgMonoBassFreq: 120 },
            { excBypassed: true },
            { excBands: [] },
            { limBypassed: true },
            { limCeiling: -2 },
            { limRelease: 100 },
            { limLookahead: 10 },
            { ditherMode: 'off' },
            { ditherBits: 24 },
            { target: 'cd' },
            { targetLufs: -16 },
        ];
        for (const mutation of mutations) {
            expect(getProofPatchSnapshot(minimalPatch(mutation))).not.toBe(base);
        }
    });
});
