import { describe, expect, it } from 'vitest';

import { type GrooveTemplate } from '../../../models/GrooveTemplate';
import { hasSameGrooveContent } from '../hasSameGrooveContent';

const base: GrooveTemplate = {
    id: 'groove-clip-source-v1',
    name: 'Source groove',
    schemaVersion: 1,
    subdivision: '1/16',
    slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
    provenance: { type: 'midi-clip', sourceId: 'clip-source', analyzerVersion: 1 },
};

const rows: Array<{ row: string; other: GrooveTemplate; expected: boolean }> = [
    { row: 'an identical template', other: structuredClone(base), expected: true },
    { row: 'another name', other: { ...base, name: 'Renamed groove' }, expected: true },
    { row: 'another id', other: { ...base, id: 'groove-clip-source-v2' }, expected: false },
    { row: 'another subdivision', other: { ...base, subdivision: '1/8' }, expected: false },
    {
        row: 'other slots',
        other: { ...base, slots: [{ index: 2, timingOffset: 0.1, dynamicsOffset: 0 }] },
        expected: false,
    },
    {
        row: 'another provenance',
        other: { ...base, provenance: { type: 'midi-clip', sourceId: 'clip-other', analyzerVersion: 1 } },
        expected: false,
    },
];

describe('hasSameGrooveContent', () => {
    it.each(rows)('compares against $row', ({ other, expected }) => {
        expect(hasSameGrooveContent(base, other)).toBe(expected);
        expect(hasSameGrooveContent(other, base)).toBe(expected);
    });
});
