import { describe, expect, it, vi, beforeEach } from 'vitest';

import { commitInlineMidiNoteMove } from '../commitInlineMidiNoteMove';

const mocks = vi.hoisted(() => ({
    getNotesForClip: vi.fn(),
    pushUndoEntry: vi.fn(),
    setNotesForClip: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    getNotesForClip: mocks.getNotesForClip,
    setNotesForClip: mocks.setNotesForClip,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    pushUndoEntry: mocks.pushUndoEntry,
}));

describe('commitInlineMidiNoteMove', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should commit one MIDI note move with a coalesced undo entry', () => {
        const originalNotes = [
            { id: 'note-1', pitch: 60, startBeat: 1, duration: 0.5, velocity: 100 },
            { id: 'note-2', pitch: 64, startBeat: 2, duration: 0.5, velocity: 100 },
        ];
        mocks.getNotesForClip.mockReturnValue(originalNotes);

        const committed = commitInlineMidiNoteMove({
            clipId: 'clip-1',
            noteId: 'note-1',
            pitch: 72,
            startBeat: 4,
        });

        expect(committed).toBe(true);
        expect(mocks.setNotesForClip).toHaveBeenCalledTimes(1);
        expect(mocks.setNotesForClip).toHaveBeenCalledWith('clip-1', [
            { id: 'note-1', pitch: 72, startBeat: 4, duration: 0.5, velocity: 100 },
            originalNotes[1],
        ]);
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
        const pushCall = mocks.pushUndoEntry.mock.calls[0];
        if (!pushCall) {
            throw new Error('expected pushUndoEntry to have been called');
        }
        expect(pushCall[0]).toBe('Move MIDI note');

        const undo = pushCall[1];
        const redo = pushCall[2];
        undo();
        redo();

        expect(mocks.setNotesForClip).toHaveBeenNthCalledWith(2, 'clip-1', originalNotes);
        expect(mocks.setNotesForClip).toHaveBeenNthCalledWith(3, 'clip-1', [
            { id: 'note-1', pitch: 72, startBeat: 4, duration: 0.5, velocity: 100 },
            originalNotes[1],
        ]);
    });

    it('should not write history when the note did not move', () => {
        mocks.getNotesForClip.mockReturnValue([
            { id: 'note-1', pitch: 60, startBeat: 1, duration: 0.5, velocity: 100 },
        ]);

        const committed = commitInlineMidiNoteMove({
            clipId: 'clip-1',
            noteId: 'note-1',
            pitch: 60,
            startBeat: 1,
        });

        expect(committed).toBe(false);
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });

    it('rejects a note id that does not exist in the clip before any write', () => {
        mocks.getNotesForClip.mockReturnValue([
            { id: 'note-1', pitch: 60, startBeat: 1, duration: 0.5, velocity: 100 },
        ]);

        const committed = commitInlineMidiNoteMove({
            clipId: 'clip-1',
            noteId: 'missing-note',
            pitch: 72,
            startBeat: 4,
        });

        expect(committed).toBe(false);
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });
});
