import { describe, expect, it } from 'vitest';

import { clipSatelliteStateCodec } from '../clipSatelliteStateCodec';

function entry(clipId: string, gainIds: string[], warpIds: string[]) {
    return {
        clipId,
        gainEnvelope: {
            clipId,
            enabled: true,
            points: gainIds.map((id, index) => ({ id, beatOffset: index, gainDb: -6 - index })),
        },
        warpState: {
            enabled: true,
            markers: warpIds.map((id, index) => ({ id, originalBeat: index, warpedBeat: index + 0.5 })),
            stretchMode: 'repitch',
            originalTempo: 120,
        },
    };
}

describe('clipSatelliteStateCodec identities', () => {
    it('rejects duplicate gain points within one envelope', () => {
        expect(clipSatelliteStateCodec.decodeEntries([entry('clip-a', ['gain-a', 'gain-a'], [])])).toBeNull();
    });

    it('rejects duplicate warp markers within one clip entry', () => {
        expect(clipSatelliteStateCodec.decodeEntries([entry('clip-a', [], ['warp-a', 'warp-a'])])).toBeNull();
    });

    it('keeps warp marker ids local to each clip', () => {
        const entries = [entry('clip-a', [], ['shared-warp']), entry('clip-b', [], ['shared-warp'])];
        const decoded = clipSatelliteStateCodec.decodeEntries(entries);
        expect(decoded).toEqual(entries);
        expect(decoded?.[0]?.warpState).not.toBe(decoded?.[1]?.warpState);
        expect(decoded?.[0]?.warpState?.markers[0]).not.toBe(decoded?.[1]?.warpState?.markers[0]);
    });

    it('keeps gain point ids local to each clip envelope', () => {
        const entries = [entry('clip-a', ['shared-gain'], ['warp-a']), entry('clip-b', ['shared-gain'], ['warp-b'])];
        expect(clipSatelliteStateCodec.decodeEntries(entries)).toEqual(entries);
    });
});
