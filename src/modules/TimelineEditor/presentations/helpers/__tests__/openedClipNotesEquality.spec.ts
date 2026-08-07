import { describe, it, expect } from 'vitest';

import { areOpenedClipNotesEqual } from '../openedClipNotesEquality';

type Note = Record<string, unknown>;

const NOTE: Note = {
    id: 'n1',
    pitch: 60,
    startBeat: 0,
    duration: 1,
    velocity: 100,
    probability: 100,
    pressure: 40,
    slide: 12,
    pitchBend: -2048,
    pitchBendRangeSemitones: 2,
    channel: 1,
};

function record(notes: Note[]): Record<string, Note[]> {
    return { 'clip-2': notes };
}

describe('areOpenedClipNotesEqual', () => {
    it('treats two absent records as equal and an absent-vs-present pair as different', () => {
        expect(areOpenedClipNotesEqual(undefined, undefined)).toBe(true);
        expect(areOpenedClipNotesEqual(undefined, {})).toBe(false);
        expect(areOpenedClipNotesEqual({}, undefined)).toBe(false);
    });

    it('ignores key order in the note objects', () => {
        const authorOrder = { id: 'n1', pitch: 60, startBeat: 1, duration: 1, velocity: 100 };
        const crdtOrder = { duration: 1, id: 'n1', pitch: 60, startBeat: 1, velocity: 100 };

        expect(JSON.stringify(authorOrder)).not.toBe(JSON.stringify(crdtOrder));
        expect(areOpenedClipNotesEqual(record([authorOrder]), record([crdtOrder]))).toBe(true);
    });

    it('ignores key order of the clip ids themselves', () => {
        const a = { 'clip-2': [NOTE], 'clip-3': [] };
        const b = { 'clip-3': [], 'clip-2': [NOTE] };

        expect(areOpenedClipNotesEqual(a, b)).toBe(true);
    });

    it('reports a different clip id set of the same size as different', () => {
        expect(areOpenedClipNotesEqual({ 'clip-2': [NOTE] }, { 'clip-3': [NOTE] })).toBe(false);
    });

    it('reports a different number of open clips as different', () => {
        expect(areOpenedClipNotesEqual({ 'clip-2': [NOTE] }, { 'clip-2': [NOTE], 'clip-3': [] })).toBe(false);
    });

    it('reports an added and a removed note as different', () => {
        const extra = { ...NOTE, id: 'n2' };

        expect(areOpenedClipNotesEqual(record([NOTE]), record([NOTE, extra]))).toBe(false);
        expect(areOpenedClipNotesEqual(record([NOTE, extra]), record([NOTE]))).toBe(false);
    });

    it('keeps checking later clips after one that is identical by reference', () => {
        // The per-clip identity short-circuit must skip that clip, not the rest.
        const shared: Note[] = [NOTE];
        const a = { 'clip-2': shared, 'clip-3': [NOTE] };
        const b = { 'clip-2': shared, 'clip-3': [{ ...NOTE, pitch: 72 }] };

        expect(a['clip-2']).toBe(b['clip-2']);
        expect(areOpenedClipNotesEqual(a, b)).toBe(false);
    });

    it('reports reordered notes within a clip as different', () => {
        const other = { ...NOTE, id: 'n2', pitch: 64 };

        expect(areOpenedClipNotesEqual(record([NOTE, other]), record([other, NOTE]))).toBe(false);
    });

    it.each([
        ['id', 'n-other'],
        ['pitch', 61],
        ['startBeat', 0.25],
        ['duration', 2],
        ['velocity', 99],
        ['probability', 50],
        ['pressure', 41],
        ['slide', 13],
        ['pitchBend', 2048],
        ['pitchBendRangeSemitones', 48],
        ['channel', 2],
    ])('reports a changed %s as different', (field, changed) => {
        expect(areOpenedClipNotesEqual(record([NOTE]), record([{ ...NOTE, [field]: changed }]))).toBe(false);
    });

    it('reports an optional field appearing or disappearing as different', () => {
        const withoutChannel: Note = { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
        const withChannel: Note = { ...withoutChannel, channel: 0 };

        expect(areOpenedClipNotesEqual(record([withoutChannel]), record([withChannel]))).toBe(false);
        expect(areOpenedClipNotesEqual(record([withChannel]), record([withoutChannel]))).toBe(false);
    });

    it('reports a same-size field set with one field swapped for another as different', () => {
        const withPressure: Note = { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100, pressure: 5 };
        const withSlide: Note = { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100, slide: 5 };

        expect(areOpenedClipNotesEqual(record([withPressure]), record([withSlide]))).toBe(false);
    });

    it('reports two notes that differ only in which optional key is explicitly undefined as different', () => {
        // Same key count, same values, different key sets — the store admits an
        // explicitly-undefined optional as an own key, and the key set is what
        // `is_exact_midi_note` checks when the note is spread back in.
        const undefinedChannel: Note = {
            id: 'n1',
            pitch: 60,
            startBeat: 0,
            duration: 1,
            velocity: 100,
            channel: undefined,
        };
        const undefinedPressure: Note = {
            id: 'n1',
            pitch: 60,
            startBeat: 0,
            duration: 1,
            velocity: 100,
            pressure: undefined,
        };

        expect(Object.keys(undefinedChannel)).toHaveLength(Object.keys(undefinedPressure).length);
        expect(areOpenedClipNotesEqual(record([undefinedChannel]), record([undefinedPressure]))).toBe(false);
    });

    it('reports identical content as equal', () => {
        expect(areOpenedClipNotesEqual(record([{ ...NOTE }]), record([{ ...NOTE }]))).toBe(true);
    });
});
