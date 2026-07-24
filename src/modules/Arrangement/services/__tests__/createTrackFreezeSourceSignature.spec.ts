import { describe, it, expect } from 'vitest';

import { createTrackFreezeSourceSignature } from '../createTrackFreezeSourceSignature';

describe('createTrackFreezeSourceSignature', () => {
    it('builds a deterministic signature from clips and devices', () => {
        const sig = createTrackFreezeSourceSignature({
            clips: [{ id: 'c1', startBeat: 0, endBeat: 4, gain: 1 }],
            devices: [{ id: 'd1', type: 'reverb', parameterValues: { mix: 0.5, decay: 2 }, bypassed: false }],
        });

        // clip = id:startBeat:duration:assetHash:gain ; device params sorted by name.
        expect(sig).toBe('c1:0:4::1||d1:reverb:decay=2,mix=0.5:false');
    });

    it('includes the asset hash when a clip carries one', () => {
        const withHash = createTrackFreezeSourceSignature({
            clips: [{ id: 'c1', startBeat: 0, endBeat: 4, assetHash: 'sha-abc', gain: 1 }],
            devices: [],
        });
        const withoutHash = createTrackFreezeSourceSignature({
            clips: [{ id: 'c1', startBeat: 0, endBeat: 4, gain: 1 }],
            devices: [],
        });

        // The hash arm (?? '') produces a non-empty slot vs an empty one.
        expect(withHash).toBe('c1:0:4:sha-abc:1||');
        expect(withoutHash).toBe('c1:0:4::1||');
        expect(withHash).not.toBe(withoutHash);
    });

    it('sorts clips by start beat then id so reordering does not change the signature', () => {
        const base = [
            { id: 'a', startBeat: 0, endBeat: 4, gain: 1 },
            { id: 'b', startBeat: 4, endBeat: 8, gain: 1 },
        ];
        const sigForward = createTrackFreezeSourceSignature({ clips: base, devices: [] });
        const sigReversed = createTrackFreezeSourceSignature({ clips: [...base].reverse(), devices: [] });

        expect(sigForward).toBe(sigReversed);
    });

    it('is independent of device parameter insertion order', () => {
        const sigA = createTrackFreezeSourceSignature({
            clips: [],
            devices: [{ id: 'd1', type: 'eq', parameterValues: { gain: 1, freq: 440 }, bypassed: false }],
        });
        const sigB = createTrackFreezeSourceSignature({
            clips: [],
            devices: [{ id: 'd1', type: 'eq', parameterValues: { freq: 440, gain: 1 }, bypassed: false }],
        });

        // Parameter entries are sorted by name, so key order is irrelevant.
        expect(sigA).toBe(sigB);
    });
});
