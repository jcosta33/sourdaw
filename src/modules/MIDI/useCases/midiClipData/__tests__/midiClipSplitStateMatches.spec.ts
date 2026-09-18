import { describe, expect, it } from 'vitest';

import { type MidiClipDataActionSnapshot } from '#/utils/handlerContract';

import { type MidiStoreState } from '../../../stores/midiStore';
import { midiClipSplitStateMatches } from '../midiClipSplitStateMatches';

const absent: MidiClipDataActionSnapshot = {
    notes: { present: false, value: [] },
    controlChanges: { present: false, value: [] },
    pitchBends: { present: false, value: [] },
};

function state(notes: MidiStoreState['notesByClipId']): MidiStoreState {
    return {
        probabilitySeed: 1,
        notesByClipId: notes,
        ccByClipId: {},
        pitchBendByClipId: {},
    };
}

describe('midiClipSplitStateMatches', () => {
    it('accepts matching note objects rebuilt with different key insertion order', () => {
        const capturedNote = { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
        const rebuiltNote = { velocity: 100, duration: 1, startBeat: 0, pitch: 60, id: 'note-1' };
        const source: MidiClipDataActionSnapshot = {
            ...absent,
            notes: { present: true, value: [capturedNote] },
        };

        expect(
            midiClipSplitStateMatches(
                {
                    sourceClipId: 'source',
                    rightClipId: 'right',
                    expectedSource: source,
                    expectedRight: absent,
                    replacementSource: source,
                    replacementRight: absent,
                },
                state({ source: [rebuiltNote] })
            )
        ).toBe(true);
    });

    it('rejects changed values, array order, and present-versus-absent clip data', () => {
        const first = { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
        const second = { id: 'note-2', pitch: 64, startBeat: 1, duration: 1, velocity: 100 };
        const source: MidiClipDataActionSnapshot = {
            ...absent,
            notes: { present: true, value: [first, second] },
        };
        const input = {
            sourceClipId: 'source',
            rightClipId: 'right',
            expectedSource: source,
            expectedRight: absent,
            replacementSource: source,
            replacementRight: absent,
        };

        expect(midiClipSplitStateMatches(input, state({ source: [{ ...first, pitch: 61 }, second] }))).toBe(false);
        expect(midiClipSplitStateMatches(input, state({ source: [second, first] }))).toBe(false);
        expect(midiClipSplitStateMatches({ ...input, expectedSource: absent }, state({ source: [] }))).toBe(false);
    });
});
