import { describe, it, expect, beforeEach, vi } from 'vitest';

import { setNoteClipboard } from '../../../stores/clipboardStore';
import { copySelectedNotes } from '../copySelectedNotes';

const mocks = vi.hoisted(() => {
    type MockNote = { id: string; pitch: number; velocity: number; startBeat: number; duration: number };
    type MockMidiState = {
        notesByClipId: Record<string, MockNote[]>;
        ccByClipId: Record<string, unknown>;
        pitchBendByClipId: Record<string, unknown>;
    };
    return {
        midiStoreValue: { value: null as MockMidiState | null },
    };
});

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
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
        mocks.midiStoreValue.value = {
            notesByClipId: {
                c1: [
                    { id: 'n1', pitch: 60, velocity: 100, startBeat: 0, duration: 0.25 },
                    { id: 'n2', pitch: 62, velocity: 100, startBeat: 1, duration: 0.25 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        copySelectedNotes('c1', ['n2']);

        expect(setNoteClipboard).toHaveBeenCalledTimes(1);
        const entry = vi.mocked(setNoteClipboard).mock.calls[0]![0] as { notes: { id: string }[] };
        expect(entry.notes).toHaveLength(1);
        expect(entry.notes[0]!.id).toBe('n2');
    });

    it('no-ops when midi state is missing', () => {
        mocks.midiStoreValue.value = null;

        copySelectedNotes('c1', ['n1']);
        expect(setNoteClipboard).not.toHaveBeenCalled();
    });
});
