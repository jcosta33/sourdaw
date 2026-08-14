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
    probability?: number;
    channel?: number;
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
                source: [
                    note(60, 1, 1, 'left'),
                    note(64, 6, 1, 'right'),
                    { id: 'straddler', pitch: 67, startBeat: 3, duration: 4, velocity: 100, channel: 5 },
                ],
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
        const left = written.notesByClipId.source!;
        const right = written.notesByClipId.right!;

        // Left: untouched note + trimmed straddler half.
        expect(left).toHaveLength(2);
        expect(left[0]).toMatchObject({ id: 'left', startBeat: 1, duration: 1 });
        expect(left[1]).toMatchObject({ id: 'straddler', startBeat: 3, duration: 1 });

        // Right (source order): the fully-right note re-bases from 6 to 2
        // so it still plays at absolute beat 6 on a right clip starting at
        // 4; the straddler right half starts at 0 (right clip start).
        expect(right).toHaveLength(2);
        expect(right[0]).toMatchObject({ id: 'right', startBeat: 2, duration: 1 });
        expect(right[1]).toMatchObject({ startBeat: 0, duration: 3, pitch: 67, probability: 100 });
        // The right half is rebuilt field by field, so per-note MPE routing
        // has to be named explicitly or the split silently moves the half to
        // channel 0 (issue #1832 F8).
        expect(right[1]?.channel).toBe(5);
    });

    /// Regression (PR #608 review): range deletion (deleteTimeRange) must
    /// drop the notes inside the deleted media window — feeding only the
    /// hole-start beat resurrected hole notes on the right clip and pushed
    /// post-hole notes out of their clip.
    it('discards notes inside the deleted window and re-bases post-window notes onto the right clip', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: {
                source: [
                    note(60, 1, 1, 'left'),
                    note(62, 2, 3, 'hole-start-straddler'), // [2,5) — trim to [2,3)
                    note(64, 4, 1, 'hole-note'), // [4,5) — deleted
                    note(65, 1.5, 7, 'hole-spanner'), // [1.5,8.5) — stubs on both sides
                    note(67, 8, 1, 'post'), // [8,9) — re-base to 1
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        // Clip [0, 10), deleted media window [3, 7).
        splitMidiNotesAtBeat({ sourceClipId: 'source', newClipId: 'right', splitBeat: 7, discardBeforeBeat: 3 });

        const written = mocks.midiStoreSet.mock.calls[0]![0] as {
            notesByClipId: Record<string, StoredNote[]>;
        };
        const left = written.notesByClipId.source!;
        const right = written.notesByClipId.right!;

        expect(left).toEqual([
            note(60, 1, 1, 'left'),
            note(62, 2, 1, 'hole-start-straddler'),
            note(65, 1.5, 1.5, 'hole-spanner'),
        ]);
        // Hole note is gone entirely; survivors on the right clip start at
        // the hole end (media 7 -> 0).
        expect(right).toHaveLength(2);
        expect(right[0]).toMatchObject({ startBeat: 0, duration: 1.5, pitch: 65 });
        expect(right[1]).toMatchObject({ id: 'post', startBeat: 1, duration: 1 });
        expect(right.some((entry) => entry.id === 'hole-note')).toBe(false);
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
        expect(written.notesByClipId.source).toHaveLength(2);
        expect(written.notesByClipId.right).toHaveLength(0);
    });
});
