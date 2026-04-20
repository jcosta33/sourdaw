import { describe, it, expect } from 'vitest';

import { type Clip, type Device } from '../../models/Track';
import { computeTrackHash } from '../computeTrackHash';

describe('computeTrackHash', () => {
    it('computes a consistent SHA-256 hash for identical clips and devices', async () => {
        const clips: Clip[] = [
            { id: 'c1', startBeat: 0, endBeat: 4, assetHash: 'hash1', gain: 1 } as Clip,
            { id: 'c2', startBeat: 4, endBeat: 8, assetHash: 'hash2', gain: 0.5 } as Clip,
        ];

        const devices: Device[] = [
            { id: 'd1', type: 'eq', bypassed: false, parameterValues: { freq: 1000, gain: 2 } } as any,
        ];

        const hash1 = await computeTrackHash(clips, devices);
        const hash2 = await computeTrackHash(clips, devices);

        expect(hash1).toBe(hash2);
        expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 is 64 hex chars
    });

    it('produces different hashes when clip properties change', async () => {
        const clips1: Clip[] = [{ id: 'c1', startBeat: 0, endBeat: 4, assetHash: 'hash1', gain: 1 } as Clip];
        const clips2: Clip[] = [{ id: 'c1', startBeat: 0, endBeat: 4, assetHash: 'hash1', gain: 0.8 } as Clip];
        const devices: Device[] = [];

        const hash1 = await computeTrackHash(clips1, devices);
        const hash2 = await computeTrackHash(clips2, devices);

        expect(hash1).not.toBe(hash2);
    });

    it('produces different hashes when device properties change', async () => {
        const clips: Clip[] = [];
        const devices1: Device[] = [{ id: 'd1', type: 'eq', bypassed: false, parameterValues: { freq: 1000 } } as any];
        const devices2: Device[] = [{ id: 'd1', type: 'eq', bypassed: false, parameterValues: { freq: 2000 } } as any];

        const hash1 = await computeTrackHash(clips, devices1);
        const hash2 = await computeTrackHash(clips, devices2);

        expect(hash1).not.toBe(hash2);
    });

    it('sorts clips and parameters to ensure order independence where appropriate', async () => {
        // Clips are ordered by startBeat
        const clips1: Clip[] = [
            { id: 'c2', startBeat: 4, endBeat: 8, gain: 1 } as Clip,
            { id: 'c1', startBeat: 0, endBeat: 4, gain: 1 } as Clip,
        ];
        const clips2: Clip[] = [
            { id: 'c1', startBeat: 0, endBeat: 4, gain: 1 } as Clip,
            { id: 'c2', startBeat: 4, endBeat: 8, gain: 1 } as Clip,
        ];

        // Device parameter values should be sorted by key internally by computeTrackHash
        const devices1: Device[] = [{ id: 'd1', type: 'eq', bypassed: false, parameterValues: { a: 1, b: 2 } } as any];
        const devices2: Device[] = [{ id: 'd1', type: 'eq', bypassed: false, parameterValues: { b: 2, a: 1 } } as any];

        const hash1 = await computeTrackHash(clips1, devices1);
        const hash2 = await computeTrackHash(clips2, devices2);

        expect(hash1).toBe(hash2);
    });
});
