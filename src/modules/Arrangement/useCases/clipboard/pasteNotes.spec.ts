import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setNoteClipboard } from '#/modules/Arrangement/stores/clipboardStore';
import { pasteNotes } from './pasteNotes';

describe('pasteNotes', () => {
    beforeEach(() => {
        Container.clear();
        setNoteClipboard(null);
    });

    it('returns early when the note clipboard is empty without calling createMidiNote', () => {
        const createMidiNote = vi.fn();
        injectDependencies(pasteNotes, { createMidiNote });

        pasteNotes('clip-id', 0);

        expect(createMidiNote).not.toHaveBeenCalled();
    });
});
