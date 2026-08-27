import { describe, it, expect, beforeEach } from 'vitest';

import { __resetGainEnvelopesForTest, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { setWarpState, warpStates } from '../../../stores/warpStates';
import { prepareClipSplitSatellites } from '../splitClipSatellites';

function planFor(clipRelativeSplitBeats: number, contentSplitBeats = clipRelativeSplitBeats) {
    return prepareClipSplitSatellites({
        clipId: 'c1',
        rightClipId: 'c2',
        clipRelativeSplitBeats,
        contentSplitBeats,
    });
}

describe('prepareClipSplitSatellites', () => {
    beforeEach(() => {
        __resetGainEnvelopesForTest();
        warpStates.clear();
    });

    it('captures the right half’s empty entry even when the source carries no satellites', () => {
        // The undo leg has no other way to retire whatever the right clip picked
        // up while it existed; `replaceClipSplitTrackState` only drops the
        // rectangle from the track array.
        const plan = planFor(4);

        expect(plan.previous).toEqual([
            { clipId: 'c1', gainEnvelope: null, warpState: null },
            { clipId: 'c2', gainEnvelope: null, warpState: null },
        ]);
        expect(plan.next).toEqual([
            { clipId: 'c1', gainEnvelope: null, warpState: null },
            { clipId: 'c2', gainEnvelope: null, warpState: null },
        ]);
    });

    it('leaves every authored envelope point on both halves, rebased on the right', () => {
        setEnvelope('c1', {
            clipId: 'c1',
            enabled: true,
            points: [
                { id: 'p0', beatOffset: 0, gainDb: 0 },
                { id: 'p6', beatOffset: 6, gainDb: -12 },
            ],
        });

        const plan = planFor(4);

        // The seam value at 4 between (0, 0 dB) and (6, -12 dB) is -8 dB. Points
        // on the far side of the cut are inert but preserved, so extending a
        // half's edge back out later reveals the curve the musician drew.
        expect(plan.next[0]?.gainEnvelope?.points).toEqual([
            { id: 'p0', beatOffset: 0, gainDb: 0 },
            { id: 'gep-split-c2-left', beatOffset: 4, gainDb: -8 },
            { id: 'p6', beatOffset: 6, gainDb: -12 },
        ]);
        expect(plan.next[1]?.gainEnvelope?.points).toEqual([
            { id: 'p0', beatOffset: -4, gainDb: 0 },
            { id: 'gep-split-c2-right', beatOffset: 0, gainDb: -8 },
            { id: 'p6', beatOffset: 2, gainDb: -12 },
        ]);
    });

    it('adds no seam point beside a source point that already sits on the cut', () => {
        setEnvelope('c1', {
            clipId: 'c1',
            enabled: true,
            points: [
                { id: 'p0', beatOffset: 0, gainDb: 0 },
                { id: 'p4', beatOffset: 4, gainDb: -6 },
            ],
        });

        const plan = planFor(4);

        expect(plan.next[0]?.gainEnvelope?.points).toEqual([
            { id: 'p0', beatOffset: 0, gainDb: 0 },
            { id: 'p4', beatOffset: 4, gainDb: -6 },
        ]);
        expect(plan.next[1]?.gainEnvelope?.points).toEqual([
            { id: 'p0', beatOffset: -4, gainDb: 0 },
            { id: 'p4', beatOffset: 0, gainDb: -6 },
        ]);
    });

    it('partitions warp markers by content beat while still emptying the right half on undo', () => {
        setWarpState('c1', {
            enabled: true,
            stretchMode: 'complex',
            originalTempo: 120,
            markers: [
                { id: 'w-left', originalBeat: 3, warpedBeat: 3.25 },
                { id: 'w-right', originalBeat: 7, warpedBeat: 7.5 },
            ],
        });

        const plan = planFor(4, 6);

        expect(plan.next[0]?.warpState?.markers).toEqual([{ id: 'w-left', originalBeat: 3, warpedBeat: 3.25 }]);
        expect(plan.next[1]?.warpState?.markers).toEqual([{ id: 'w-right', originalBeat: 7, warpedBeat: 7.5 }]);
        expect(plan.previous[1]).toEqual({ clipId: 'c2', gainEnvelope: null, warpState: null });
    });
});
