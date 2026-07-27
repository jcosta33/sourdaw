import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, redo, undo } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { prepareMidiGlobalTimeTransaction } from '#/modules/MIDI/useCases';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { setTimeOperationDependencies } from '../../timeOperations/timeOperationDependencies';
import { deleteTimeRange } from '../deleteTimeRange';

function noChangePreparation() {
    return {
        status: 'ready' as const,
        hasChanges: false,
        replayPlan: { version: 1 as const, notes: [] },
        inversePlan: null,
        apply: () => false,
        revert: () => false,
    };
}

function installDependencies(): void {
    setTimeOperationDependencies({
        prepareAutomationTimeOperation: noChangePreparation,
        prepareAutomationTimeStateRestore: noChangePreparation,
        prepareMidiGlobalTimeTransaction,
        prepareMidiTimeStateRestore: noChangePreparation,
        prepareTimelineMapTimeOperation: noChangePreparation,
        prepareTimelineMapStateRestore: noChangePreparation,
    });
}

function createClip(input: {
    id: string;
    trackId: string;
    startBeat: number;
    endBeat: number;
    type?: 'audio' | 'midi';
    audioOffsetBeats?: number;
}) {
    const clipType = input.type ?? 'audio';
    return ClipDummy.create({
        id: input.id,
        trackId: input.trackId,
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        type: clipType,
        audioOffsetBeats: input.audioOffsetBeats,
    });
}

function createTrack(id: string, clips: ReturnType<typeof createClip>[]) {
    return TrackDummy.create({ id, clips });
}

function historyState() {
    const state = undoStore.value;
    if (!state) {
        throw new Error('Expected undo history state');
    }
    return state;
}

describe('deleteTimeRange', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        clearUndoHistory();
        trackStore.set({
            tracks: [],
            selectedTrackId: null,
            ghostClips: [],
        });
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        installDependencies();
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('12345678-1234-4123-8123-123456789abc');
    });

    afterEach(() => {
        clearUndoHistory();
        setTimeOperationDependencies(null);
        vi.restoreAllMocks();
    });

    it('preserves selected-range geometry and MIDI timing through repeated real undo and redo', async () => {
        const drop = createClip({
            id: 'drop-midi',
            trackId: 'target',
            startBeat: 4,
            endBeat: 5,
            type: 'midi',
        });
        const span = createClip({
            id: 'span-midi',
            trackId: 'target',
            startBeat: 0,
            endBeat: 10,
            type: 'midi',
        });
        const untouched = createClip({
            id: 'untouched',
            trackId: 'target',
            startBeat: 12,
            endBeat: 14,
        });
        const otherClip = createClip({
            id: 'other-clip',
            trackId: 'other',
            startBeat: 2,
            endBeat: 4,
        });
        const other = createTrack('other', [otherClip]);
        const ghost = createClip({
            id: 'ghost',
            trackId: 'ghost-owner',
            startBeat: 20,
            endBeat: 22,
        });
        const originalState = {
            tracks: [createTrack('target', [drop, span, untouched]), other],
            selectedTrackId: 'target',
            ghostClips: [ghost],
        };
        const originalMidi = {
            notesByClipId: {
                'drop-midi': [{ id: 'drop-note', pitch: 55, startBeat: 0, duration: 1, velocity: 90 }],
                'span-midi': [
                    { id: 'n-left', pitch: 60, startBeat: 1, duration: 1, velocity: 100 },
                    { id: 'n-straddle', pitch: 62, startBeat: 2, duration: 3, velocity: 100 },
                    { id: 'n-hole', pitch: 64, startBeat: 4, duration: 1, velocity: 100 },
                    { id: 'n-spanner', pitch: 65, startBeat: 1.5, duration: 7, velocity: 100 },
                    { id: 'n-post', pitch: 67, startBeat: 8, duration: 1, velocity: 100 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        trackStore.set(originalState);
        midiStore.set(originalMidi);
        const originalMidiState = midiStore.value;

        deleteTimeRange(3, 7, ['target']);

        const firstAppliedArrangement = trackStore.value;
        const firstAppliedMidi = midiStore.value;
        expect(firstAppliedArrangement?.tracks).toEqual([
            {
                ...originalState.tracks[0],
                clips: [
                    { ...span, endBeat: 3, name: 'Test Clip (L)' },
                    {
                        ...span,
                        id: 'clip-dtr-12345678',
                        startBeat: 7,
                        name: 'Test Clip (R)',
                        audioOffsetBeats: 7,
                        midiOffsetBeats: 0,
                    },
                    untouched,
                ],
            },
            other,
        ]);
        expect(firstAppliedArrangement?.tracks[1]).toBe(other);
        expect(firstAppliedArrangement?.ghostClips).toBe(originalState.ghostClips);
        expect(firstAppliedMidi?.notesByClipId['drop-midi']).toBeUndefined();
        expect(firstAppliedMidi?.notesByClipId['span-midi']).toEqual([
            { id: 'n-left', pitch: 60, startBeat: 1, duration: 1, velocity: 100 },
            { id: 'n-straddle', pitch: 62, startBeat: 2, duration: 1, velocity: 100 },
            { id: 'n-spanner', pitch: 65, startBeat: 1.5, duration: 1.5, velocity: 100 },
        ]);
        const firstRightNotes = firstAppliedMidi?.notesByClipId['clip-dtr-12345678'];
        expect(firstRightNotes).toHaveLength(2);
        expect(firstRightNotes?.[0]).toMatchObject({ startBeat: 0, duration: 1.5, pitch: 65 });
        expect(firstRightNotes?.[1]).toMatchObject({ id: 'n-post', startBeat: 1, duration: 1 });
        expect(historyState().past).toHaveLength(1);
        expect(historyState().past[0]?.label).toBe('Delete Time Range');
        expect(historyState().future).toHaveLength(0);

        await undo();

        expect(trackStore.value).toBe(originalState);
        expect(midiStore.value).toBe(originalMidiState);
        expect(historyState().past).toHaveLength(0);
        expect(historyState().future).toHaveLength(1);

        await redo();

        expect(trackStore.value).toEqual(firstAppliedArrangement);
        expect(midiStore.value).toEqual(firstAppliedMidi);
        expect(trackStore.value?.tracks[0]?.clips[1]?.id).toBe('clip-dtr-12345678');
        expect(midiStore.value?.notesByClipId['clip-dtr-12345678']?.map((note) => note.id)).toEqual(
            firstRightNotes?.map((note) => note.id)
        );
        expect(historyState().past).toHaveLength(1);
        expect(historyState().future).toHaveLength(0);

        await undo();
        expect(trackStore.value).toBe(originalState);
        expect(midiStore.value).toBe(originalMidiState);
        await redo();
        expect(trackStore.value).toEqual(firstAppliedArrangement);
        expect(midiStore.value).toEqual(firstAppliedMidi);
    });

    it('trims one-edge overlaps without partitioning MIDI or closing time after the range', async () => {
        const left = createClip({ id: 'left', trackId: 'target', startBeat: 2, endBeat: 6, type: 'midi' });
        const right = createClip({
            id: 'right',
            trackId: 'target',
            startBeat: 6,
            endBeat: 10,
            type: 'midi',
            audioOffsetBeats: 1,
        });
        const after = createClip({
            id: 'after',
            trackId: 'target',
            startBeat: 12,
            endBeat: 14,
            type: 'midi',
        });
        const track = createTrack('target', [left, right, after]);
        const originalState = {
            tracks: [track],
            selectedTrackId: 'target',
            ghostClips: [],
        };
        const originalMidi = {
            notesByClipId: {
                left: [{ id: 'left-note', pitch: 60, startBeat: 3, duration: 1, velocity: 90 }],
                right: [{ id: 'right-note', pitch: 62, startBeat: 1, duration: 1, velocity: 90 }],
                after: [{ id: 'after-note', pitch: 64, startBeat: 0, duration: 1, velocity: 90 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        trackStore.set(originalState);
        midiStore.set(originalMidi);
        const originalMidiState = midiStore.value;

        deleteTimeRange(4, 8, ['target']);

        expect(trackStore.value?.tracks[0]?.clips).toEqual([
            { ...left, endBeat: 4 },
            { ...right, startBeat: 8, audioOffsetBeats: 3 },
            after,
        ]);
        expect(midiStore.value).toBe(originalMidiState);
        expect(trackStore.value?.tracks[0]?.clips[2]).toBe(after);
        await undo();
        expect(trackStore.value).toBe(originalState);
        expect(midiStore.value).toBe(originalMidiState);
    });

    it('creates no history for empty, rejected, or structural no-change requests', () => {
        const untouched = createClip({
            id: 'untouched',
            trackId: 'target',
            startBeat: 10,
            endBeat: 12,
        });
        const state = {
            tracks: [createTrack('target', [untouched])],
            selectedTrackId: 'target',
            ghostClips: [],
        };
        trackStore.set(state);
        const midiState = midiStore.value;

        deleteTimeRange(0, 4, []);
        deleteTimeRange(Number.NaN, 4, ['target']);
        deleteTimeRange(0, 4, ['missing']);
        deleteTimeRange(0, 4, ['target']);

        expect(trackStore.value).toBe(state);
        expect(midiStore.value).toBe(midiState);
        expect(historyState().past).toHaveLength(0);
        expect(historyState().future).toHaveLength(0);
    });

    it('leaves the real history entry in place when undo is stale', async () => {
        const doomed = createClip({
            id: 'doomed',
            trackId: 'target',
            startBeat: 1,
            endBeat: 3,
        });
        trackStore.set({
            tracks: [createTrack('target', [doomed])],
            selectedTrackId: 'target',
            ghostClips: [],
        });

        deleteTimeRange(0, 4, ['target']);

        const applied = trackStore.value;
        if (!applied) {
            throw new Error('Expected applied track state');
        }
        const intervening = { ...applied };
        trackStore.set(intervening);

        await expect(undo()).rejects.toThrow('Arrangement undo returned false');
        expect(trackStore.value).toBe(intervening);
        expect(historyState().past).toHaveLength(1);
        expect(historyState().future).toHaveLength(0);
    });

    it('drops a rejected redo through REDO_NOT_APPLIED without recording an unapplied edit', async () => {
        const span = createClip({
            id: 'span',
            trackId: 'target',
            startBeat: 0,
            endBeat: 10,
            type: 'midi',
        });
        const originalState = {
            tracks: [createTrack('target', [span])],
            selectedTrackId: 'target',
            ghostClips: [],
        };
        trackStore.set(originalState);
        midiStore.set({
            notesByClipId: {
                span: [{ id: 'right-note', pitch: 64, startBeat: 8, duration: 1, velocity: 90 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        deleteTimeRange(3, 7, ['target']);
        await undo();

        const collision = createClip({
            id: 'clip-dtr-12345678',
            trackId: 'other',
            startBeat: 20,
            endBeat: 22,
        });
        const collidingState = {
            ...originalState,
            tracks: [...originalState.tracks, createTrack('other', [collision])],
        };
        trackStore.set(collidingState);

        await redo();

        expect(trackStore.value).toBe(collidingState);
        expect(historyState().past).toHaveLength(0);
        expect(historyState().future).toHaveLength(0);
    });
});
