import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as subject from '../commitInlineMidiNoteDelete';

type Note = { id: string; pitch: number };

const mocks = vi.hoisted(() => ({
    getNotesForClip: vi.fn<(clipId: string) => Note[]>(),
    setNotesForClip: vi.fn<(clipId: string, notes: Note[]) => void>(),
    pushUndoEntry: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    getNotesForClip: mocks.getNotesForClip,
    setNotesForClip: mocks.setNotesForClip,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    pushUndoEntry: mocks.pushUndoEntry,
}));

describe('commitInlineMidiNoteDelete', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('removes only the targeted note from the clip and reports success', () => {
        const notes: Note[] = [
            { id: 'n1', pitch: 60 },
            { id: 'n2', pitch: 62 },
        ];
        mocks.getNotesForClip.mockReturnValue(notes);

        const result = subject.commitInlineMidiNoteDelete({ clipId: 'c1', noteId: 'n2' });

        expect(result).toBe(true);
        expect(mocks.setNotesForClip).toHaveBeenCalledWith('c1', [{ id: 'n1', pitch: 60 }]);
    });

    it('records an undo entry whose redo replays the deletion', () => {
        const notes: Note[] = [
            { id: 'n1', pitch: 60 },
            { id: 'n2', pitch: 62 },
        ];
        mocks.getNotesForClip.mockReturnValue(notes);

        subject.commitInlineMidiNoteDelete({ clipId: 'c1', noteId: 'n2' });

        const [label, undo, redo] = mocks.pushUndoEntry.mock.calls[0] ?? [];
        expect(label).toBe('Delete MIDI note');
        expect(typeof undo).toBe('function');
        expect(typeof redo).toBe('function');
        // Redo must replay the post-delete note set.
        mocks.setNotesForClip.mockClear();
        redo();
        expect(mocks.setNotesForClip).toHaveBeenCalledWith('c1', [{ id: 'n1', pitch: 60 }]);
    });

    it('records an undo entry that restores the original notes', () => {
        const notes: Note[] = [
            { id: 'n1', pitch: 60 },
            { id: 'n2', pitch: 62 },
        ];
        mocks.getNotesForClip.mockReturnValue(notes);

        subject.commitInlineMidiNoteDelete({ clipId: 'c1', noteId: 'n2' });

        const undo = mocks.pushUndoEntry.mock.calls[0]?.[1] as () => void;
        mocks.setNotesForClip.mockClear();
        undo();
        expect(mocks.setNotesForClip).toHaveBeenCalledWith('c1', notes);
    });

    it('aborts with no write when the note id is not present', () => {
        mocks.getNotesForClip.mockReturnValue([{ id: 'n1', pitch: 60 }]);

        const result = subject.commitInlineMidiNoteDelete({ clipId: 'c1', noteId: 'missing' });

        expect(result).toBe(false);
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();
    });
});
