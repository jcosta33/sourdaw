import { describe, it, expect } from 'vitest';

import { reconcileCrdtSlot } from '../reconcileCrdtSlot';

type Doc = { [key: string]: unknown };

type Row = { id: string; name: string; beat?: number };

function slotOf(doc: Doc): { rows: Row[] } {
    return doc.slot as { rows: Row[] };
}

describe('reconcileCrdtSlot', () => {
    it('edits a changed row in place and leaves the untouched row object identical', () => {
        const untouched: Row = { id: 'b', name: 'b0' };
        const doc: Doc = { slot: { rows: [{ id: 'a', name: 'a0' }, untouched] } };

        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: {
                rows: [
                    { id: 'a', name: 'a0' },
                    { id: 'b', name: 'b0' },
                ],
            },
            value: {
                rows: [
                    { id: 'a', name: 'a1' },
                    { id: 'b', name: 'b0' },
                ],
            },
        });

        expect(slotOf(doc).rows.map((row) => row.name)).toStrictEqual(['a1', 'b0']);
        expect(slotOf(doc).rows[1]).toBe(untouched);
    });

    it('deletes a row the writer saw and then dropped', () => {
        const doc: Doc = {
            slot: {
                rows: [
                    { id: 'a', name: 'a0' },
                    { id: 'b', name: 'b0' },
                ],
            },
        };

        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: {
                rows: [
                    { id: 'a', name: 'a0' },
                    { id: 'b', name: 'b0' },
                ],
            },
            value: { rows: [{ id: 'a', name: 'a0' }] },
        });

        expect(slotOf(doc).rows.map((row) => row.id)).toStrictEqual(['a']);
    });

    it('preserves a document row the writer never had in hand', () => {
        const doc: Doc = {
            slot: {
                rows: [
                    { id: 'quarantined', name: 'unreadable' },
                    { id: 'a', name: 'a0' },
                ],
            },
        };

        // The writer's projection rejected `quarantined`, so it is in neither
        // the base it read nor the value it wrote.
        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: { rows: [{ id: 'a', name: 'a0' }] },
            value: {
                rows: [
                    { id: 'a', name: 'a0' },
                    { id: 'new', name: 'new0' },
                ],
            },
        });

        const rowIds = slotOf(doc).rows.map((row) => row.id);
        expect(rowIds.sort()).toStrictEqual(['a', 'new', 'quarantined']);
        expect(slotOf(doc).rows.find((row) => row.id === 'quarantined')?.name).toBe('unreadable');
    });

    it('replaces a primitive collection as one value rather than merging by position', () => {
        const doc: Doc = { slot: { frequencies: [440, 880, 1760] } };

        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: { frequencies: [440, 880, 1760] },
            value: { frequencies: [432, 864] },
        });

        expect((doc.slot as { frequencies: number[] }).frequencies).toStrictEqual([432, 864]);
    });

    it('replaces a collection whose rows carry no identity as one value', () => {
        const original = [{ beat: 0, value: 1 }];
        const doc: Doc = { slot: { points: original } };

        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: { points: [{ beat: 0, value: 1 }] },
            value: {
                points: [
                    { beat: 0, value: 1 },
                    { beat: 4, value: 0.5 },
                ],
            },
        });

        const points = (doc.slot as { points: { beat: number; value: number }[] }).points;
        expect(points).toStrictEqual([
            { beat: 0, value: 1 },
            { beat: 4, value: 0.5 },
        ]);
        expect(points).not.toBe(original);
    });

    it('reconciles an id-less collection row by row when the field supplies an identity', () => {
        const untouched = { busId: 'bus-b', level: 0.2 };
        const doc: Doc = { slot: { sends: [{ busId: 'bus-a', level: 0.5 }, untouched] } };

        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: {
                sends: [
                    { busId: 'bus-a', level: 0.5 },
                    { busId: 'bus-b', level: 0.2 },
                ],
            },
            value: {
                sends: [
                    { busId: 'bus-a', level: 0.9 },
                    { busId: 'bus-b', level: 0.2 },
                ],
            },
            identityByField: {
                sends: (row) => (typeof row.busId === 'string' ? row.busId : null),
            },
        });

        const sends = (doc.slot as { sends: { busId: string; level: number }[] }).sends;
        expect(sends.map((send) => send.level)).toStrictEqual([0.9, 0.2]);
        expect(sends[1]).toBe(untouched);
    });

    it('applies the writers ordering when a collection is reordered', () => {
        const doc: Doc = {
            slot: {
                rows: [
                    { id: 'a', name: 'a0' },
                    { id: 'b', name: 'b0' },
                    { id: 'c', name: 'c0' },
                ],
            },
        };

        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: {
                rows: [
                    { id: 'a', name: 'a0' },
                    { id: 'b', name: 'b0' },
                    { id: 'c', name: 'c0' },
                ],
            },
            value: {
                rows: [
                    { id: 'c', name: 'c0' },
                    { id: 'a', name: 'a0' },
                    { id: 'b', name: 'b0' },
                ],
            },
        });

        expect(slotOf(doc).rows.map((row) => row.id)).toStrictEqual(['c', 'a', 'b']);
    });

    it('removes a record field the writer saw and dropped, and keeps one it never saw', () => {
        const doc: Doc = {
            slot: {
                notesByClipId: {
                    'clip-seen': [{ id: 'n1', name: 'n' }],
                    'clip-unseen': [{ id: 'n2', name: 'n' }],
                },
            },
        };

        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: { notesByClipId: { 'clip-seen': [{ id: 'n1', name: 'n' }] } },
            value: { notesByClipId: {} },
        });

        const notes = (doc.slot as { notesByClipId: Record<string, unknown> }).notesByClipId;
        expect(Object.keys(notes)).toStrictEqual(['clip-unseen']);
    });

    it('assigns the whole slot when the document has no value for it yet', () => {
        const doc: Doc = {};

        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: null,
            value: { rows: [{ id: 'a', name: 'a0' }] },
        });

        expect(slotOf(doc).rows).toStrictEqual([{ id: 'a', name: 'a0' }]);
    });
});
