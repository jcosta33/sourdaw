import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearUndoHistory, pushUndoEntry, redo, revertActionGroup, undo } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { removeClip } from '../../../useCases/clip/removeClip';
import { hitTestClip } from '../../../useCases/timelineInteractions/hitTestClip/hitTestClip';
import { handleCutTool } from '../timelineTools';

// Pixel hit-testing is a rendering concern; everything downstream of the cut —
// splitClip, the undo composition, and the Command undo/redo stack — runs for
// real so the undo contract is pinned end to end.
vi.mock('../../../useCases/timelineInteractions/hitTestClip/hitTestClip', () => ({ hitTestClip: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

type ClipRect = { id: string; startBeat: number; endBeat: number };

function clipRects(): ClipRect[] {
    const state = trackStore.value;
    if (!state) {
        throw new Error('expected track state');
    }
    return state.tracks
        .flatMap((track) => track.clips)
        .map((clip) => ({ id: clip.id, startBeat: clip.startBeat, endBeat: clip.endBeat }))
        .sort((alpha, beta) => alpha.startBeat - beta.startBeat);
}

describe('handleCutTool undo/redo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearUndoHistory();
        const clip = ClipDummy.create({
            id: 'c1',
            trackId: 't1',
            name: 'Groove',
            startBeat: 0,
            endBeat: 8,
            gain: 0.6,
            fadeOutBeats: 0.5,
            color: '#123456',
        });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 't1', clips: [clip] })],
            selectedTrackId: null,
        });
        vi.mocked(hitTestClip).mockReturnValue({ clipId: 'c1', trackId: 't1' });
    });

    it('splits the hit clip into two halves', () => {
        handleCutTool(10, 10, 4);

        const rects = clipRects();
        expect(rects).toHaveLength(2);
        expect(rects[0]).toMatchObject({ id: 'c1', startBeat: 0, endBeat: 4 });
        expect(rects[1]).toMatchObject({ startBeat: 4, endBeat: 8 });
    });

    it('undo restores exactly one intact clip with its original id and properties', async () => {
        handleCutTool(10, 10, 4);
        await undo();

        const state = trackStore.value;
        const clips = state?.tracks[0]?.clips ?? [];
        expect(clips).toHaveLength(1);
        expect(clips[0]).toMatchObject({
            id: 'c1',
            name: 'Groove',
            startBeat: 0,
            endBeat: 8,
            gain: 0.6,
            fadeOutBeats: 0.5,
            color: '#123456',
        });
    });

    it('redo after undo re-applies the split instead of no-oping', async () => {
        handleCutTool(10, 10, 4);
        await undo();
        await redo();

        const rects = clipRects();
        expect(rects).toHaveLength(2);
        expect(rects[0]).toMatchObject({ id: 'c1', startBeat: 0, endBeat: 4 });
        expect(rects[1]).toMatchObject({ startBeat: 4, endBeat: 8 });
    });
});

describe('handleCutTool redo after an AI plan revert (review chain)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearUndoHistory();
        const clip = ClipDummy.create({ id: 'c1', trackId: 't1', startBeat: 0, endBeat: 8 });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 't1', clips: [clip] })],
            selectedTrackId: null,
        });
        vi.mocked(hitTestClip).mockReturnValue({ clipId: 'c1', trackId: 't1' });
    });

    it('redo survives a deterministically inapplicable cut entry and re-executes the AI plan', async () => {
        const aiRedo1 = vi.fn();
        const aiRedo2 = vi.fn();

        // The AI plan lands first: two grouped entries whose revert un-creates the
        // clip lineage (as an AI revert-plan would when it undoes the clip's
        // creation). The cut then sits on top of the past stack.
        pushUndoEntry('AI step 1', () => removeClip('c1'), aiRedo1, { groupId: 'ai-plan-1', groupLabel: 'AI plan' });
        pushUndoEntry(
            'AI step 2',
            () => {
                const right = trackStore.value?.tracks[0]?.clips.find((clip) => clip.startBeat === 4);
                if (right) {
                    removeClip(right.id);
                }
            },
            aiRedo2,
            { groupId: 'ai-plan-1', groupLabel: 'AI plan' }
        );
        handleCutTool(10, 10, 4);

        // Revert the plan (clip lineage gone), then undo the cut: its redo can now
        // never re-apply — the clip it would split no longer exists.
        await revertActionGroup('ai-plan-1');
        await undo();

        // First redo drops the inapplicable cut entry and re-applies AI step 1;
        // second redo re-applies AI step 2. Before the fix the cut entry pinned
        // future[0] and the AI plan behind it could never re-execute.
        await redo();
        expect(aiRedo1).toHaveBeenCalledTimes(1);
        await redo();
        expect(aiRedo2).toHaveBeenCalledTimes(1);

        expect(notifyUser).toHaveBeenCalledWith(
            'Failed to redo split clip - the clip no longer spans the split beat',
            'error'
        );
    });
});

describe('handleCutTool undo/redo on a MIDI clip', () => {
    // Split at beat 4: left note stays, straddling note [3,5) is cut, right note moves.
    const leftNote = { id: 'n-left', pitch: 60, startBeat: 1, duration: 1, velocity: 100 };
    const straddleNote = { id: 'n-straddle', pitch: 64, startBeat: 3, duration: 2, velocity: 90 };
    const rightNote = { id: 'n-right', pitch: 67, startBeat: 5, duration: 1, velocity: 80 };

    function clipIdAtBeat(startBeat: number): string {
        const clip = trackStore.value?.tracks[0]?.clips.find((context) => context.startBeat === startBeat);
        if (!clip) {
            throw new Error(`expected a clip at beat ${startBeat}`);
        }
        return clip.id;
    }

    function rightClipId(): string {
        return clipIdAtBeat(4);
    }

    beforeEach(() => {
        vi.clearAllMocks();
        clearUndoHistory();
        const clip = ClipDummy.create({
            id: 'c1',
            trackId: 't1',
            name: 'Keys',
            startBeat: 0,
            endBeat: 8,
            type: 'midi',
            audioBufferId: undefined,
        });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 't1', kind: 'midi', clips: [clip] })],
            selectedTrackId: null,
        });
        midiStore.set({
            notesByClipId: { c1: [leftNote, straddleNote, rightNote] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        vi.mocked(hitTestClip).mockReturnValue({ clipId: 'c1', trackId: 't1' });
    });

    it('undo reinstates the original notes with their identities, including the straddling note', async () => {
        handleCutTool(10, 10, 4);
        await undo();

        const notes = midiStore.value?.notesByClipId ?? {};
        expect(notes.c1).toEqual([leftNote, straddleNote, rightNote]);
        expect(Object.keys(notes)).toEqual(['c1']);
    });

    it('undo then redo replays the split with note-level identity on both halves', async () => {
        handleCutTool(10, 10, 4);
        const firstRightId = rightClipId();
        const firstRightNotes = midiStore.value?.notesByClipId[firstRightId] ?? [];
        const straddleRightId = firstRightNotes.find((note) => note.startBeat === 4)?.id;
        expect(straddleRightId).toBeDefined();

        await undo();
        await redo();

        const notes = midiStore.value?.notesByClipId ?? {};
        expect(notes.c1).toEqual([leftNote, { ...straddleNote, duration: 1 }]);
        expect(notes[rightClipId()]).toEqual([
            { ...straddleNote, id: straddleRightId, startBeat: 4, duration: 1, probability: 100 },
            rightNote,
        ]);
    });

    it('two stacked cuts on one clip survive undo x2 and redo x2 with no orphaned MIDI data', async () => {
        const farRightNote = { id: 'n-far-right', pitch: 72, startBeat: 7, duration: 1, velocity: 70 };
        midiStore.set({
            notesByClipId: { c1: [leftNote, straddleNote, rightNote, farRightNote] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        // First cut at 4 on c1, second cut at 6 on the resulting right half.
        handleCutTool(10, 10, 4);
        const firstRightId = rightClipId();
        vi.mocked(hitTestClip).mockReturnValue({ clipId: firstRightId, trackId: 't1' });
        handleCutTool(10, 10, 6);
        const secondRightId = clipIdAtBeat(6);

        expect(clipRects()).toEqual([
            { id: 'c1', startBeat: 0, endBeat: 4 },
            { id: firstRightId, startBeat: 4, endBeat: 6 },
            { id: secondRightId, startBeat: 6, endBeat: 8 },
        ]);

        await undo();
        await undo();
        expect(clipRects()).toEqual([{ id: 'c1', startBeat: 0, endBeat: 8 }]);
        expect(midiStore.value?.notesByClipId.c1).toEqual([leftNote, straddleNote, rightNote, farRightNote]);

        await redo();
        await redo();

        // Both cuts re-applied with stable clip ids on the same lineage.
        expect(clipRects()).toEqual([
            { id: 'c1', startBeat: 0, endBeat: 4 },
            { id: firstRightId, startBeat: 4, endBeat: 6 },
            { id: secondRightId, startBeat: 6, endBeat: 8 },
        ]);

        // No notesByClipId key without a live clip, and each clip keeps its notes.
        const notes = midiStore.value?.notesByClipId ?? {};
        const liveIds = new Set(clipRects().map((rect) => rect.id));
        expect(Object.keys(notes).every((key) => liveIds.has(key))).toBe(true);
        expect(notes.c1).toEqual([leftNote, { ...straddleNote, duration: 1 }]);
        expect(notes[firstRightId]).toHaveLength(2);
        expect(notes[secondRightId]).toEqual([farRightNote]);
    });
});
