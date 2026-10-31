import { describe, expect, it } from 'vitest';

import { isFrozenMidiTakeSource } from '../isFrozenMidiTakeSource';

function frozenSource(): Record<string, unknown> {
    return {
        sourceClipId: 'clip-original',
        rows: {
            notes: {
                present: true,
                value: [{ id: 'note-held', pitch: 60, startBeat: 0, duration: 8, velocity: 100 }],
            },
            controlChanges: {
                present: true,
                value: [{ id: 'cc-swell', controller: 1, value: 20, beat: 1, channel: 0 }],
            },
            pitchBends: { present: true, value: [{ id: 'bend-dip', value: -512, beat: 2, channel: 0 }] },
        },
        sourceEntryBeat: 0,
        sourceEndBeat: 8,
        // A fragment cut out of the pass's middle enters it before its own window.
        phaseHeadBeat: -2,
        passLengthBeats: 8,
    };
}

const crdtMetadata = Symbol('crdt object metadata');

/** Stamps every object in the tree with a symbol key, as an Automerge
 *  document's objects carry their own object id and datatype. */
function withCrdtMetadata<Value>(value: Value): Value {
    if (typeof value === 'object' && value !== null) {
        for (const child of Object.values(value)) {
            withCrdtMetadata(child);
        }
        Object.defineProperty(value, crdtMetadata, { value: 'object-id', enumerable: false });
    }
    return value;
}

type SourceEdit = (source: Record<string, unknown>) => void;

function rowsOf(source: Record<string, unknown>): Record<string, { value: Array<Record<string, unknown>> }> {
    return source.rows as Record<string, { value: Array<Record<string, unknown>> }>;
}

const malformed: ReadonlyArray<readonly [string, SourceEdit]> = [
    ['an empty source clip id', (source) => (source.sourceClipId = '')],
    ['a non-finite entry beat', (source) => (source.sourceEntryBeat = Number.NaN)],
    ['an infinite phase head', (source) => (source.phaseHeadBeat = Number.NEGATIVE_INFINITY)],
    ['an end at its entry', (source) => (source.sourceEndBeat = 0)],
    ['an end below its entry', (source) => (source.sourceEndBeat = -1)],
    ['a span longer than its pass', (source) => (source.passLengthBeats = 4)],
    ['a non-positive pass length', (source) => (source.passLengthBeats = 0)],
    ['an extra source key', (source) => (source.recordedAt = 1)],
    ['an extra rows key', (source) => (rowsOf(source).sustain = { value: [] })],
    ['an extra slot key', (source) => Object.assign(rowsOf(source).notes!, { count: 1 })],
    ['an extra row key', (source) => Object.assign(rowsOf(source).controlChanges!.value[0]!, { label: 'mod' })],
];

describe('isFrozenMidiTakeSource', () => {
    it('admits a fragment source whose phase head lies before its window', () => {
        expect(isFrozenMidiTakeSource(frozenSource())).toBe(true);
    });

    it('admits a source read back from the project document, whose objects carry symbol metadata', () => {
        expect(isFrozenMidiTakeSource(withCrdtMetadata(frozenSource()))).toBe(true);
    });

    it.each(malformed)('rejects %s', (_name, edit) => {
        const source = frozenSource();
        edit(source);

        expect(isFrozenMidiTakeSource(source)).toBe(false);
    });

    it.each(malformed)('rejects %s read back from the project document', (_name, edit) => {
        const source = frozenSource();
        edit(source);

        expect(isFrozenMidiTakeSource(withCrdtMetadata(source))).toBe(false);
    });
});
