import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { pasteNotes } from '#/modules/Arrangement/useCases';
import { undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, redo, undo } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { appendMidiNotes, getNotesForClip } from '#/modules/MIDI/useCases';

import { PianoRollContextMenu } from '../PianoRollContextMenu';

// Issue #3664. The context menu's Cut and Delete used to undo by rebuilding
// notes through `addMidiNote` — a stripped 4-field copy under a fresh id — and
// redo by removing the original (now stale) id, so cycles left duplicated
// notes and dropped every optional performance field. These specs run the real
// menu handlers against the real MIDI store and the real undo stack, pinning
// that a removed note comes back as the exact object it was.

vi.mock('#/components/daw/DawContextMenuSurface', () => ({
    DawContextMenuSurface: ({
        children,
        ref,
    }: {
        children: React.ReactNode;
        ref?: React.RefObject<HTMLDivElement>;
    }) => <div ref={ref}>{children}</div>,
}));

vi.mock('#/components/daw/DawMenuParts', () => ({
    DawMenuButton: ({
        children,
        onClick,
        disabled,
        role,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        disabled?: boolean;
        role?: string;
    }) => (
        <button type="button" onClick={onClick} disabled={disabled} role={role}>
            {children}
        </button>
    ),
    DawMenuSectionLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DawMenuSeparator: () => <hr />,
}));

vi.mock('#/utils/UI/useContextMenuDismiss', () => ({
    useContextMenuDismiss: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    copyPianoRollNotes: vi.fn(),
    getCopiedPianoRollNotes: vi.fn(),
    copySelectedNotes: vi.fn(),
    pasteNotes: vi.fn(),
}));

const selectedNote = {
    id: 'n1',
    pitch: 60,
    startBeat: 2,
    duration: 2,
    velocity: 80,
    probability: 35,
    pressure: 0.75,
    slide: -0.4,
    pitchBend: 1024,
    pitchBendRangeSemitones: 12,
    channel: 3,
    articulation: 'staccato',
};

const keptNote = { ...selectedNote, id: 'n2', pitch: 67, startBeat: 5, velocity: 100 };

const seedStore = (): void => {
    midiStore.set({
        probabilitySeed: 12345,
        notesByClipId: { 'clip-1': [selectedNote, keptNote] },
        ccByClipId: {},
        pitchBendByClipId: {},
    });
};

const renderMenu = (): { remove: () => void } => {
    const { unmount } = render(
        <TooltipProvider>
            <PianoRollContextMenu
                menu={{ x: 100, y: 100, beat: 4 }}
                clipId="clip-1"
                notes={[selectedNote, keptNote]}
                selectedNoteIds={new Set(['n1'])}
                onClose={vi.fn()}
                onSelectAll={vi.fn()}
                onClearSelection={vi.fn()}
            />
        </TooltipProvider>
    );
    return { remove: unmount };
};

describe('PianoRollContextMenu Cut/Delete undo preserves note identity (issue #3664)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearUndoHistory();
        seedStore();
    });

    it('Cut restores the exact removed note with all expression fields on undo', async () => {
        renderMenu();

        fireEvent.click(screen.getByText('Cut'));
        expect(getNotesForClip('clip-1')).toEqual([keptNote]);

        await undo();
        expect(getNotesForClip('clip-1')).toEqual([selectedNote, keptNote]);

        await redo();
        expect(getNotesForClip('clip-1')).toEqual([keptNote]);
    });

    it('Delete Selected restores the exact removed note with all expression fields on undo', async () => {
        renderMenu();

        fireEvent.click(screen.getByText('Delete Selected'));
        expect(getNotesForClip('clip-1')).toEqual([keptNote]);

        await undo();
        expect(getNotesForClip('clip-1')).toEqual([selectedNote, keptNote]);

        await redo();
        expect(getNotesForClip('clip-1')).toEqual([keptNote]);
    });

    it('repeated Cut/undo/redo cycles accumulate no duplicate notes', async () => {
        renderMenu();

        fireEvent.click(screen.getByText('Cut'));
        expect(getNotesForClip('clip-1')).toEqual([keptNote]);

        for (let cycle = 0; cycle < 3; cycle++) {
            await undo();
            expect(getNotesForClip('clip-1')).toEqual([selectedNote, keptNote]);
            await redo();
            expect(getNotesForClip('clip-1')).toEqual([keptNote]);
        }
    });
});

describe('PianoRollContextMenu Paste records one undo entry', () => {
    // Stands in for the note clipboard: appends the copied notes under fresh
    // ids at the menu beat, as the real `pasteNotes` does through
    // `appendMidiNotes`, so the menu sees a real store change either way.
    const stageClipboard = (clipboard: (typeof selectedNote)[]): void => {
        vi.mocked(pasteNotes).mockImplementation((clipId, beatOffset) => {
            appendMidiNotes({
                clipId,
                notes: clipboard.map(({ id: _id, ...node }) => ({ ...node, startBeat: beatOffset })),
            });
        });
    };

    beforeEach(() => {
        vi.clearAllMocks();
        clearUndoHistory();
        seedStore();
    });

    it('undoes and redoes a menu Paste as one entry that keeps every expression field', async () => {
        stageClipboard([selectedNote]);
        renderMenu();
        const notesBefore = getNotesForClip('clip-1').map((node) => ({ ...node }));

        fireEvent.click(screen.getByText('Paste'));

        const notesAfter = getNotesForClip('clip-1').map((node) => ({ ...node }));
        expect(notesAfter).toHaveLength(3);
        expect(notesAfter.slice(0, 2)).toEqual(notesBefore);
        expect(notesAfter[2]).toMatchObject({ ...selectedNote, id: expect.stringMatching(/^note-/), startBeat: 4 });
        expect(undoStore.value?.past.map((entry) => entry.label)).toEqual(['Paste 1 note']);

        await undo();
        expect(getNotesForClip('clip-1')).toEqual(notesBefore);

        await redo();
        expect(getNotesForClip('clip-1')).toEqual(notesAfter);
    });

    it('labels a multi-note Paste in the plural', () => {
        stageClipboard([selectedNote, keptNote]);
        renderMenu();

        fireEvent.click(screen.getByText('Paste'));

        expect(undoStore.value?.past.map((entry) => entry.label)).toEqual(['Paste 2 notes']);
    });

    it('records no undo entry when the clipboard is empty', () => {
        stageClipboard([]);
        renderMenu();

        fireEvent.click(screen.getByText('Paste'));

        expect(getNotesForClip('clip-1')).toEqual([selectedNote, keptNote]);
        expect(undoStore.value?.past ?? []).toEqual([]);
    });
});
