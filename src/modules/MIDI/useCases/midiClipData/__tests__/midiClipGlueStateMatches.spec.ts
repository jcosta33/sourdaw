import { describe, expect, it } from 'vitest';

import { type MidiClipDataActionSnapshot, type MidiClipGlueActionSnapshot } from '#/utils/handlerContract';

import { type MidiStoreState } from '../../../stores/midiStore';
import { midiClipGlueStateMatches } from '../midiClipGlueStateMatches';

function snapshot(note: MidiClipDataActionSnapshot['notes']['value'][number]): MidiClipGlueActionSnapshot {
    return {
        clips: [
            {
                clipId: 'clip-1',
                data: {
                    notes: { present: true, value: [note] },
                    controlChanges: { present: false, value: [] },
                    pitchBends: { present: false, value: [] },
                },
            },
        ],
        migratedAbsoluteNoteClipIds: { present: true, value: ['clip-1'] },
    };
}

function state(note: MidiStoreState['notesByClipId'][string][number]): MidiStoreState {
    return {
        probabilitySeed: 1,
        notesByClipId: { 'clip-1': [note] },
        ccByClipId: {},
        pitchBendByClipId: {},
        migratedAbsoluteNoteClipIds: ['clip-1'],
    };
}

describe('midiClipGlueStateMatches', () => {
    it('accepts matching clip data rebuilt with different object-key insertion order', () => {
        const captured = { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
        const rebuilt = { velocity: 100, duration: 1, startBeat: 0, pitch: 60, id: 'note-1' };
        const expected = snapshot(captured);

        expect(midiClipGlueStateMatches({ expected, replacement: expected }, state(rebuilt))).toBe(true);
    });

    it('rejects a changed note and keeps clip-id and migration-array order strict', () => {
        const note = { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
        const expected = snapshot(note);
        expect(midiClipGlueStateMatches({ expected, replacement: expected }, state({ ...note, pitch: 61 }))).toBe(
            false
        );

        const replacement = {
            ...expected,
            clips: [{ clipId: 'other', data: expected.clips[0]!.data }, expected.clips[0]!],
        };
        expect(midiClipGlueStateMatches({ expected, replacement }, state(note))).toBe(false);

        const otherNote = { ...note, id: 'note-2' };
        const expectedWithOrder = {
            ...expected,
            clips: [
                ...expected.clips,
                {
                    clipId: 'other',
                    data: snapshot(otherNote).clips[0]!.data,
                },
            ],
            migratedAbsoluteNoteClipIds: { present: true, value: ['clip-1', 'other'] },
        };
        const migratedOutOfOrder = state(note);
        migratedOutOfOrder.notesByClipId.other = [otherNote];
        migratedOutOfOrder.migratedAbsoluteNoteClipIds = ['other', 'clip-1'];
        expect(
            midiClipGlueStateMatches(
                { expected: expectedWithOrder, replacement: expectedWithOrder },
                migratedOutOfOrder
            )
        ).toBe(false);
    });
});
