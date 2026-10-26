import { change, from } from '@automerge/automerge';
import { describe, it, expect } from 'vitest';

import { reconcileCrdtSlot, type CrdtSlotPresence } from '../reconcileCrdtSlot';

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

    it('does not resurrect a row the document dropped while the writer carries it unchanged', () => {
        const doc: Doc = { slot: { rows: [{ id: 'a', name: 'a0' }] } };

        // The writer saw `peer` in its base and still carries it, unchanged.
        // Its absence from the document is a peer's concurrent deletion, and
        // the write owns no delta on that row.
        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: {
                rows: [
                    { id: 'a', name: 'a0' },
                    { id: 'peer', name: 'p0' },
                ],
            },
            value: {
                rows: [
                    { id: 'a', name: 'a1' },
                    { id: 'peer', name: 'p0' },
                ],
            },
        });

        expect(slotOf(doc).rows.map((row) => row.id)).toStrictEqual(['a']);
        expect(slotOf(doc).rows[0]?.name).toBe('a1');
    });

    it('still inserts a genuinely new row the base never carried', () => {
        const doc: Doc = { slot: { rows: [{ id: 'a', name: 'a0' }] } };

        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: { rows: [{ id: 'a', name: 'a0' }] },
            value: {
                rows: [
                    { id: 'a', name: 'a0' },
                    { id: 'new', name: 'n0' },
                ],
            },
        });

        expect(slotOf(doc).rows.map((row) => row.id)).toStrictEqual(['a', 'new']);
    });

    it('re-inserts a document-lacking row the writer changed relative to its base', () => {
        const doc: Doc = { slot: { rows: [{ id: 'a', name: 'a0' }] } };

        // The writer edited `peer` after seeing it, so the re-insertion
        // carries the writer's own delta and is its to write.
        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: {
                rows: [
                    { id: 'a', name: 'a0' },
                    { id: 'peer', name: 'p0' },
                ],
            },
            value: {
                rows: [
                    { id: 'a', name: 'a0' },
                    { id: 'peer', name: 'p1' },
                ],
            },
        });

        expect(slotOf(doc).rows.map((row) => row.id)).toStrictEqual(['a', 'peer']);
        expect(slotOf(doc).rows[1]?.name).toBe('p1');
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

    it('moves only the rows whose position changed, keeping every other row element', () => {
        const stayA: Row = { id: 'a', name: 'a0' };
        const stayB: Row = { id: 'b', name: 'b0' };
        const doc: Doc = { slot: { rows: [stayA, stayB, { id: 'c', name: 'c0' }] } };
        const before = {
            rows: [
                { id: 'a', name: 'a0' },
                { id: 'b', name: 'b0' },
                { id: 'c', name: 'c0' },
            ],
        };

        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: before,
            value: {
                rows: [
                    { id: 'c', name: 'c0' },
                    { id: 'a', name: 'a0' },
                    { id: 'b', name: 'b0' },
                ],
            },
        });

        // Moving `c` to the front leaves `a` and `b` in the same relative
        // order, so only `c` is relocated. The other two keep their element —
        // which is what carries a concurrent peer edit through the merge.
        expect(slotOf(doc).rows.map((row) => row.id)).toStrictEqual(['c', 'a', 'b']);
        expect(slotOf(doc).rows[1]).toBe(stayA);
        expect(slotOf(doc).rows[2]).toBe(stayB);
    });

    it('reorders correctly when a row is added in the same write', () => {
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
            value: {
                rows: [
                    { id: 'b', name: 'b0' },
                    { id: 'new', name: 'new0' },
                    { id: 'a', name: 'a0' },
                ],
            },
        });

        expect(slotOf(doc).rows.map((row) => row.id)).toStrictEqual(['b', 'new', 'a']);
    });

    it('reorders correctly when the collection is fully reversed', () => {
        const doc: Doc = {
            slot: {
                rows: [
                    { id: 'a', name: 'a0' },
                    { id: 'b', name: 'b0' },
                    { id: 'c', name: 'c0' },
                    { id: 'd', name: 'd0' },
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
                    { id: 'd', name: 'd0' },
                ],
            },
            value: {
                rows: [
                    { id: 'd', name: 'd0' },
                    { id: 'c', name: 'c0' },
                    { id: 'b', name: 'b0' },
                    { id: 'a', name: 'a0' },
                ],
            },
        });

        expect(slotOf(doc).rows.map((row) => row.id)).toStrictEqual(['d', 'c', 'b', 'a']);
    });

    it('keeps a reordered collections foreign row in place', () => {
        const doc: Doc = {
            slot: {
                rows: [
                    { id: 'a', name: 'a0' },
                    { id: 'quarantined', name: 'unreadable' },
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
            value: {
                rows: [
                    { id: 'b', name: 'b0' },
                    { id: 'a', name: 'a0' },
                ],
            },
        });

        const ids = slotOf(doc).rows.map((row) => row.id);
        expect(ids).toContain('quarantined');
        expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('a'));
    });

    it('does not re-create a map key the document dropped while the writer carries it unchanged', () => {
        const doc: Doc = {
            slot: {
                notesByClipId: {
                    'clip-kept': [{ id: 'n1', name: 'n' }],
                },
            },
        };

        // The writer's whole-state write edits `clip-kept` and carries
        // `clip-peer-deleted` exactly as its base had it. The key's absence
        // from the document is a peer's concurrent deletion of the map entry —
        // a change this write never saw and owns no delta on — so the flush
        // must not resurrect the deleted clip's notes one container up from
        // the row-membership law.
        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: {
                notesByClipId: {
                    'clip-kept': [{ id: 'n1', name: 'n' }],
                    'clip-peer-deleted': [{ id: 'n2', name: 'n' }],
                },
            },
            value: {
                notesByClipId: {
                    'clip-kept': [{ id: 'n1', name: 'n-edited' }],
                    'clip-peer-deleted': [{ id: 'n2', name: 'n' }],
                },
            },
        });

        const notes = (doc.slot as { notesByClipId: Record<string, unknown> }).notesByClipId;
        expect(Object.keys(notes)).toStrictEqual(['clip-kept']);
        expect(notes['clip-kept']).toStrictEqual([{ id: 'n1', name: 'n-edited' }]);
    });

    it('still inserts a genuinely new map key the base never carried', () => {
        const doc: Doc = {
            slot: {
                notesByClipId: {
                    'clip-kept': [{ id: 'n1', name: 'n' }],
                },
            },
        };

        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: {
                notesByClipId: {
                    'clip-kept': [{ id: 'n1', name: 'n' }],
                },
            },
            value: {
                notesByClipId: {
                    'clip-kept': [{ id: 'n1', name: 'n' }],
                    'clip-added': [{ id: 'n2', name: 'n' }],
                },
            },
        });

        expect(Object.keys((doc.slot as { notesByClipId: Record<string, unknown> }).notesByClipId)).toStrictEqual([
            'clip-kept',
            'clip-added',
        ]);
    });

    it('keeps the document order when the writer owns no order delta', () => {
        // The writer edited `a` in place; its base order equals its desired
        // order. A peer has since dragged `c` to the front, so the document
        // holds [c, a, b] — an order this write never saw and must not undo.
        const doc: Doc = {
            slot: {
                rows: [
                    { id: 'c', name: 'c0' },
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
                    { id: 'c', name: 'c0' },
                ],
            },
            value: {
                rows: [
                    { id: 'a', name: 'a1' },
                    { id: 'b', name: 'b0' },
                    { id: 'c', name: 'c0' },
                ],
            },
        });

        expect(slotOf(doc).rows.map((row) => row.id)).toStrictEqual(['c', 'a', 'b']);
        expect(slotOf(doc).rows.find((row) => row.id === 'a')?.name).toBe('a1');
    });

    it('applies the writers ordering when it differs from the base order even against a peer reorder', () => {
        // Base [a, b, c]; the writer reordered to [b, c, a]; a peer
        // concurrently dragged `c` to the front. The writer owns a genuine
        // order delta, so its full placement applies.
        const doc: Doc = {
            slot: {
                rows: [
                    { id: 'c', name: 'c0' },
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
                    { id: 'c', name: 'c0' },
                ],
            },
            value: {
                rows: [
                    { id: 'b', name: 'b0' },
                    { id: 'c', name: 'c0' },
                    { id: 'a', name: 'a0' },
                ],
            },
        });

        expect(slotOf(doc).rows.map((row) => row.id)).toStrictEqual(['b', 'c', 'a']);
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

    it('lands a nested seed under an unchanged slot value the snapshot provably lacked', () => {
        // The whole-slot write is a deferred baseline re-flushed unchanged: it
        // carries no delta of this writer's own, so the slot's value stands.
        // The seed `x` is different — the snapshot taken beside the base says
        // no document ever held it, so only the cache knows it, and skipping
        // would strand it outside the document for the next projection to
        // erase (#4962 review, reconcileCrdtSlot thread).
        const doc: Doc = { slot: { a: 1 } };

        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: { a: 1, x: 2 },
            value: { a: 1, x: 2 },
            documentPresence: { slot: { a: 1 } },
        });

        expect(doc.slot).toEqual({ a: 1, x: 2 });
    });

    it('keeps a nested key the snapshot held deleted under an unchanged slot value', () => {
        // The control for the seed landing above: the same unchanged write,
        // but here the snapshot proves the document held `y` when the base was
        // captured. Its absence is a peer's newer deletion and the unchanged
        // write owns no delta on it — the snapshot decides, at depth as at the
        // slot itself.
        const doc: Doc = { slot: { a: 1 } };

        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: { a: 1, y: 3 },
            value: { a: 1, y: 3 },
            documentPresence: { slot: { a: 1, y: 3 } },
        });

        expect(doc.slot).toEqual({ a: 1 });
    });

    it('lands a base-carried row under an unchanged slot when the snapshot lacked it', () => {
        const doc: Doc = { slot: { rows: [] } };

        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: { rows: [{ id: 'seed', name: 's0' }] },
            value: { rows: [{ id: 'seed', name: 's0' }] },
            documentPresence: { slot: { rows: [] } },
        });

        expect(slotOf(doc).rows.map((row) => row.id)).toStrictEqual(['seed']);
    });

    it('keeps a base-carried row deleted under an unchanged slot when the snapshot held it', () => {
        const doc: Doc = { slot: { rows: [] } };

        reconcileCrdtSlot({
            doc,
            key: 'slot',
            baseValue: { rows: [{ id: 'peer', name: 'p0' }] },
            value: { rows: [{ id: 'peer', name: 'p0' }] },
            documentPresence: { slot: { rows: [{ id: 'peer', name: 'p0' }] } },
        });

        expect(slotOf(doc).rows).toStrictEqual([]);
    });
});

type AutomergeSlotDoc = { slot: { rows: Row[]; title?: string } };

/**
 * Reconciles inside a real Automerge `change()`, where every list read goes
 * through a proxy and the WASM document rather than a plain array.
 */
function reconcileInAutomerge(input: {
    initial: AutomergeSlotDoc;
    baseValue: unknown;
    value: unknown;
    documentPresence?: CrdtSlotPresence;
}): AutomergeSlotDoc {
    const initial = from<AutomergeSlotDoc>(structuredClone(input.initial));
    return change(initial, (draft) => {
        reconcileCrdtSlot({
            doc: draft,
            key: 'slot',
            baseValue: input.baseValue,
            value: input.value,
            documentPresence: input.documentPresence,
        });
    });
}

function plainRows(doc: AutomergeSlotDoc): Row[] {
    return structuredClone(doc.slot.rows);
}

/** mulberry32: a small seeded generator so a failing case replays exactly. */
function createRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

type RowScenario = { base: Row[]; desired: Row[] };

function randomScenario(seed: number): RowScenario {
    const random = createRandom(seed);
    const pick = (limit: number): number => Math.floor(random() * limit);
    let nextId = 0;
    const freshRow = (): Row => {
        nextId += 1;
        return { id: `r${nextId}`, name: `n${nextId}` };
    };

    const base = Array.from({ length: pick(61) }, freshRow);
    const desired = structuredClone(base);
    const operations = 1 + pick(8);
    for (let step = 0; step < operations; step += 1) {
        const operation = pick(4);
        if (operation === 0 || desired.length === 0) {
            desired.splice(pick(desired.length + 1), 0, freshRow());
        } else if (operation === 1) {
            desired.splice(pick(desired.length), 1);
        } else if (operation === 2) {
            const row = desired[pick(desired.length)];
            if (row) {
                row.name = `${row.name}-edit${step}`;
                row.beat = pick(16);
            }
        } else {
            const [moved] = desired.splice(pick(desired.length), 1);
            if (moved) {
                desired.splice(pick(desired.length + 1), 0, moved);
            }
        }
    }
    return { base, desired };
}

describe('reconcileCrdtSlot placement against a live Automerge list', () => {
    it('converges a single writer onto its desired list after random inserts, removals, edits and reorders', () => {
        for (let index = 0; index < 200; index += 1) {
            const { base, desired } = randomScenario(0x5eed + index);
            const result = reconcileInAutomerge({
                initial: { slot: { rows: base } },
                baseValue: { rows: base },
                value: { rows: desired },
            });

            expect({ scenario: index, rows: plainRows(result) }).toStrictEqual({ scenario: index, rows: desired });
        }
    });

    it('places rows inserted between and after pinned rows at their desired positions', () => {
        const result = reconcileInAutomerge({
            initial: {
                slot: {
                    rows: [
                        { id: 'a', name: 'a0' },
                        { id: 'b', name: 'b0' },
                    ],
                },
            },
            baseValue: {
                rows: [
                    { id: 'a', name: 'a0' },
                    { id: 'b', name: 'b0' },
                ],
            },
            value: {
                rows: [
                    { id: 'x', name: 'x0' },
                    { id: 'a', name: 'a0' },
                    { id: 'y', name: 'y0' },
                    { id: 'b', name: 'b0' },
                    { id: 'z', name: 'z0' },
                ],
            },
        });

        expect(plainRows(result).map((row) => row.id)).toStrictEqual(['x', 'a', 'y', 'b', 'z']);
    });

    it('keeps the order a peer reordered into while the writer appends rows and edits one', () => {
        // Base [A, B, C, D]; a peer has since reordered the document to
        // [D, B, C, A]. The writer appends E and F and edits C, so its
        // placement applies over a non-monotone set of pinned rows.
        const result = reconcileInAutomerge({
            initial: {
                slot: {
                    rows: [
                        { id: 'D', name: 'D0' },
                        { id: 'B', name: 'B0' },
                        { id: 'C', name: 'C0' },
                        { id: 'A', name: 'A0' },
                    ],
                },
            },
            baseValue: {
                rows: [
                    { id: 'A', name: 'A0' },
                    { id: 'B', name: 'B0' },
                    { id: 'C', name: 'C0' },
                    { id: 'D', name: 'D0' },
                ],
            },
            value: {
                rows: [
                    { id: 'A', name: 'A0' },
                    { id: 'B', name: 'B0' },
                    { id: 'C', name: 'C1' },
                    { id: 'D', name: 'D0' },
                    { id: 'E', name: 'E0' },
                    { id: 'F', name: 'F0' },
                ],
            },
        });

        // Only B and C are already in the writer's relative order, so they
        // stay pinned and A and D are removed and re-inserted around them.
        expect(plainRows(result)).toStrictEqual([
            { id: 'A', name: 'A0' },
            { id: 'B', name: 'B0' },
            { id: 'C', name: 'C1' },
            { id: 'D', name: 'D0' },
            { id: 'E', name: 'E0' },
            { id: 'F', name: 'F0' },
        ]);
    });

    it('keeps the peer order while re-inserting a peer-deleted row the writer edited', () => {
        // The writer carries no order delta, so every row it sees is pinned in
        // the document's own order, and the re-inserted `C` lands after the
        // previously placed row.
        const result = reconcileInAutomerge({
            initial: {
                slot: {
                    rows: [
                        { id: 'D', name: 'D0' },
                        { id: 'A', name: 'A0' },
                        { id: 'B', name: 'B0' },
                    ],
                },
            },
            baseValue: {
                rows: [
                    { id: 'A', name: 'A0' },
                    { id: 'B', name: 'B0' },
                    { id: 'C', name: 'C0' },
                    { id: 'D', name: 'D0' },
                ],
            },
            value: {
                rows: [
                    { id: 'A', name: 'A0' },
                    { id: 'B', name: 'B0' },
                    { id: 'C', name: 'C1' },
                    { id: 'D', name: 'D0' },
                ],
            },
        });

        expect(plainRows(result)).toStrictEqual([
            { id: 'D', name: 'D0' },
            { id: 'A', name: 'A0' },
            { id: 'B', name: 'B0' },
            { id: 'C', name: 'C1' },
        ]);
    });
});

describe('reconcileCrdtSlot cost against a large live Automerge list', () => {
    const rowCount = 3000;
    const budgetMs = 3000;
    const testTimeoutMs = 20_000;

    const largeRows = (): Row[] =>
        Array.from({ length: rowCount }, (_, index) => ({ id: `row-${index}`, name: `name-${index}`, beat: index }));

    it(
        'appends rows to a list of thousands without rescanning the live list per row',
        () => {
            const rows = largeRows();
            const appended: Row[] = [
                ...rows,
                { id: 'extra-0', name: 'extra-0' },
                { id: 'extra-1', name: 'extra-1' },
                { id: 'extra-2', name: 'extra-2' },
            ];

            const startedAt = performance.now();
            const result = reconcileInAutomerge({
                initial: { slot: { rows } },
                baseValue: { rows },
                value: { rows: appended },
            });
            const elapsedMs = performance.now() - startedAt;

            expect(plainRows(result).map((row) => row.id)).toStrictEqual(appended.map((row) => row.id));
            expect(elapsedMs).toBeLessThan(budgetMs);
        },
        testTimeoutMs
    );

    it(
        'edits a small key beside an unchanged list of thousands without walking that list per row',
        () => {
            const rows = largeRows();
            const slot = { rows, title: 'before' };

            const startedAt = performance.now();
            const result = reconcileInAutomerge({
                initial: { slot },
                baseValue: slot,
                value: { rows, title: 'after' },
                documentPresence: { slot },
            });
            const elapsedMs = performance.now() - startedAt;

            expect(result.slot.title).toBe('after');
            expect(result.slot.rows).toHaveLength(rowCount);
            expect(elapsedMs).toBeLessThan(budgetMs);
        },
        testTimeoutMs
    );
});
