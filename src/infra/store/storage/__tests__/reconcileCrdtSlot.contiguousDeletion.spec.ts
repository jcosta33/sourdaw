import { change, clone, from, getObjectId, merge, type Doc } from '@automerge/automerge';
import { describe, expect, it, vi } from 'vitest';

import { reconcileCrdtSlot } from '../reconcileCrdtSlot';

type Row = {
    id: string;
    originalBeat: number;
    warpedBeat: number;
    origin: string;
    confidence: number;
    locked: boolean;
};
type State = { markers: Row[]; enabled: boolean; stretchMode: string; originalTempo: null };
type Document = { slot: State };
type NativeContext = {
    spliceFromHydrate(objectId: string, index: number, deleteCount: number, values: unknown[]): unknown;
};
type Splice = { index: number; deleteCount: number; inserted: number };

function row(id: string, beat: number, origin = 'transient-auto', locked = false): Row {
    return { id, originalBeat: beat, warpedBeat: beat, origin, confidence: 0.75, locked };
}

function state(markers: Row[]): State {
    return { markers, enabled: false, stretchMode: 'repitch', originalTempo: null };
}

function fixture(interleavedRetained = false): { base: State; desired: State } {
    const autos = Array.from({ length: 120 }, (_, index) =>
        row(`old-${index}`, index + 1.25, 'transient-auto', index === 0)
    );
    const retained = [autos[0], row('user', 0.9, 'user')];
    if (interleavedRetained) {
        retained.push(row('middle-user', 60.75, 'user'));
    }
    const byBeat = (left: Row, right: Row): number => left.originalBeat - right.originalBeat;
    const base = state([...autos, ...retained.slice(1)].sort(byBeat));
    const replacements = Array.from({ length: 119 }, (_, index) => row(`new-${index + 1}`, index + 2.25));
    return { base, desired: state([...retained, ...replacements].sort(byBeat)) };
}

function nativeContext(draft: object): NativeContext {
    // Automerge 3.5's private context is observed only in this untimed native-call regression.
    const metadata: unknown = Reflect.get(draft, Symbol.for('_am_meta'));
    if (typeof metadata !== 'object' || metadata === null || !('handle' in metadata)) {
        throw new Error('Expected Automerge 3.5 draft metadata');
    }
    const handle = metadata.handle;
    if (
        typeof handle !== 'object' ||
        handle === null ||
        !('spliceFromHydrate' in handle) ||
        typeof handle.spliceFromHydrate !== 'function'
    ) {
        throw new Error('Expected Automerge 3.5 native splice context');
    }
    return handle as NativeContext;
}

function reconcile(
    initial: Doc<Document>,
    base: State,
    desired: State
): { document: Doc<Document>; splices: Splice[] } {
    const splices: Splice[] = [];
    const listId = getObjectId(initial.slot.markers);
    const document = change(initial, (draft) => {
        const spy = vi.spyOn(nativeContext(draft), 'spliceFromHydrate');
        try {
            reconcileCrdtSlot({
                doc: draft,
                key: 'slot',
                baseValue: base,
                value: desired,
                documentPresence: { slot: base },
            });
            for (const [objectId, index, deleteCount, values] of spy.mock.calls) {
                expect(objectId).toBe(listId);
                splices.push({ index, deleteCount, inserted: values.length });
            }
        } finally {
            spy.mockRestore();
        }
    });
    return { document, splices };
}

function objectIds(document: Document): Record<string, string | undefined> {
    return Object.fromEntries([
        ['list', getObjectId(document.slot.markers)],
        ...document.slot.markers
            .filter((marker) => marker.locked || marker.origin === 'user')
            .map((marker) => [marker.id, getObjectId(marker)]),
    ]);
}

function expectSplices(splices: Splice[], deletions: { index: number; deleteCount: number }[]): void {
    expect(splices.filter((call) => call.deleteCount > 0)).toStrictEqual(
        deletions.map((call) => ({ ...call, inserted: 0 }))
    );
    const inserts = splices.filter((call) => call.inserted > 0);
    expect(inserts).toHaveLength(119);
    expect(inserts.every((call) => call.deleteCount === 0 && call.inserted === 1)).toBe(true);
}

function peerChange(initial: Doc<Document>): Doc<Document> {
    return change(clone(initial, { actor: 'bbbbbbbbbbbbbbbb' }), (draft) => {
        const locked = draft.slot.markers.find((marker) => marker.id === 'old-0');
        if (!locked) {
            throw new Error('Expected retained locked row');
        }
        locked.confidence = 0.99;
        const removedIndex = draft.slot.markers.findIndex((marker) => marker.id === 'old-60');
        expect(removedIndex).toBe(61);
        draft.slot.markers.splice(removedIndex, 1, row('peer', 60.75, 'user'));
    });
}

describe('reconcileCrdtSlot contiguous native deletions', () => {
    it('deletes 119 replaceable rows with one native splice while retaining the list and locked/user objects', () => {
        const { base, desired } = fixture();
        const initial = from<Document>({ slot: base });
        const before = objectIds(initial);
        const { document, splices } = reconcile(initial, base, desired);

        expectSplices(splices, [{ index: 2, deleteCount: 119 }]);
        expect(document.slot).toStrictEqual(desired);
        expect(objectIds(document)).toStrictEqual(before);
    });

    it('flushes a deletion run reaching index zero without replacing the native list', () => {
        const base = state([row('a', 1), row('b', 2), row('c', 3)]);
        const desired = state([]);
        const initial = from<Document>({ slot: base });
        const listId = getObjectId(initial.slot.markers);
        const { document, splices } = reconcile(initial, base, desired);

        expect(splices).toStrictEqual([{ index: 0, deleteCount: 3, inserted: 0 }]);
        expect(document.slot).toStrictEqual(desired);
        expect(getObjectId(document.slot.markers)).toBe(listId);
    });

    it('ends a deletion run at a retained row and applies both runs from right to left', () => {
        const { base, desired } = fixture(true);
        const initial = from<Document>({ slot: base });
        const before = objectIds(initial);
        const { document, splices } = reconcile(initial, base, desired);

        expectSplices(splices, [
            { index: 62, deleteCount: 60 },
            { index: 2, deleteCount: 59 },
        ]);
        expect(document.slot).toStrictEqual(desired);
        expect(objectIds(document)).toStrictEqual(before);
    });

    it('ends a deletion run at a row absent from the writer base without deleting or relocating it', () => {
        const { base, desired } = fixture();
        const current = structuredClone(base);
        const peer = row('peer', 60.75, 'user');
        current.markers.splice(61, 0, peer);
        const initial = from<Document>({ slot: current });
        const before = objectIds(initial);
        const { document, splices } = reconcile(initial, base, desired);

        expectSplices(splices, [
            { index: 62, deleteCount: 60 },
            { index: 2, deleteCount: 59 },
        ]);
        expect(document.slot).toStrictEqual({ ...desired, markers: [...desired.markers, peer] });
        expect(objectIds(document)).toStrictEqual(before);
    });

    it('preserves a rebased peer edit, deletion and insertion across the two surviving delete runs', () => {
        const { base, desired } = fixture();
        const initial = peerChange(from<Document>({ slot: base }, { actor: 'aaaaaaaaaaaaaaaa' }));
        const before = objectIds(initial);
        const { document, splices } = reconcile(initial, base, desired);
        const expected = structuredClone(desired);
        expected.markers[1].confidence = 0.99;
        expected.markers.push(row('peer', 60.75, 'user'));

        expectSplices(splices, [
            { index: 62, deleteCount: 59 },
            { index: 2, deleteCount: 59 },
        ]);
        expect(document.slot).toStrictEqual(expected);
        expect(objectIds(document)).toStrictEqual(before);
    });

    it('converges with concurrent peer edits, deletions and insertions in either merge order', () => {
        const { base, desired } = fixture();
        const initial = from<Document>({ slot: base }, { actor: 'aaaaaaaaaaaaaaaa' });
        const peer = peerChange(initial);
        const { document: written, splices } = reconcile(clone(initial, { actor: 'cccccccccccccccc' }), base, desired);
        const writerThenPeer = merge(clone(written), clone(peer));
        const peerThenWriter = merge(clone(peer), clone(written));
        const expected = structuredClone(desired);
        expected.markers[1].confidence = 0.99;
        expected.markers.push(row('peer', 60.75, 'user'));

        expectSplices(splices, [{ index: 2, deleteCount: 119 }]);
        expect(writerThenPeer.slot).toStrictEqual(expected);
        expect(peerThenWriter.slot).toStrictEqual(expected);
        expect(objectIds(writerThenPeer)).toStrictEqual(objectIds(peer));
        expect(objectIds(peerThenWriter)).toStrictEqual(objectIds(peer));
    });
});
