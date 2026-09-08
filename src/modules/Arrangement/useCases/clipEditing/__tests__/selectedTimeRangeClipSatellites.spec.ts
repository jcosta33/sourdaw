import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getAutomationLanes,
    getAutomationValueAtBeat,
    prepareAutomationTimeOperation,
    prepareAutomationTimeStateRestore,
    restoreAutomationSnapshot,
} from '#/modules/Automation/useCases';
import { clearUndoHistory, redo, undo } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { prepareMidiGlobalTimeTransaction, prepareMidiTimeStateRestore } from '#/modules/MIDI/useCases';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { defaultWarpState, type WarpState } from '../../../models/WarpMarker';
import {
    __resetGainEnvelopesForTest,
    type ClipGainEnvelope,
    getEnvelope,
    setEnvelope,
} from '../../../stores/gainEnvelopeStore';
import { markerStore } from '../../../stores/markerStore';
import { trackStore } from '../../../stores/trackStore';
import { setWarpState, warpStates } from '../../../stores/warpStates';
import { executeGlobalTimeOperation } from '../../timeOperations/executeGlobalTimeOperation';
import { setTimeOperationDependencies } from '../../timeOperations/timeOperationDependencies';
import { deleteTimeRange } from '../deleteTimeRange';

const TRACK_ID = 'track-1';

function idlePreparation() {
    return {
        status: 'ready' as const,
        hasChanges: false,
        replayPlan: { version: 1 as const, notes: [] },
        inversePlan: null,
        apply: () => false,
        revert: () => false,
    };
}

/** Automation, MIDI and the clip stores run for real; Transport stays idle. */
function installDependencies(): void {
    setTimeOperationDependencies({
        prepareAutomationTimeOperation,
        prepareAutomationTimeStateRestore,
        prepareMidiGlobalTimeTransaction,
        prepareMidiTimeStateRestore,
        prepareTimelineMapTimeOperation: idlePreparation,
        prepareTimelineMapStateRestore: idlePreparation,
    });
}

function setTracks(clips: ReturnType<typeof ClipDummy.create>[]): void {
    trackStore.set({
        tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'audio', clips })],
        selectedTrackId: TRACK_ID,
        ghostClips: [],
    });
}

function createClip(input: { id: string; startBeat: number; endBeat: number }) {
    return ClipDummy.create({
        id: input.id,
        trackId: TRACK_ID,
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        type: 'audio',
    });
}

function createLane(input: { id: string; clipId?: string; beat: number }) {
    return {
        id: input.id,
        trackId: TRACK_ID,
        ...(input.clipId === undefined ? {} : { clipId: input.clipId }),
        parameterId: 'gain',
        parameterName: 'Gain',
        points: [{ beat: input.beat, value: 0.5, curve: 'linear' as const, tension: 0 }],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

function createGainEnvelope(clipId: string): ClipGainEnvelope {
    return {
        clipId,
        enabled: true,
        points: [{ id: `${clipId}-point`, beatOffset: 1, gainDb: -6 }],
    };
}

function createWarpState(): WarpState {
    return {
        ...defaultWarpState,
        enabled: true,
        markers: [{ id: 'warp-1', originalBeat: 0, warpedBeat: 0.5, origin: 'user', locked: false }],
    };
}

function laneIds(): string[] {
    return getAutomationLanes().map((lane) => lane.id);
}

/** The runtime evaluator reads `number | null`; these lanes must evaluate. */
function evaluatedValue(laneId: string, beat: number): number {
    const value = getAutomationValueAtBeat(laneId, beat);
    expect(value).not.toBeNull();
    return value ?? Number.NaN;
}

function clipIds(): string[] {
    return (trackStore.value?.tracks[0]?.clips ?? []).map((clip) => clip.id);
}

describe('Delete Time Range retires per-clip satellite data', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        clearUndoHistory();
        warpStates.clear();
        __resetGainEnvelopesForTest();
        restoreAutomationSnapshot({ lanes: [] });
        markerStore.set({ markers: [], sections: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        setTracks([
            createClip({ id: 'automated', startBeat: 0, endBeat: 4 }),
            createClip({ id: 'keeper', startBeat: 8, endBeat: 12 }),
        ]);
        installDependencies();
    });

    afterEach(() => {
        clearUndoHistory();
        setTimeOperationDependencies(null);
        vi.restoreAllMocks();
    });

    it('leaves later time operations working after deleting a range over an automated clip', () => {
        restoreAutomationSnapshot({
            lanes: [
                createLane({ id: 'lane-clip', clipId: 'automated', beat: 2 }),
                createLane({ id: 'lane-track', beat: 10 }),
            ],
        });

        deleteTimeRange(0, 4, [TRACK_ID]);
        expect(clipIds()).toEqual(['keeper']);

        // Before the fix the removed clip's lane survived this path entirely,
        // and it pinned every later time operation — global or ranged — on
        // Automation's orphaned-lane check.
        const inserted = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 0, durationBeats: 4 } });
        expect(inserted.status).toBe('applied');

        deleteTimeRange(12, 16, [TRACK_ID]);
        expect(clipIds()).toEqual([]);
    });

    it('removes the automation lane, gain envelope, and warp state of a removed clip', () => {
        restoreAutomationSnapshot({
            lanes: [
                createLane({ id: 'lane-clip', clipId: 'automated', beat: 2 }),
                createLane({ id: 'lane-keeper', clipId: 'keeper', beat: 10 }),
            ],
        });
        setEnvelope('automated', createGainEnvelope('automated'));
        setEnvelope('keeper', createGainEnvelope('keeper'));
        setWarpState('automated', createWarpState());
        setWarpState('keeper', createWarpState());

        deleteTimeRange(0, 4, [TRACK_ID]);

        expect(laneIds()).toEqual(['lane-keeper']);
        expect(getEnvelope('automated')).toBeUndefined();
        expect(warpStates.has('automated')).toBe(false);
        expect(getEnvelope('keeper')).toEqual(createGainEnvelope('keeper'));
        expect(warpStates.get('keeper')).toEqual(createWarpState());
    });

    it('restores every retired satellite on undo and retires them again on redo', async () => {
        restoreAutomationSnapshot({ lanes: [createLane({ id: 'lane-clip', clipId: 'automated', beat: 2 })] });
        setEnvelope('automated', createGainEnvelope('automated'));
        setWarpState('automated', createWarpState());

        deleteTimeRange(0, 4, [TRACK_ID]);
        expect(laneIds()).toEqual([]);

        await undo();

        expect(clipIds()).toEqual(['automated', 'keeper']);
        expect(laneIds()).toEqual(['lane-clip']);
        expect(getEnvelope('automated')).toEqual(createGainEnvelope('automated'));
        expect(warpStates.get('automated')).toEqual(createWarpState());

        await redo();

        expect(clipIds()).toEqual(['keeper']);
        expect(laneIds()).toEqual([]);
        expect(getEnvelope('automated')).toBeUndefined();
        expect(warpStates.has('automated')).toBe(false);
    });

    it('gives the surviving right fragment of a split clip the inherited satellites, undoably', async () => {
        // A clip the deleted range cuts in two: the left half keeps its id, the
        // right half continues under a fresh id — and must not start bare, or
        // the same audio silently loses its expression data past the cut.
        setTracks([
            createClip({ id: 'spanning', startBeat: 0, endBeat: 8 }),
            createClip({ id: 'keeper', startBeat: 10, endBeat: 12 }),
        ]);
        setEnvelope('spanning', {
            clipId: 'spanning',
            enabled: true,
            points: [
                { id: 'p0', beatOffset: 0, gainDb: 0 },
                { id: 'p4', beatOffset: 4, gainDb: -12 },
            ],
        });
        setWarpState('spanning', {
            enabled: true,
            stretchMode: 'complex',
            originalTempo: 120,
            markers: [
                { id: 'w-left', originalBeat: 1, warpedBeat: 1 },
                { id: 'w-right', originalBeat: 6, warpedBeat: 6.5 },
            ],
        });
        restoreAutomationSnapshot({
            lanes: [
                createLane({ id: 'lane-clip', clipId: 'spanning', beat: 7 }),
                {
                    id: 'lane-follower',
                    trackId: TRACK_ID,
                    clipId: 'spanning',
                    parameterId: 'pan',
                    parameterName: 'Pan',
                    linkedLaneId: 'lane-clip',
                    linkScale: -1,
                    points: [],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: -1,
                    maxValue: 1,
                },
            ],
        });

        deleteTimeRange(2, 6, [TRACK_ID]);

        const fragmentId = clipIds().find((id) => id.startsWith('clip-dtr-'));
        expect(clipIds()).toEqual(['spanning', fragmentId, 'keeper']);

        // The left half keeps its id and its satellites untouched: nothing it
        // played changed, and inert points beyond its new edge survive.
        expect(getEnvelope('spanning')?.points).toEqual([
            { id: 'p0', beatOffset: 0, gainDb: 0 },
            { id: 'p4', beatOffset: 4, gainDb: -12 },
        ]);
        expect(warpStates.get('spanning')?.markers).toHaveLength(2);
        expect(laneIds()).toEqual([
            'lane-clip',
            'lane-follower',
            `auto-split-${fragmentId}-0`,
            `auto-split-${fragmentId}-1`,
        ]);

        // The right fragment inherits geometry-clamped copies: the envelope
        // re-based by the cut (seam value at beat 6 is -12 dB), the warp
        // markers at or past the content cut, and the automation points that
        // fall in its window, verbatim.
        expect(getEnvelope(fragmentId ?? '')).toEqual({
            clipId: fragmentId,
            enabled: true,
            points: [
                { id: 'p0', beatOffset: -6, gainDb: 0 },
                { id: 'p4', beatOffset: -2, gainDb: -12 },
                { id: `gep-split-${fragmentId}-right`, beatOffset: 0, gainDb: -12 },
            ],
        });
        expect(warpStates.get(fragmentId ?? '')?.markers).toEqual([
            { id: 'w-right', originalBeat: 6, warpedBeat: 6.5 },
        ]);
        const fragmentLane = getAutomationLanes().find((lane) => lane.id === `auto-split-${fragmentId}-0`);
        expect(fragmentLane?.clipId).toBe(fragmentId);
        expect(fragmentLane?.points.map((point) => point.beat)).toEqual([7]);
        // The source lane is untouched.
        expect(
            getAutomationLanes()
                .find((lane) => lane.id === 'lane-clip')
                ?.points.map((p) => p.beat)
        ).toEqual([7]);
        // The linked follower travels by its RESOLVED source — its own points
        // are empty — and the copy follows the leader's copy, so the driven
        // parameter keeps following over the right span.
        const fragmentFollower = getAutomationLanes().find((lane) => lane.id === `auto-split-${fragmentId}-1`);
        expect(fragmentFollower?.clipId).toBe(fragmentId);
        expect(fragmentFollower?.linkedLaneId).toBe(`auto-split-${fragmentId}-0`);
        expect(fragmentFollower?.linkScale).toBe(-1);
        const leaderValueAtSeven = evaluatedValue(`auto-split-${fragmentId}-0`, 7);
        expect(leaderValueAtSeven).toBeCloseTo(0.5, 10);
        expect(getAutomationValueAtBeat(`auto-split-${fragmentId}-1`, 7)).toBeCloseTo(-leaderValueAtSeven, 10);

        await undo();

        expect(clipIds()).toEqual(['spanning', 'keeper']);
        expect(laneIds()).toEqual(['lane-clip', 'lane-follower']);
        expect(getEnvelope('spanning')?.points).toEqual([
            { id: 'p0', beatOffset: 0, gainDb: 0 },
            { id: 'p4', beatOffset: 4, gainDb: -12 },
        ]);
        expect(warpStates.get('spanning')?.markers).toHaveLength(2);
        expect(getEnvelope(fragmentId ?? '')).toBeUndefined();
        expect(warpStates.has(fragmentId ?? '')).toBe(false);
        // The originals still follow each other over the restored left half.
        expect(getAutomationValueAtBeat('lane-follower', 7)).toBeCloseTo(-evaluatedValue('lane-clip', 7), 10);

        await redo();

        const redoneFragmentId = clipIds().find((id) => id.startsWith('clip-dtr-'));
        expect(redoneFragmentId).toBeDefined();
        expect(getEnvelope(redoneFragmentId ?? '')).not.toBeUndefined();
        expect(warpStates.has(redoneFragmentId ?? '')).toBe(true);
        expect(laneIds()).toContain(`auto-split-${redoneFragmentId}-0`);
        // The redo reproduces the link on the same deterministic ids.
        const redoneFollower = getAutomationLanes().find((lane) => lane.id === `auto-split-${redoneFragmentId}-1`);
        expect(redoneFollower?.linkedLaneId).toBe(`auto-split-${redoneFragmentId}-0`);
        expect(getAutomationValueAtBeat(`auto-split-${redoneFragmentId}-1`, 7)).toBeCloseTo(
            -evaluatedValue(`auto-split-${redoneFragmentId}-0`, 7),
            10
        );

        // The fragment lanes are keyed to live clip ids, so later time
        // operations keep working (no orphan jam).
        const inserted = executeGlobalTimeOperation({ operation: { type: 'insert', atBeat: 0, durationBeats: 2 } });
        expect(inserted.status).toBe('applied');
    });

    it('cuts the spanning fragment warp axis at content beats under stretch', () => {
        // Clip 0..8 stretched 2x consumes 2 content beats per timeline beat:
        // the deleted range [2, 6) spans content [4, 12), and the fragment at
        // timeline [6, 8) plays content [12, 16). The warp cut must land at
        // content 12 — the ordinary split's conversion — or the fragment
        // inherits the deleted span's marker and warps audio it does not
        // contain. The audio axis must advance by the same conversion, or the
        // fragment replays the deleted span's audio under the corrected warp
        // grid.
        setTracks([
            ClipDummy.create({
                id: 'spanning',
                trackId: TRACK_ID,
                startBeat: 0,
                endBeat: 8,
                type: 'audio',
                stretchRatio: 2,
            }),
            // Starts inside the deleted range: the right-trim branch shares
            // the offset conversion, so pin it on the same operation — its
            // head [4, 6) is 2 timeline beats = 4 content beats.
            ClipDummy.create({
                id: 'right-trimmed',
                trackId: TRACK_ID,
                startBeat: 4,
                endBeat: 9,
                type: 'audio',
                stretchRatio: 2,
            }),
            createClip({ id: 'keeper', startBeat: 10, endBeat: 12 }),
        ]);
        setWarpState('spanning', {
            enabled: true,
            stretchMode: 'complex',
            originalTempo: 120,
            markers: [
                { id: 'w-deleted', originalBeat: 8, warpedBeat: 8 },
                { id: 'w-right', originalBeat: 12, warpedBeat: 12.5 },
            ],
        });

        deleteTimeRange(2, 6, [TRACK_ID]);

        const fragmentId = clipIds().find((id) => id.startsWith('clip-dtr-'));
        // The left half is untouched; the deleted span's marker (sounding at
        // timeline 4, inside the deleted range) retires with the left half's
        // inert edge instead of reaching the fragment.
        expect(warpStates.get('spanning')?.markers.map((marker) => marker.id)).toEqual(['w-deleted', 'w-right']);
        expect(warpStates.get(fragmentId ?? '')?.markers.map((marker) => marker.id)).toEqual(['w-right']);

        // The audio axis agrees with the warp axis: the fragment's offset
        // advances by the consumed content beats (6 timeline beats x 2), so it
        // plays content [12, 16) — not the deleted span it now claims to skip.
        const clips = trackStore.value?.tracks[0]?.clips ?? [];
        expect(clips.find((clip) => clip.id === fragmentId)?.audioOffsetBeats).toBe(12);
        // The right-trimmed clip lost its head to the deleted range: 2
        // timeline beats x 2 = 4 content beats consumed.
        expect(clips.find((clip) => clip.id === 'right-trimmed')).toMatchObject({
            startBeat: 6,
            audioOffsetBeats: 4,
        });
    });
});
