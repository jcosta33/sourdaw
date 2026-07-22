import { describe, it, expect, vi, beforeEach } from 'vitest';

import { splitMidiNotesAtBeat } from '../splitMidiNotesAtBeat';

const mocks = vi.hoisted(() => ({
    midiStoreValue: { value: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} } },
    midiStoreSet: vi.fn(),
}));

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
        set: mocks.midiStoreSet,
    },
}));

type StoredNote = {
    id?: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};

function note(pitch: number, startBeat: number, duration: number, id?: string): StoredNote {
    return { id, pitch, startBeat, duration, velocity: 100 };
}

describe('splitMidiNotesAtBeat', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.midiStoreValue.value = {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        };
    });

    /// Regression (M-140): notes are stored clip-relative (playback =
    /// clip.startBeat + note.startBeat - midiOffsetBeats), so the split
    /// point arrives in clip media beats and right-side notes must be
    /// re-based onto the right clip — keeping media beats displaced them by
    /// the split offset or dropped them from playback entirely.
    it('re-bases right-side and straddler notes onto the right clip', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: {
                source: [note(60, 1, 1, 'left'), note(64, 6, 1, 'right'), note(67, 3, 4, 'straddler')],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        // Clip [0, 8) split at media beat 4 (caller converts the
        // timeline-absolute split before invoking).
        splitMidiNotesAtBeat({ sourceClipId: 'source', newClipId: 'right', splitBeat: 4 });

        expect(mocks.midiStoreSet).toHaveBeenCalledTimes(1);
        const written = mocks.midiStoreSet.mock.calls[0]![0] as {
            notesByClipId: Record<string, StoredNote[]>;
        };
        const left = written.notesByClipId['source']!;
        const right = written.notesByClipId['right']!;

        // Left: untouched note + trimmed straddler half.
        expect(left).toHaveLength(2);
        expect(left[0]).toMatchObject({ id: 'left', startBeat: 1, duration: 1 });
        expect(left[1]).toMatchObject({ id: 'straddler', startBeat: 3, duration: 1 });

        // Right (source order): the fully-right note re-bases from 6 to 2
        // so it still plays at absolute beat 6 on a right clip starting at
        // 4; the straddler right half starts at 0 (right clip start).
        expect(right).toHaveLength(2);
        expect(right[0]).toMatchObject({ id: 'right', startBeat: 2, duration: 1 });
        expect(right[1]).toMatchObject({ startBeat: 0, duration: 3, pitch: 67 });
    });

    it('keeps notes on the source clip when nothing crosses the split', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: { source: [note(60, 0, 2, 'a'), note(62, 2, 1, 'b')] },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        splitMidiNotesAtBeat({ sourceClipId: 'source', newClipId: 'right', splitBeat: 6 });

        const written = mocks.midiStoreSet.mock.calls[0]![0] as {
            notesByClipId: Record<string, StoredNote[]>;
        };
        expect(written.notesByClipId['source']).toHaveLength(2);
        expect(written.notesByClipId['right']).toHaveLength(0);
    });
});
