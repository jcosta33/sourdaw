import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearUndoHistory, redo, undo } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { hitTestClip } from '../../../useCases/timelineInteractions/hitTestClip/hitTestClip';
import { handleCutTool } from '../timelineTools';

// Pixel hit-testing is a rendering concern; everything downstream of the cut —
// splitClip, the undo composition, and the Command undo/redo stack — runs for
// real so the undo contract is pinned end to end.
vi.mock('../../../useCases/timelineInteractions/hitTestClip/hitTestClip', () => ({ hitTestClip: vi.fn() }));

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

describe('handleCutTool undo/redo on a MIDI clip', () => {
    // Split at beat 4: left note stays, straddling note [3,5) is cut, right note moves.
    const leftNote = { id: 'n-left', pitch: 60, startBeat: 1, duration: 1, velocity: 100 };
    const straddleNote = { id: 'n-straddle', pitch: 64, startBeat: 3, duration: 2, velocity: 90 };
    const rightNote = { id: 'n-right', pitch: 67, startBeat: 5, duration: 1, velocity: 80 };

    function rightClipId(): string {
        const state = trackStore.value;
        const right = state?.tracks[0]?.clips.find((clip) => clip.startBeat === 4);
        if (!right) {
            throw new Error('expected a right clip at beat 4');
        }
        return right.id;
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
});
