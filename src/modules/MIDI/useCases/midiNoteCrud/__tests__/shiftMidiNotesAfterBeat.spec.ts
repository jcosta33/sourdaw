import { describe, it, expect, vi, beforeEach } from 'vitest';

import { shiftMidiNotesAfterBeat } from '../shiftMidiNotesAfterBeat';

import type { MidiStoreState } from '../../../stores/midiStore';

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

describe('shiftMidiNotesAfterBeat', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.midiStoreValue.value = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
    });

    it('shifts notes, CCs, and pitch bends at or after the window open, leaving earlier ones untouched', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: {
                c1: [
                    { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                    { id: 'n2', pitch: 62, startBeat: 8, duration: 1, velocity: 100 },
                ],
            },
            ccByClipId: { c1: [{ id: 'cc1', controller: 1, value: 64, beat: 8, channel: 0 }] },
            pitchBendByClipId: { c1: [{ id: 'pb1', value: 0.5, beat: 8, channel: 0 }] },
        };

        shiftMidiNotesAfterBeat({ atBeat: 8, delta: 4 });

        const [written] = mocks.midiStoreSet.mock.calls[0] as [MidiStoreState];
        expect(written.notesByClipId.c1).toEqual([
            { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
            { id: 'n2', pitch: 62, startBeat: 12, duration: 1, velocity: 100 },
        ]);
        expect(written.ccByClipId.c1).toEqual([{ id: 'cc1', controller: 1, value: 64, beat: 12, channel: 0 }]);
        expect(written.pitchBendByClipId.c1).toEqual([{ id: 'pb1', value: 0.5, beat: 12, channel: 0 }]);
    });

    it('shifts notes exactly at atBeat (inclusive boundary)', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: { c1: [{ id: 'n1', pitch: 60, startBeat: 4, duration: 1, velocity: 100 }] },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        shiftMidiNotesAfterBeat({ atBeat: 4, delta: -2 });

        const [written] = mocks.midiStoreSet.mock.calls[0] as [MidiStoreState];
        expect(written.notesByClipId.c1).toEqual([{ id: 'n1', pitch: 60, startBeat: 2, duration: 1, velocity: 100 }]);
    });

    it('applies the shift across every clip in the store, not just one', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: {
                c1: [{ id: 'n1', pitch: 60, startBeat: 8, duration: 1, velocity: 100 }],
                c2: [{ id: 'n2', pitch: 61, startBeat: 8, duration: 1, velocity: 100 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        shiftMidiNotesAfterBeat({ atBeat: 0, delta: 1 });

        const [written] = mocks.midiStoreSet.mock.calls[0] as [MidiStoreState];
        expect(written.notesByClipId.c1?.[0]?.startBeat).toBe(9);
        expect(written.notesByClipId.c2?.[0]?.startBeat).toBe(9);
    });

    it('is a no-op when delta is zero, and does nothing when the store is unavailable', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: { c1: [{ id: 'n1', pitch: 60, startBeat: 8, duration: 1, velocity: 100 }] },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        shiftMidiNotesAfterBeat({ atBeat: 0, delta: 0 });
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();

        mocks.midiStoreValue.value = null as unknown as MidiStoreState;
        shiftMidiNotesAfterBeat({ atBeat: 0, delta: 4 });
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });
});
