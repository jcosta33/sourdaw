import { describe, it, expect, vi, beforeEach } from 'vitest';

import { shiftMidiNotesAfterBeat } from '../shiftMidiNotesAfterBeat';

const mocks = vi.hoisted(() => ({
    midiStoreValue: { value: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} } },
    midiStoreSet: vi.fn(),
    trackStoreValue: { current: null as unknown },
}));

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
        expect(written.notesByClipId['moved']).toEqual([{ pitch: 60, startBeat: 10, duration: 1 }]);
        expect(written.notesByClipId['straddler']).toEqual([
            { pitch: 62, startBeat: 2, duration: 1 },
            { pitch: 64, startBeat: 10, duration: 1 },
        ]);
        expect(written.ccByClipId['straddler']).toEqual([{ beat: 10, controller: 1, value: 100 }]);
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
});
