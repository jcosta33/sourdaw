import { describe, it, expect, beforeEach } from 'vitest';

import { isValidMidiNoteExpression } from '../../../models/MidiNote';
import { midiStore } from '../../../stores/midiStore';
import { joinNotes } from '../joinNotes';

function note(id: string, pitch: number, startBeat: number, duration: number) {
    return {
        id,
        pitch,
        startBeat,
        duration,
        velocity: 100,
    };
}

describe('joinNotes', () => {
    beforeEach(() => {
        midiStore.set({
            notesByClipId: {
                clip1: [
                    note('a', 60, 0, 1),
                    note('b', 60, 1, 1),
                    note('c', 60, 3, 1), // gap
                    note('d', 64, 0, 1), // different pitch
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('should merge adjacent same-pitch selected notes', () => {
        joinNotes('clip1', ['a', 'b']);
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(3);
        const joined = notes?.find((node) => node.startBeat === 0 && node.pitch === 60);
        expect(joined?.duration).toBe(2);
        expect(notes?.find((node) => node.id === 'c')).toBeDefined();
        expect(notes?.find((node) => node.id === 'd')).toBeDefined();
    });

    it('retains each joined note expression at its performed position and bend depth', () => {
        midiStore.set({
            notesByClipId: {
                clip1: [
                    {
                        ...note('a', 60, 0, 1),
                        velocity: 54,
                        pressure: 10,
                        slide: 12,
                        pitchBend: 4096,
                        pitchBendRangeSemitones: 12,
                        expression: {
                            pressure: [{ offsetBeats: 0.5, value: 20 }],
                            slide: [{ offsetBeats: 0.5, value: 22 }],
                            pitchBend: [{ offsetBeats: 0.5, value: 2048 }],
                        },
                    },
                    {
                        ...note('b', 60, 1, 1),
                        velocity: 99,
                        pressure: 80,
                        slide: 82,
                        pitchBend: 2048,
                        pitchBendRangeSemitones: 48,
                        expression: {
                            pressure: [{ offsetBeats: 0.5, value: 100 }],
                            slide: [{ offsetBeats: 0.5, value: 102 }],
                            pitchBend: [{ offsetBeats: 0.5, value: 1024 }],
                        },
                    },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        joinNotes('clip1', ['a', 'b']);
        const joined = midiStore.value?.notesByClipId.clip1?.[0];
        expect(joined).toMatchObject({
            id: 'a',
            velocity: 54,
            duration: 2,
            pressure: 10,
            slide: 12,
            pitchBend: 1024,
            pitchBendRangeSemitones: 48,
            expression: {
                pressure: [
                    { offsetBeats: 0.5, value: 20 },
                    { offsetBeats: 1, value: 80 },
                    { offsetBeats: 1.5, value: 100 },
                ],
                slide: [
                    { offsetBeats: 0.5, value: 22 },
                    { offsetBeats: 1, value: 82 },
                    { offsetBeats: 1.5, value: 102 },
                ],
                pitchBend: [
                    { offsetBeats: 0.5, value: 512 },
                    { offsetBeats: 1, value: 2048 },
                    { offsetBeats: 1.5, value: 1024 },
                ],
            },
        });
    });

    it('keeps scalar-only transitions and an earlier curve when the later note has no curve', () => {
        midiStore.set({
            notesByClipId: {
                clip1: [
                    {
                        ...note('a', 60, 0, 1),
                        pressure: 10,
                        expression: { pressure: [{ offsetBeats: 0.5, value: 20 }] },
                    },
                    { ...note('b', 60, 1, 1), pressure: 80 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        joinNotes('clip1', ['a', 'b']);
        const joined = midiStore.value?.notesByClipId.clip1?.[0];
        expect(joined?.pressure).toBe(10);
        expect(joined?.expression?.pressure).toEqual([
            { offsetBeats: 0.5, value: 20 },
            { offsetBeats: 1, value: 80 },
        ]);
        expect(isValidMidiNoteExpression(joined?.expression, joined?.duration ?? 0)).toBe(true);
    });

    it('resets every absent later onset scalar before that note’s first expression point', () => {
        midiStore.set({
            notesByClipId: {
                clip1: [
                    {
                        ...note('a', 60, 0, 1),
                        pressure: 90,
                        slide: 70,
                        pitchBend: 4096,
                        pitchBendRangeSemitones: 12,
                    },
                    {
                        ...note('b', 60, 1, 1),
                        pitchBendRangeSemitones: 48,
                        expression: {
                            pressure: [{ offsetBeats: 0.5, value: 20 }],
                            slide: [{ offsetBeats: 0.5, value: 30 }],
                            pitchBend: [{ offsetBeats: 0.5, value: 1024 }],
                        },
                    },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        joinNotes('clip1', ['a', 'b']);
        const joined = midiStore.value?.notesByClipId.clip1?.[0];
        expect(joined?.expression).toEqual({
            pressure: [
                { offsetBeats: 1, value: 0 },
                { offsetBeats: 1.5, value: 20 },
            ],
            slide: [
                { offsetBeats: 1, value: 64 },
                { offsetBeats: 1.5, value: 30 },
            ],
            pitchBend: [
                { offsetBeats: 1, value: 0 },
                { offsetBeats: 1.5, value: 1024 },
            ],
        });
    });

    it('keeps explicit minimum slide distinct from a following absent neutral slide', () => {
        midiStore.set({
            notesByClipId: {
                clip1: [{ ...note('a', 60, 0, 1), slide: 0 }, note('b', 60, 1, 1)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        joinNotes('clip1', ['a', 'b']);
        const joined = midiStore.value?.notesByClipId.clip1?.[0];
        expect(joined?.slide).toBe(0);
        expect(joined?.expression?.slide).toEqual([{ offsetBeats: 1, value: 64 }]);
    });

    it('normalizes zero-range bend scalars and curves to finite zero', () => {
        midiStore.set({
            notesByClipId: {
                clip1: [
                    {
                        ...note('a', 60, 0, 1),
                        pitchBend: 4096,
                        pitchBendRangeSemitones: 0,
                        expression: { pitchBend: [{ offsetBeats: 0.5, value: 2048 }] },
                    },
                    {
                        ...note('b', 60, 1, 1),
                        pitchBend: -4096,
                        pitchBendRangeSemitones: 0,
                        expression: { pitchBend: [{ offsetBeats: 0.5, value: -2048 }] },
                    },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        joinNotes('clip1', ['a', 'b']);
        const joined = midiStore.value?.notesByClipId.clip1?.[0];
        expect(joined?.pitchBendRangeSemitones).toBe(0);
        expect(joined?.pitchBend).toBe(0);
        expect(joined?.expression?.pitchBend).toEqual([
            { offsetBeats: 0.5, value: 0 },
            { offsetBeats: 1, value: 0 },
            { offsetBeats: 1.5, value: 0 },
        ]);
        expect(isValidMidiNoteExpression(joined?.expression, joined?.duration ?? 0)).toBe(true);
    });

    it('does not retain a first-note point suppressed by a later overlapping note with no expression', () => {
        midiStore.set({
            notesByClipId: {
                clip1: [
                    {
                        ...note('a', 60, 0, 1),
                        pressure: 10,
                        expression: { pressure: [{ offsetBeats: 0.99, value: 20 }] },
                    },
                    note('b', 60, 0.98, 1),
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        joinNotes('clip1', ['a', 'b'], 0.25);
        const joined = midiStore.value?.notesByClipId.clip1?.[0];
        expect(joined?.duration).toBe(1.98);
        expect(joined?.pressure).toBe(10);
        expect(joined?.expression?.pressure).toEqual([{ offsetBeats: 0.98, value: 0 }]);
    });

    it.each([
        ['gap', 1.02, 2.02],
        ['overlap', 0.98, 1.98],
    ])('keeps sorted interior expression across a tolerated %s', (_case, secondStart, endBeat) => {
        midiStore.set({
            notesByClipId: {
                clip1: [
                    {
                        ...note('a', 60, 0, 1),
                        pressure: 10,
                        expression: { pressure: [{ offsetBeats: 0.5, value: 20 }] },
                    },
                    {
                        ...note('b', 60, secondStart, 1),
                        pressure: 80,
                        expression: { pressure: [{ offsetBeats: 0.5, value: 100 }] },
                    },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        joinNotes('clip1', ['a', 'b'], 0.25);
        const joined = midiStore.value?.notesByClipId.clip1?.[0];
        expect(joined?.duration).toBe(endBeat);
        expect(joined?.expression?.pressure).toEqual([
            { offsetBeats: 0.5, value: 20 },
            { offsetBeats: secondStart, value: 80 },
            { offsetBeats: secondStart + 0.5, value: 100 },
        ]);
        expect(isValidMidiNoteExpression(joined?.expression, joined?.duration ?? 0)).toBe(true);
    });

    it('should not merge non-adjacent notes', () => {
        joinNotes('clip1', ['a', 'c']);
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(4);
    });

    it('should not merge notes with different pitches', () => {
        joinNotes('clip1', ['a', 'd']);
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(4);
    });

    it('should merge multiple adjacent notes into one', () => {
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 60, 0, 1), note('b', 60, 1, 1), note('c', 60, 2, 1)],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        joinNotes('clip1', ['a', 'b', 'c']);
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(1);
        expect(notes?.[0]?.duration).toBe(3);
    });

    it('should still merge notes left with sub-grid jitter after humanize/quantize', () => {
        // After humanize or quantize(strength<1) the end of 'a' no longer lands exactly
        // on the start of 'b'; a residual gap of 0.02 beats far exceeds the old 0.001
        // tolerance yet is musically adjacent on a 1/4 grid (tolerance = gridSize/8).
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 60, 0, 0.98), note('b', 60, 1, 1)], // 0.02-beat gap
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        joinNotes('clip1', ['a', 'b'], 0.25); // 1/4 grid -> tolerance 0.03125
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(1);
        // Merged note spans from a.start (0) to b.end (1 + 1 = 2).
        expect(notes?.[0]?.duration).toBe(2);
    });

    it('should not merge across a gap larger than the grid tolerance', () => {
        midiStore.set({
            notesByClipId: {
                clip1: [note('a', 60, 0, 0.5), note('b', 60, 1, 1)], // 0.5-beat gap
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        joinNotes('clip1', ['a', 'b'], 0.25); // tolerance 0.03125 << 0.5 gap
        const notes = midiStore.value?.notesByClipId.clip1;
        expect(notes?.length).toBe(2);
    });
});
