import { describe, it, expect, beforeEach, vi } from 'vitest';
import { copySelectedNotes } from '../copySelectedNotes';
import { midiStore } from '#/modules/MIDI/stores';
import { setNoteClipboard } from '../../../stores/clipboardStore';

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        value: null,
        set: vi.fn(),
    },
}));

vi.mock('../../../stores/clipboardStore', () => ({
    setNoteClipboard: vi.fn(),
}));

describe('copySelectedNotes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes selected notes to the note clipboard', () => {
        midiStore.value = {
            notesByClipId: {
                c1: [
                    { id: 'n1', pitch: 60, velocity: 100, startBeat: 0, duration: 0.25 },
                    { id: 'n2', pitch: 62, velocity: 100, startBeat: 1, duration: 0.25 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        } as never;

        copySelectedNotes('c1', ['n2']);

        expect(setNoteClipboard).toHaveBeenCalledTimes(1);
        const entry = vi.mocked(setNoteClipboard).mock.calls[0]![0] as { notes: { id: string }[] };
        expect(entry.notes).toHaveLength(1);
        expect(entry.notes[0]!.id).toBe('n2');
    });

    it('no-ops when midi state is missing', () => {
        midiStore.value = null as never;

        copySelectedNotes('c1', ['n1']);
        expect(setNoteClipboard).not.toHaveBeenCalled();
    });
});
