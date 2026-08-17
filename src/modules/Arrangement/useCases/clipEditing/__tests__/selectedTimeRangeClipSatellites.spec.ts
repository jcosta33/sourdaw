import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getAutomationLanes,
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
});
