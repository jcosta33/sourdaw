import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commitInlineMidiNoteCreate } from '../commitInlineMidiNoteCreate';
import { commitInlineMidiNoteDelete } from '../commitInlineMidiNoteDelete';
import { commitInlineMidiNoteMove } from '../commitInlineMidiNoteMove';

type Note = { id: string; pitch: number; startBeat: number; duration: number; velocity: number };
type StubTrack = { id: string; frozen: boolean; clips: Array<{ id: string }> };

const mocks = vi.hoisted(() => ({
    notesByClipId: new Map<string, Note[]>(),
    tracks: [] as StubTrack[],
    notifyUser: vi.fn(),
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    getNotesForClip: (clipId: string): Note[] => mocks.notesByClipId.get(clipId) ?? [],
    setNotesForClip: (clipId: string, notes: Note[]): void => {
        mocks.notesByClipId.set(clipId, notes);
    },
    addMidiNote: (clipId: string, pitch: number, startBeat: number, duration: number, velocity: number): void => {
        const existing = mocks.notesByClipId.get(clipId) ?? [];
        mocks.notesByClipId.set(clipId, [
            ...existing,
            { id: `note-${existing.length + 1}`, pitch, startBeat, duration, velocity },
        ]);
    },
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    pushUndoEntry: mocks.pushUndoEntry,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return { tracks: mocks.tracks };
        },
    },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

const ORIGINAL_NOTES: Note[] = [
    { id: 'n1', pitch: 60, startBeat: 1, duration: 0.5, velocity: 100 },
    { id: 'n2', pitch: 64, startBeat: 2, duration: 0.5, velocity: 100 },
];

function seedClip(frozen: boolean): void {
    mocks.tracks = [{ id: 'track-1', frozen, clips: [{ id: 'clip-1' }] }];
    mocks.notesByClipId = new Map([['clip-1', ORIGINAL_NOTES]]);
}

describe('inline MIDI note commits on a frozen track', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('when the track is frozen', () => {
        beforeEach(() => {
            seedClip(true);
        });

        it('refuses to create a note, leaves the notes unchanged and warns the user', () => {
            const committed = commitInlineMidiNoteCreate({
                clipId: 'clip-1',
                pitch: 67,
                startBeat: 3,
                duration: 0.5,
                velocity: 100,
            });

            expect(committed).toBe(false);
            expect(mocks.notesByClipId.get('clip-1')).toEqual(ORIGINAL_NOTES);
            expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
            expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
            expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('frozen'), 'warning');
        });

        it('refuses to move a note, leaves the notes unchanged and warns the user', () => {
            const committed = commitInlineMidiNoteMove({ clipId: 'clip-1', noteId: 'n1', pitch: 72, startBeat: 4 });

            expect(committed).toBe(false);
            expect(mocks.notesByClipId.get('clip-1')).toEqual(ORIGINAL_NOTES);
            expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
            expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
            expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('frozen'), 'warning');
        });

        it('refuses to delete a note, leaves the notes unchanged and warns the user', () => {
            const committed = commitInlineMidiNoteDelete({ clipId: 'clip-1', noteId: 'n1' });

            expect(committed).toBe(false);
            expect(mocks.notesByClipId.get('clip-1')).toEqual(ORIGINAL_NOTES);
            expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
            expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
            expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('frozen'), 'warning');
        });
    });

    describe('when a frozen track sits beside an unfrozen track', () => {
        const CLIP_2_NOTES: Note[] = [{ id: 'm1', pitch: 55, startBeat: 0, duration: 0.5, velocity: 100 }];

        beforeEach(() => {
            mocks.tracks = [
                { id: 'track-1', frozen: true, clips: [{ id: 'clip-1' }] },
                { id: 'track-2', frozen: false, clips: [{ id: 'clip-2' }] },
            ];
            mocks.notesByClipId = new Map([
                ['clip-1', ORIGINAL_NOTES],
                ['clip-2', CLIP_2_NOTES],
            ]);
        });

        it('creates, moves and deletes notes on the unfrozen clip without warning', () => {
            const created = commitInlineMidiNoteCreate({
                clipId: 'clip-2',
                pitch: 67,
                startBeat: 3,
                duration: 0.5,
                velocity: 100,
            });
            expect(created).toBe(true);
            expect(mocks.notesByClipId.get('clip-2')).toHaveLength(2);

            const moved = commitInlineMidiNoteMove({ clipId: 'clip-2', noteId: 'm1', pitch: 72, startBeat: 4 });
            expect(moved).toBe(true);
            expect(mocks.notesByClipId.get('clip-2')?.[0]).toMatchObject({ id: 'm1', pitch: 72, startBeat: 4 });

            const deleted = commitInlineMidiNoteDelete({ clipId: 'clip-2', noteId: 'm1' });
            expect(deleted).toBe(true);
            expect(mocks.notesByClipId.get('clip-2')).toHaveLength(1);

            expect(mocks.notifyUser).not.toHaveBeenCalled();
            expect(mocks.notesByClipId.get('clip-1')).toEqual(ORIGINAL_NOTES);
        });
    });

    describe('a move to the same position on a frozen track', () => {
        it('is a silent no-op without a warning', () => {
            seedClip(true);

            const committed = commitInlineMidiNoteMove({ clipId: 'clip-1', noteId: 'n1', pitch: 60, startBeat: 1 });

            expect(committed).toBe(false);
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        });
    });

    describe('when the track is not frozen', () => {
        beforeEach(() => {
            seedClip(false);
        });

        it('still creates a note without warning', () => {
            const committed = commitInlineMidiNoteCreate({
                clipId: 'clip-1',
                pitch: 67,
                startBeat: 3,
                duration: 0.5,
                velocity: 100,
            });

            expect(committed).toBe(true);
            expect(mocks.notesByClipId.get('clip-1')).toHaveLength(3);
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        });

        it('still moves a note without warning', () => {
            const committed = commitInlineMidiNoteMove({ clipId: 'clip-1', noteId: 'n1', pitch: 72, startBeat: 4 });

            expect(committed).toBe(true);
            expect(mocks.notesByClipId.get('clip-1')?.[0]).toMatchObject({ id: 'n1', pitch: 72, startBeat: 4 });
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        });

        it('still deletes a note without warning', () => {
            const committed = commitInlineMidiNoteDelete({ clipId: 'clip-1', noteId: 'n1' });

            expect(committed).toBe(true);
            expect(mocks.notesByClipId.get('clip-1')).toEqual([ORIGINAL_NOTES[1]]);
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        });
    });
});
