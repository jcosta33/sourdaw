import { describe, it, expect, vi, beforeEach } from 'vitest';

import { splitMidiNotesAtBeat } from '../splitMidiNotesAtBeat';

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

describe('splitMidiNotesAtBeat', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.midiStoreValue.value = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
    });

    it.each([
        {
            label: 'keeps a note that ends before the split on the source clip',
            note: { id: 'n1', pitch: 60, startBeat: 0, duration: 2, velocity: 100 },
            expectSrc: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 2, velocity: 100 }],
            expectNew: [] as unknown[],
        },
        {
            label: 'moves a note starting at or after the split to the new clip unchanged',
            note: { id: 'n1', pitch: 62, startBeat: 4, duration: 2, velocity: 90 },
            expectSrc: [] as unknown[],
            expectNew: [{ id: 'n1', pitch: 62, startBeat: 4, duration: 2, velocity: 90 }],
        },
    ])('$label', ({ note, expectSrc, expectNew }) => {
        mocks.midiStoreValue.value = { notesByClipId: { src: [note] }, ccByClipId: {}, pitchBendByClipId: {} };

        splitMidiNotesAtBeat({ sourceClipId: 'src', newClipId: 'new', splitBeat: 4 });

        expect(mocks.midiStoreSet).toHaveBeenCalledWith(
            expect.objectContaining({ notesByClipId: { src: expectSrc, new: expectNew } })
        );
    });

    it('cuts a straddling note, appending the fresh right half onto any notes already on the new clip', () => {
        // Note spans [2, 6); split at 4 -> left [2,4) duration 2, right [4,6) duration 2.
        mocks.midiStoreValue.value = {
            notesByClipId: {
                src: [
                    {
                        id: 'n1',
                        pitch: 64,
                        startBeat: 2,
                        duration: 4,
                        velocity: 80,
                        probability: 90,
                        pressure: 0.5,
                        slide: 0.1,
                        pitchBend: 0.2,
                    },
                ],
                new: [{ id: 'existing', pitch: 67, startBeat: 0, duration: 1, velocity: 100 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        splitMidiNotesAtBeat({ sourceClipId: 'src', newClipId: 'new', splitBeat: 4 });

        const [written] = mocks.midiStoreSet.mock.calls[0] as [MidiStoreState];
        expect(written.notesByClipId.src).toEqual([
            expect.objectContaining({ id: 'n1', startBeat: 2, duration: 2, pitch: 64 }),
        ]);
        expect(written.notesByClipId.new).toHaveLength(2);
        expect(written.notesByClipId.new?.[0]).toMatchObject({ id: 'existing' });
        const rightHalf = written.notesByClipId.new?.[1];
        if (!rightHalf) {
            throw new Error('expected a right-half note appended after the existing one');
        }
        expect(rightHalf).toMatchObject({
            pitch: 64,
            startBeat: 4,
            duration: 2,
            velocity: 80,
            probability: 90,
            pressure: 0.5,
            slide: 0.1,
            pitchBend: 0.2,
        });
        // The right half is a fresh note — it must not reuse the source note's id.
        expect(rightHalf.id).not.toBe('n1');
    });

    it('does nothing when the store is unavailable or the source clip has no notes', () => {
        mocks.midiStoreValue.value = null as unknown as MidiStoreState;
        splitMidiNotesAtBeat({ sourceClipId: 'src', newClipId: 'new', splitBeat: 4 });
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();

        mocks.midiStoreValue.value = { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} };
        splitMidiNotesAtBeat({ sourceClipId: 'src', newClipId: 'new', splitBeat: 4 });
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });
});
