import { describe, it, expect, vi, beforeEach } from 'vitest';

import { shiftMidiNotesAfterBeat } from '../shiftMidiNotesAfterBeat';

const mocks = vi.hoisted(() => {
    const trackStoreValue: { current: unknown } = { current: null };
    return {
        midiStoreValue: {
            value: null as {
                notesByClipId: Record<string, unknown[]>;
                ccByClipId: Record<string, unknown[]>;
                pitchBendByClipId: Record<string, unknown[]>;
            } | null,
        },
        midiStoreSet: vi.fn(),
        trackStoreValue,
    };
});

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
        set: mocks.midiStoreSet,
    },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.current;
        },
    },
}));

describe('shiftMidiNotesAfterBeat', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.midiStoreValue.value = {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        // Clip `moved` starts after atBeat (insertTime moves its rectangle,
        // so its clip-relative notes must NOT shift). Clip `straddler`
        // spans atBeat, so only notes at/after the window move.
        mocks.trackStoreValue.current = {
            tracks: [
                {
                    id: 'track-1',
                    clips: [
                        { id: 'moved', type: 'midi', startBeat: 16, endBeat: 24 },
                        { id: 'straddler', type: 'midi', startBeat: 4, endBeat: 16 },
                    ],
                },
            ],
        };
    });

    /// Regression (M-141): the shift window was timeline-absolute while
    /// notes are clip-relative — insertTime moved clips after atBeat AND
    /// shifted their notes (double shift), and straddled clips shifted the
    /// wrong notes.
    it('leaves notes of moved clips untouched and shifts only straddler notes past the window', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: {
                moved: [{ pitch: 60, startBeat: 10, duration: 1 }],
                straddler: [
                    { pitch: 62, startBeat: 2, duration: 1 }, // absolute 6 — before the window
                    { pitch: 64, startBeat: 6, duration: 1 }, // absolute 10 — inside the window
                ],
            },
            ccByClipId: {
                straddler: [{ beat: 6, controller: 1, value: 100 }],
            },
            pitchBendByClipId: {},
        };

        // insertTime(atBeat 8, 4): `moved` rectangle goes to [20, 28), its
        // note must stay relative 10 (still plays at 30, not 34).
        shiftMidiNotesAfterBeat({ atBeat: 8, delta: 4 });

        expect(mocks.midiStoreSet).toHaveBeenCalledTimes(1);
        const written = mocks.midiStoreSet.mock.calls[0]![0] as {
            notesByClipId: Record<string, Array<{ pitch: number; startBeat: number }>>;
            ccByClipId: Record<string, Array<{ beat: number }>>;
        };
        expect(written.notesByClipId.moved).toEqual([{ pitch: 60, startBeat: 10, duration: 1 }]);
        expect(written.notesByClipId.straddler).toEqual([
            { pitch: 62, startBeat: 2, duration: 1 },
            { pitch: 64, startBeat: 10, duration: 1 },
        ]);
        expect(written.ccByClipId.straddler).toEqual([{ beat: 10, controller: 1, value: 100 }]);
    });

    it('does not write when every clip starts after the window', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: { moved: [{ pitch: 60, startBeat: 10, duration: 1 }] },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        mocks.trackStoreValue.current = {
            tracks: [{ id: 'track-1', clips: [{ id: 'moved', type: 'midi', startBeat: 16, endBeat: 24 }] }],
        };

        shiftMidiNotesAfterBeat({ atBeat: 8, delta: 4 });

        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });

    it('returns immediately when delta is 0 (no-op)', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: { straddler: [{ pitch: 60, startBeat: 6, duration: 1 }] },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        shiftMidiNotesAfterBeat({ atBeat: 8, delta: 0 });
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });

    it('returns immediately when the midi store has no state', () => {
        mocks.midiStoreValue.value = null;
        shiftMidiNotesAfterBeat({ atBeat: 8, delta: 4 });
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });

    it('shifts pitch-bend events inside a straddling clip', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {
                straddler: [
                    { beat: 6, value: 0.5 },
                    { beat: 2, value: 0.1 },
                ],
            },
        };
        shiftMidiNotesAfterBeat({ atBeat: 8, delta: 4 });
        const written = mocks.midiStoreSet.mock.calls[0]![0] as {
            pitchBendByClipId: Record<string, Array<{ beat: number; value: number }>>;
        };
        // windowStartMedia = 8 - 4 = 4; beat 6 >= 4 → shifts to 10; beat 2 < 4 → stays
        expect(written.pitchBendByClipId.straddler).toEqual([
            { beat: 10, value: 0.5 },
            { beat: 2, value: 0.1 },
        ]);
    });

    it('leaves clips entirely before the window untouched (clip.endBeat <= atBeat)', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: {
                before: [{ pitch: 60, startBeat: 1, duration: 1 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        mocks.trackStoreValue.current = {
            tracks: [{ id: 't', clips: [{ id: 'before', type: 'midi', startBeat: 0, endBeat: 4 }] }],
        };
        shiftMidiNotesAfterBeat({ atBeat: 8, delta: 4 });
        // clip ends at 4 ≤ 8 → not a straddler → no shift, no write (nothing changed)
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });

    it('does not write when a straddling clip has no events past the window', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: {
                straddler: [{ pitch: 60, startBeat: 1, duration: 1 }], // before windowStartMedia(4)
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        shiftMidiNotesAfterBeat({ atBeat: 8, delta: 4 });
        // straddler spans the window but its only note is before it → changed stays false
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });

    it('accounts for midiOffsetBeats when computing the window start', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: {
                straddler: [{ pitch: 60, startBeat: 5, duration: 1 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        mocks.trackStoreValue.current = {
            tracks: [
                {
                    id: 't',
                    clips: [{ id: 'straddler', type: 'midi', startBeat: 4, endBeat: 16, midiOffsetBeats: 2 }],
                },
            ],
        };
        shiftMidiNotesAfterBeat({ atBeat: 8, delta: 4 });
        // windowStartMedia = 8 - 4 + 2(offset) = 6. Note at 5 < 6 → NOT shifted.
        // Without the offset the window would be 4 and the note (5≥4) WOULD shift.
        // No write happens because changed stayed false.
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });
});
