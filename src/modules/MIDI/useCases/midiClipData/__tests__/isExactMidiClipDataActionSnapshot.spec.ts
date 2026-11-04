import { describe, expect, it } from 'vitest';

import { isExactMidiClipDataActionSnapshot } from '../../../services/isExactMidiClipDataActionSnapshot';

const note = {
    id: 'note',
    pitch: 60,
    startBeat: 0,
    duration: 1,
    velocity: 100,
    articulation: 'staccato',
    expression: { pressure: [{ offsetBeats: 0.5, value: 80 }] },
};
const cc = { id: 'cc', controller: 64, value: 127, beat: 0, channel: 1 };
const bend = { id: 'bend', value: 200, beat: 0, channel: 1 };
const captured = {
    notes: { present: true, value: [note] },
    controlChanges: { present: true, value: [cc] },
    pitchBends: { present: true, value: [bend] },
};

describe('isExactMidiClipDataActionSnapshot', () => {
    it.each([-8192, 0, 8191])('retains a valid signed pitch bend of %s', (value) => {
        const snapshot = { ...captured, pitchBends: { present: true, value: [{ ...bend, value }] } };
        expect(isExactMidiClipDataActionSnapshot(snapshot)).toBe(true);
        expect(snapshot.pitchBends.value[0]?.value).toBe(value);
    });

    it('accepts exact notes, controllers, bends, and distinct absent or present-empty slots without changing them', () => {
        const before = structuredClone(captured);
        expect(isExactMidiClipDataActionSnapshot(captured)).toBe(true);
        expect(captured).toEqual(before);

        const sparseOptionals = {
            notes: {
                present: true,
                value: [{ id: 'plain', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            },
            controlChanges: { present: false, value: [] },
            pitchBends: { present: true, value: [] },
        };
        expect(isExactMidiClipDataActionSnapshot(sparseOptionals)).toBe(true);
        expect(Object.hasOwn(sparseOptionals.notes.value[0]!, 'articulation')).toBe(false);
        expect(
            isExactMidiClipDataActionSnapshot({
                notes: { present: false, value: [] },
                controlChanges: { present: false, value: [] },
                pitchBends: { present: false, value: [] },
            })
        ).toBe(true);
    });

    it.each([
        [
            'malformed articulation',
            { ...captured, notes: { present: true, value: [{ ...note, articulation: ' bad ' }] } },
        ],
        [
            'malformed expression',
            {
                ...captured,
                notes: {
                    present: true,
                    value: [{ ...note, expression: { pressure: [{ offsetBeats: 2, value: 80 }] } }],
                },
            },
        ],
        ['malformed controller', { ...captured, controlChanges: { present: true, value: [{ ...cc, value: '127' }] } }],
        [
            'malformed bend',
            { ...captured, pitchBends: { present: true, value: [{ ...bend, value: Number.POSITIVE_INFINITY }] } },
        ],
        ['fractional bend', { ...captured, pitchBends: { present: true, value: [{ ...bend, value: 0.5 }] } }],
        ['out-of-range bend', { ...captured, pitchBends: { present: true, value: [{ ...bend, value: 8192 }] } }],
        ['nonempty absent slot', { ...captured, notes: { present: false, value: [note] } }],
        ['unknown field', { ...captured, unexpected: true }],
    ] as const)('rejects a %s before it can be sanitized', (_reason, invalid) => {
        expect(isExactMidiClipDataActionSnapshot(invalid)).toBe(false);
    });
});
