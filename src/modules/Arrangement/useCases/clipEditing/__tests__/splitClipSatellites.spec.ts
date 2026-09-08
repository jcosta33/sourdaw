import { describe, it, expect, beforeEach } from 'vitest';

import { getAutomationLanes, getAutomationValueAtBeat, restoreAutomationSnapshot } from '#/modules/Automation/useCases';

import { __resetGainEnvelopesForTest, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { setWarpState, warpStates } from '../../../stores/warpStates';
import { prepareClipSplitSatellites } from '../splitClipSatellites';

function planFor(clipRelativeSplitBeats: number, contentSplitBeats = clipRelativeSplitBeats) {
    return prepareClipSplitSatellites({
        clipId: 'c1',
        rightClipId: 'c2',
        clipRelativeSplitBeats,
        contentSplitBeats,
        absoluteSplitBeats: clipRelativeSplitBeats,
    });
}

function createClipLane(input: {
    id: string;
    beats: number[];
    values?: number[];
    trimBeats?: number[];
    ghostBeats?: number[];
}) {
    return {
        id: input.id,
        trackId: 'track-1',
        clipId: 'c1',
        parameterId: 'gain',
        parameterName: 'Gain',
        points: input.beats.map((beat, index) => ({
            beat,
            value: input.values?.[index] ?? 0.5,
            curve: 'linear' as const,
            tension: 0,
        })),
        ...(input.trimBeats === undefined
            ? {}
            : {
                  trimPoints: input.trimBeats.map((beat) => ({
                      beat,
                      value: 0.25,
                      curve: 'linear' as const,
                      tension: 0,
                  })),
              }),
        objects: [],
        ...(input.ghostBeats === undefined
            ? {}
            : {
                  ghostPoints: input.ghostBeats.map((beat) => ({
                      beat,
                      value: 0.75,
                      curve: 'linear' as const,
                      tension: 0,
                  })),
              }),
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

describe('prepareClipSplitSatellites', () => {
    beforeEach(() => {
        __resetGainEnvelopesForTest();
        warpStates.clear();
        restoreAutomationSnapshot({ lanes: [] });
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

    it('copies the points at or right of the cut onto a lane keyed to the right clip, verbatim', () => {
        restoreAutomationSnapshot({
            lanes: [createClipLane({ id: 'lane-1', beats: [1, 4, 7] })],
        });

        const plan = planFor(4);

        // Absolute-timeline points are clamped to the fragment's window, not
        // re-based — the curve must stay on the audio it was drawn against.
        expect(plan.rightAutomationLanes).toHaveLength(1);
        expect(plan.rightAutomationLanes[0]?.clipId).toBe('c2');
        expect(plan.rightAutomationLanes[0]?.id).toBe('auto-split-c2-0');
        expect(plan.rightAutomationLanes[0]?.points).toEqual([
            { beat: 4, value: 0.5, curve: 'linear', tension: 0 },
            { beat: 7, value: 0.5, curve: 'linear', tension: 0 },
        ]);
        // The source lane itself is untouched: the left half keeps its id and
        // its whole point set, so the undo leg has nothing to restore there.
        expect(getAutomationLanes()).toHaveLength(1);
        expect(getAutomationLanes()[0]?.points).toHaveLength(3);
    });

    it('clamps trim and ghost points the same way and skips a lane with nothing at or right of the cut', () => {
        restoreAutomationSnapshot({
            lanes: [
                createClipLane({ id: 'lane-left-only', beats: [1], trimBeats: [2] }),
                createClipLane({ id: 'lane-straddling', beats: [3], trimBeats: [4, 6], ghostBeats: [5] }),
            ],
        });

        const plan = planFor(4);

        expect(plan.rightAutomationLanes).toHaveLength(1);
        expect(plan.rightAutomationLanes[0]?.id).toBe('auto-split-c2-1');
        expect(plan.rightAutomationLanes[0]?.trimPoints?.map((point) => point.beat)).toEqual([4, 6]);
        expect(plan.rightAutomationLanes[0]?.ghostPoints?.map((point) => point.beat)).toEqual([5]);
    });

    it('prepends a seam point at the cut so a straddling segment keeps its shape on the fragment', () => {
        // Segment 1→6 straddles the cut at 4: without a seam the fragment would
        // hold 0.8 from the cut, jumping off the curve the source was playing.
        restoreAutomationSnapshot({ lanes: [createClipLane({ id: 'lane-1', beats: [1, 6], values: [0.2, 0.8] })] });
        const seamValue = getAutomationValueAtBeat('lane-1', 4);
        expect(seamValue).toBeCloseTo(0.56, 10);

        const plan = planFor(4);

        expect(plan.rightAutomationLanes).toHaveLength(1);
        expect(plan.rightAutomationLanes[0]?.points).toEqual([
            { id: 'asp-split-c2-0', beat: 4, value: seamValue, curve: 'linear', tension: 0 },
            { beat: 6, value: 0.8, curve: 'linear', tension: 0 },
        ]);

        // Playback continuity: inside the former straddling segment the
        // fragment evaluates to exactly what the source lane played.
        const playedBeforeSplit = getAutomationValueAtBeat('lane-1', 4.5);
        expect(playedBeforeSplit).toBeCloseTo(0.62, 10);
        restoreAutomationSnapshot({ lanes: [plan.rightAutomationLanes[0]!] });
        expect(getAutomationValueAtBeat('auto-split-c2-0', 4.5)).toBe(playedBeforeSplit);
    });

    it('adds no seam beside a source point already sitting on the cut', () => {
        restoreAutomationSnapshot({
            lanes: [createClipLane({ id: 'lane-1', beats: [1, 4, 7], values: [0.2, 0.5, 0.8] })],
        });

        const plan = planFor(4);

        // The authored point at the cut is the seam; a second point beside it
        // would make the interpolation span zero-width.
        expect(plan.rightAutomationLanes[0]?.points.map((point) => point.beat)).toEqual([4, 7]);
    });
});
