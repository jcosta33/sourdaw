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

    it('rejects duplicate warp markers within or across clip entries', () => {
        expect(clipSatelliteStateCodec.decodeEntries([entry('clip-a', [], ['warp-a', 'warp-a'])])).toBeNull();
        expect(
            clipSatelliteStateCodec.decodeEntries([entry('clip-a', [], ['warp-a']), entry('clip-b', [], ['warp-a'])])
        ).toBeNull();
    });

    it('keeps gain point ids local to each clip envelope', () => {
        const entries = [entry('clip-a', ['shared-gain'], ['warp-a']), entry('clip-b', ['shared-gain'], ['warp-b'])];
        expect(clipSatelliteStateCodec.decodeEntries(entries)).toEqual(entries);
    });
});
