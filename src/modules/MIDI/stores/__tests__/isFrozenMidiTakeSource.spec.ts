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
    ['a non-finite read start', (source) => (source.readStartBeat = Number.NEGATIVE_INFINITY)],
    ['a non-finite read end', (source) => (source.readEndBeat = Number.NaN)],
    ['an absent read start written as undefined', (source) => (source.readStartBeat = undefined)],
    [
        'a read end at its read start',
        (source) => {
            source.readStartBeat = 1;
            source.readEndBeat = 1;
        },
    ],
    [
        'a missing required key beside a read bound',
        (source) => {
            source.readStartBeat = -2;
            delete source.passLengthBeats;
        },
    ],
    ['the retired run-up key', (source) => (source.runUpEntryBeat = -2)],
    ['a non-finite occurrence origin depth', (source) => (source.occurrenceOriginDepthBeats = Number.NaN)],
    ['an occurrence origin depth written as undefined', (source) => (source.occurrenceOriginDepthBeats = undefined)],
];

describe('isFrozenMidiTakeSource', () => {
    it('admits a fragment source whose phase head lies before its window', () => {
        expect(isFrozenMidiTakeSource(frozenSource())).toBe(true);
    });

    it('admits the read bounds a Delete Time cut leaves, on either side of the entry', () => {
        expect(isFrozenMidiTakeSource({ ...frozenSource(), readStartBeat: 3 })).toBe(true);
        expect(isFrozenMidiTakeSource({ ...frozenSource(), readEndBeat: -10 })).toBe(true);
        expect(isFrozenMidiTakeSource({ ...frozenSource(), readStartBeat: -10, readEndBeat: 3 })).toBe(true);
    });

    it('admits the occurrence origin depth capture records, on either side of the pass head', () => {
        expect(isFrozenMidiTakeSource({ ...frozenSource(), occurrenceOriginDepthBeats: 4 })).toBe(true);
        expect(isFrozenMidiTakeSource({ ...frozenSource(), occurrenceOriginDepthBeats: -3 })).toBe(true);
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
