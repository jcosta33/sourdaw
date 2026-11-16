import { describe, expect, it } from 'vitest';

import { type MidiNote } from '../../models/MidiNote';
import { type MidiNoteEditOperation, planMidiNoteEdits } from '../planMidiNoteEdits';

function sourceNotes(): MidiNote[] {
    return [
        {
            id: 'motif',
            pitch: 67,
            startBeat: 0,
            duration: 1,
            velocity: 81,
            articulation: 'accent',
            expression: { pressure: [{ offsetBeats: 0.25, value: 30 }] },
        },
        {
            id: 'phrase',
            pitch: 64,
            startBeat: 4,
            duration: 2,
            velocity: 88,
            probability: 73,
            pressure: 12,
            slide: 32,
            pitchBend: -1024,
            pitchBendRangeSemitones: 12,
            channel: 3,
            articulation: 'legato',
            recordingPassIndex: 2,
            expression: {
                pressure: [
                    { offsetBeats: 0.25, value: 40 },
                    { offsetBeats: 1.5, value: 90 },
                ],
                slide: [{ offsetBeats: 0.75, value: 64 }],
                pitchBend: [{ offsetBeats: 0.5, value: -2048 }],
            },
        },
        { id: 'filler', pitch: 69, startBeat: 6, duration: 0.5, velocity: 77 },
        {
            id: 'surrounding',
            pitch: 60,
            startBeat: 9,
            duration: 2,
            velocity: 91,
            pressure: 17,
            expression: { pitchBend: [{ offsetBeats: 1, value: 2048 }] },
        },
    ];
}

function scope() {
    return {
        allowedNoteIds: ['phrase', 'filler'],
        protectedNoteIds: ['motif'],
        protectedWindows: [{ startBeat: 0, endBeat: 2 }],
        insertionWindows: [{ startBeat: 2, endBeat: 8 }],
        insertionBudget: 2,
    };
}

function freezeInput<Value>(value: Value): Value {
    if (typeof value === 'object' && value !== null) {
        for (const child of Object.values(value)) freezeInput(child);
        Object.freeze(value);
    }
    return value;
}

function plan(operations: readonly MidiNoteEditOperation[], overrides: Partial<ReturnType<typeof scope>> = {}) {
    const input = freezeInput({ notes: sourceNotes(), operations, scope: { ...scope(), ...overrides } });
    const before = structuredClone(input);
    const result = planMidiNoteEdits(input);
    expect(input).toEqual(before);
    return result;
}

describe('planMidiNoteEdits', () => {
    it('plans mixed edits while preserving every untargeted row and retained expression', () => {
        const notes = sourceNotes();
        const before = structuredClone(notes);
        const result = planMidiNoteEdits({
            notes,
            scope: scope(),
            operations: [
                { type: 'patch', noteId: 'phrase', patch: { pitch: 63, startBeat: 4.25, duration: 1, velocity: 93 } },
                { type: 'delete', noteId: 'filler' },
                { type: 'insert', note: { id: 'application-note', pitch: 66, startBeat: 6, duration: 0.25 } },
            ],
        });

        expect(result.status).toBe('planned');
        if (result.status !== 'planned') throw new Error('Expected the admitted note edits');
        const edited = {
            ...before[1],
            pitch: 63,
            startBeat: 4.25,
            duration: 1,
            velocity: 93,
            expression: {
                pressure: [{ offsetBeats: 0.25, value: 40 }],
                slide: [{ offsetBeats: 0.75, value: 64 }],
                pitchBend: [{ offsetBeats: 0.5, value: -2048 }],
            },
        };
        const inserted = {
            id: 'application-note',
            pitch: 66,
            startBeat: 6,
            duration: 0.25,
            velocity: 100,
            probability: 100,
        };
        expect(result.notes).toEqual([before[0], edited, before[3], inserted]);
        expect(result.changes).toEqual([
            { type: 'patch', noteId: 'phrase', before: before[1], after: edited },
            { type: 'delete', noteId: 'filler', before: before[2], after: null },
            { type: 'insert', noteId: 'application-note', before: null, after: inserted },
        ]);
        expect(notes).toEqual(before);
    });

    it('captures each repeated patch from the preceding operation rather than the original source', () => {
        const before = sourceNotes()[1]!;
        const first = { ...before, pitch: 63 };
        const second = { ...first, velocity: 97 };
        const result = plan([
            { type: 'patch', noteId: 'phrase', patch: { pitch: 63 } },
            { type: 'patch', noteId: 'phrase', patch: { velocity: 97 } },
        ]);

        expect(result).toMatchObject({
            status: 'planned',
            changes: [
                { type: 'patch', noteId: 'phrase', before, after: first },
                { type: 'patch', noteId: 'phrase', before: first, after: second },
            ],
        });
        if (result.status !== 'planned') throw new Error('Expected the ordered patches');
        expect(result.notes[1]).toEqual(second);
        expect(result.notes[1]?.expression).toEqual(before.expression);
    });

    it('retimes and extends a note without rebasing or scaling its expression', () => {
        const original = sourceNotes()[1]!;
        const result = plan([{ type: 'patch', noteId: 'phrase', patch: { startBeat: 2, duration: 4 } }]);

        if (result.status !== 'planned') throw new Error('Expected an admitted timing edit');
        expect(result.notes[1]).toEqual({ ...original, startBeat: 2, duration: 4 });
    });

    it('rejects a target deleted by an earlier operation without exposing any partial result', () => {
        expect(
            plan([
                { type: 'patch', noteId: 'phrase', patch: { velocity: 97 } },
                { type: 'delete', noteId: 'filler' },
                { type: 'patch', noteId: 'filler', patch: { pitch: 70 } },
            ])
        ).toEqual({ status: 'rejected', reason: 'note-not-found', operationIndex: 2 });
    });

    it('never reuses an original ID even when its row was deleted earlier in the plan', () => {
        expect(
            plan([
                { type: 'delete', noteId: 'filler' },
                { type: 'insert', note: { id: 'filler', pitch: 70, startBeat: 6, duration: 1 } },
            ])
        ).toEqual({ status: 'rejected', reason: 'insert-id-collision', operationIndex: 1 });
    });

    it('rejects colliding application insert IDs within the same plan', () => {
        const insert = {
            type: 'insert' as const,
            note: { id: 'application-note', pitch: 70, startBeat: 6, duration: 1 },
        };
        expect(plan([insert, insert])).toEqual({
            status: 'rejected',
            reason: 'insert-id-collision',
            operationIndex: 1,
        });
    });

    it('lets protection override the allowed ID set', () => {
        expect(plan([{ type: 'delete', noteId: 'motif' }], { allowedNoteIds: ['motif'] })).toEqual({
            status: 'rejected',
            reason: 'protected-note',
            operationIndex: 0,
        });
    });

    it('refuses an inserted ID explicitly protected by the application even when absent from this bucket', () => {
        expect(
            plan([{ type: 'insert', note: { id: 'protected-identity', pitch: 70, startBeat: 6, duration: 1 } }], {
                protectedNoteIds: ['protected-identity'],
            })
        ).toEqual({ status: 'rejected', reason: 'protected-note', operationIndex: 0 });
    });

    it('refuses an unselected source row and an unknown note ID', () => {
        expect(plan([{ type: 'delete', noteId: 'surrounding' }])).toEqual({
            status: 'rejected',
            reason: 'note-not-allowed',
            operationIndex: 0,
        });
        expect(plan([{ type: 'delete', noteId: 'missing' }])).toEqual({
            status: 'rejected',
            reason: 'note-not-found',
            operationIndex: 0,
        });
    });

    it.each<MidiNoteEditOperation>([
        { type: 'patch', noteId: 'phrase', patch: { startBeat: 1.5 } },
        { type: 'insert', note: { id: 'application-note', pitch: 70, startBeat: 1.5, duration: 1 } },
    ])('refuses an edit whose resulting span overlaps the protected opening window: $type', (operation) => {
        expect(plan([operation])).toEqual({ status: 'rejected', reason: 'protected-window', operationIndex: 0 });
    });

    it.each<MidiNoteEditOperation>([
        { type: 'patch', noteId: 'phrase', patch: { velocity: 97 } },
        { type: 'patch', noteId: 'phrase', patch: { startBeat: 2 } },
        { type: 'delete', noteId: 'phrase' },
    ])('protects an existing overlapping row even when its ID is allowed: $type', (operation) => {
        expect(plan([operation], { protectedWindows: [{ startBeat: 5, endBeat: 6 }] })).toEqual({
            status: 'rejected',
            reason: 'protected-window',
            operationIndex: 0,
        });
    });

    it('protects the newly covered tail when a duration is extended', () => {
        expect(
            plan([{ type: 'patch', noteId: 'phrase', patch: { duration: 4 } }], {
                protectedWindows: [{ startBeat: 7, endBeat: 8 }],
            })
        ).toEqual({ status: 'rejected', reason: 'protected-window', operationIndex: 0 });
    });

    it('admits an insertion that ends exactly where a protected window starts', () => {
        const result = plan(
            [{ type: 'insert', note: { id: 'application-note', pitch: 70, startBeat: 2, duration: 1 } }],
            {
                protectedWindows: [{ startBeat: 3, endBeat: 4 }],
            }
        );
        expect(result.status).toBe('planned');
    });

    it('requires an entire inserted note to fit one permitted insertion window', () => {
        expect(
            plan([{ type: 'insert', note: { id: 'application-note', pitch: 70, startBeat: 7.5, duration: 1 } }])
        ).toEqual({ status: 'rejected', reason: 'outside-insertion-window', operationIndex: 0 });
    });

    it('never treats an existing-note allowance as insertion authority', () => {
        expect(
            plan([{ type: 'insert', note: { id: 'application-note', pitch: 70, startBeat: 6, duration: 1 } }], {
                insertionWindows: [],
            })
        ).toEqual({ status: 'rejected', reason: 'outside-insertion-window', operationIndex: 0 });
    });

    it('charges every insertion against the application budget', () => {
        expect(
            plan(
                [
                    { type: 'insert', note: { id: 'application-first', pitch: 70, startBeat: 6, duration: 0.5 } },
                    { type: 'insert', note: { id: 'application-second', pitch: 72, startBeat: 7, duration: 0.5 } },
                ],
                { insertionBudget: 1 }
            )
        ).toEqual({ status: 'rejected', reason: 'insertion-budget-exceeded', operationIndex: 1 });
    });

    it.each([
        ['pitch', Number.NaN],
        ['pitch', 60.5],
        ['pitch', -1],
        ['pitch', 128],
        ['velocity', 0],
        ['velocity', 128],
        ['velocity', 64.5],
        ['velocity', Number.POSITIVE_INFINITY],
        ['startBeat', Number.NaN],
        ['startBeat', -1],
        ['startBeat', Number.POSITIVE_INFINITY],
        ['duration', 0],
        ['duration', 0.01],
        ['duration', Number.NEGATIVE_INFINITY],
    ])('refuses invalid %s values without normalizing them into approved edits: %s', (field, value) => {
        const operation: MidiNoteEditOperation = { type: 'patch', noteId: 'phrase', patch: { pitch: 63 } };
        Reflect.set(operation.patch, field, value);
        expect(plan([operation])).toEqual({ status: 'rejected', reason: 'invalid-operations', operationIndex: 0 });
    });

    it('rejects finite numbers whose resulting extent overflows or cannot advance', () => {
        for (const patch of [
            { startBeat: Number.MAX_VALUE, duration: Number.MAX_VALUE },
            { startBeat: Number.MAX_VALUE, duration: 1 },
        ]) {
            expect(plan([{ type: 'patch', noteId: 'phrase', patch }])).toEqual({
                status: 'rejected',
                reason: 'invalid-operations',
                operationIndex: 0,
            });
        }
    });

    it('rejects empty or unsupported patches and provider-shaped inserted fields', () => {
        expect(plan([{ type: 'patch', noteId: 'phrase', patch: {} }])).toMatchObject({ status: 'rejected' });
        const operation: MidiNoteEditOperation = { type: 'patch', noteId: 'phrase', patch: { pitch: 63 } };
        Reflect.set(operation.patch, 'channel', 7);
        expect(plan([operation])).toMatchObject({ status: 'rejected' });
        const insert: MidiNoteEditOperation = {
            type: 'insert',
            note: { id: 'application-note', pitch: 70, startBeat: 6, duration: 1 },
        };
        Reflect.set(insert.note, 'articulation', 'accent');
        expect(plan([insert])).toMatchObject({ status: 'rejected' });
    });

    it('refuses invalid inserted values before the shared normalizer could clamp them', () => {
        expect(
            plan([{ type: 'insert', note: { id: 'application-note', pitch: 128, startBeat: 6, duration: 1 } }])
        ).toEqual({ status: 'rejected', reason: 'invalid-operations', operationIndex: 0 });
        expect(
            plan([
                {
                    type: 'insert',
                    note: { id: 'application-note', pitch: 70, startBeat: 6, duration: 1, probability: 50 },
                },
            ])
        ).toEqual({ status: 'rejected', reason: 'invalid-operations', operationIndex: 0 });
    });

    it('rejects duplicate source identities and malformed source expression', () => {
        const original = sourceNotes();
        const operation: MidiNoteEditOperation = { type: 'delete', noteId: 'filler' };
        expect(
            planMidiNoteEdits({ notes: [...original, original[1]!], scope: scope(), operations: [operation] })
        ).toEqual({ status: 'rejected', reason: 'invalid-source' });
        expect(
            planMidiNoteEdits({ notes: [{ ...original[1]!, duration: 0.2 }], scope: scope(), operations: [operation] })
        ).toEqual({ status: 'rejected', reason: 'invalid-source' });
    });

    it('rejects sparse operations and enforces the exact operation cap', () => {
        const operation: MidiNoteEditOperation = { type: 'patch', noteId: 'phrase', patch: { velocity: 97 } };
        const sparse = [operation];
        delete sparse[0];
        expect(plan(sparse)).toEqual({ status: 'rejected', reason: 'invalid-operations', operationIndex: 0 });
        expect(plan(Array.from({ length: 128 }, () => operation)).status).toBe('planned');
        expect(plan(Array.from({ length: 129 }, () => operation))).toEqual({
            status: 'rejected',
            reason: 'operation-budget-exceeded',
        });
    });

    it('rejects invalid application windows and insertion budgets', () => {
        const operations: MidiNoteEditOperation[] = [{ type: 'delete', noteId: 'filler' }];
        expect(plan(operations, { insertionBudget: -1 })).toEqual({ status: 'rejected', reason: 'invalid-scope' });
        expect(plan(operations, { protectedWindows: [{ startBeat: 2, endBeat: 2 }] })).toEqual({
            status: 'rejected',
            reason: 'invalid-scope',
        });
    });

    it('keeps returned notes and evidence independent of the input and one another', () => {
        const notes = sourceNotes();
        const before = structuredClone(notes);
        const result = planMidiNoteEdits({
            notes,
            scope: scope(),
            operations: [{ type: 'patch', noteId: 'phrase', patch: { pitch: 63 } }],
        });
        if (result.status !== 'planned') throw new Error('Expected a planned patch');
        const point = result.notes[1]?.expression?.pressure?.[0];
        if (!point) throw new Error('Expected retained expression');
        point.value = 1;
        expect(notes).toEqual(before);
        expect(result.changes[0]?.after?.expression?.pressure?.[0]?.value).toBe(40);
    });
});
