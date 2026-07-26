import { change, clone, from, merge, type Doc } from '@automerge/automerge';
import { describe, it, expect, afterEach } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '../createAutomergeStorage';

/**
 * Reordering a collection must not destroy a peer's concurrent edit to a row.
 *
 * Automerge lists resolve concurrent operations by element identity, so writing
 * a whole row value into a list position competes with a peer's concurrent
 * field write on whatever element occupies it and resolves last-writer-wins.
 * A reorder therefore has to move as few elements as it can, and leave every
 * element it does not move untouched — otherwise one user dragging a device up
 * the chain silently discards another user's knob tweak.
 */

type Row = { id: string; name: string };
type RowSlot = { rows: Row[] };

type Device = { id: string; type: string; params: { drive: number } };
type ChainSlot = { devices: Device[] };

type RootDocument = Record<string, unknown> & { slot?: unknown };

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

function createPeer(initialDoc: Doc<RootDocument>) {
    let doc = initialDoc;
    return {
        getDoc: () => doc,
        port: {
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: (docId: string) => docId === 'root',
            mutateDoc: ({ changeFn }: Parameters<TestPort['mutateDoc']>[0]) => {
                doc = change(doc, (draft) => changeFn(draft));
            },
        },
    };
}

function createSlotStorage<TSlot>(empty: () => TSlot) {
    return createAutomergeStorage<TSlot>('root', 'slot', { hydrateMissing: empty });
}

function editPeer<TSlot>(peer: ReturnType<typeof createPeer>, empty: () => TSlot, edit: (state: TSlot) => TSlot): void {
    configureAutomergeStoragePort(peer.port);
    const storage = createSlotStorage(empty);
    storage.hydrate?.();
    const state = storage.get() ?? empty();
    storage.set(edit(structuredClone(state)));
    flushAutomergeStorageWrites();
}

function projectMerged<TSlot>(
    left: ReturnType<typeof createPeer>,
    right: ReturnType<typeof createPeer>,
    empty: () => TSlot
): TSlot {
    const merged = createPeer(merge(clone(left.getDoc()), right.getDoc()));
    configureAutomergeStoragePort(merged.port);
    const storage = createSlotStorage(empty);
    storage.hydrate?.();
    return storage.get() ?? empty();
}

/** The reorder a user performs by dragging one entry to the head of the list. */
function draggedToFront<TRow extends { id: string }>(rows: readonly TRow[], id: string): TRow[] {
    const moved = rows.find((row) => row.id === id);
    if (!moved) {
        throw new Error(`fixture is missing the row ${id}`);
    }
    return [moved, ...rows.filter((row) => row.id !== id)];
}

const emptyRows = (): RowSlot => ({ rows: [] });
const emptyChain = (): ChainSlot => ({ devices: [] });

afterEach(() => {
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
});

describe('createAutomergeStorage concurrent reorder', () => {
    it('keeps a peers row edit when the other peer reorders the collection', () => {
        const baseline = from<RootDocument>({
            slot: {
                rows: [
                    { id: 'a', name: 'a0' },
                    { id: 'b', name: 'b0' },
                    { id: 'c', name: 'c0' },
                ],
            },
        });
        const reorderer = createPeer(clone(baseline));
        const editor = createPeer(clone(baseline));

        // A drags `c` to the front.
        editPeer(reorderer, emptyRows, (state) => ({
            rows: draggedToFront(state.rows, 'c'),
        }));
        // B, concurrently, renames `b` and touches nothing else.
        editPeer(editor, emptyRows, (state) => ({
            rows: state.rows.map((row) => (row.id === 'b' ? { ...row, name: 'renamed by B' } : row)),
        }));

        const merged = projectMerged(reorderer, editor, emptyRows);

        expect(merged.rows.map((row) => row.id)).toStrictEqual(['c', 'a', 'b']);
        expect(merged.rows.find((row) => row.id === 'b')?.name).toBe('renamed by B');
    });

    it('leaves a row whose position does not change untouched by a reorder', () => {
        const baseline = from<RootDocument>({
            slot: {
                rows: [
                    { id: 'a', name: 'a0' },
                    { id: 'b', name: 'b0' },
                    { id: 'c', name: 'c0' },
                ],
            },
        });
        const reorderer = createPeer(clone(baseline));
        const editor = createPeer(clone(baseline));

        // Moving `c` to the front leaves `a` and `b` in the same relative order.
        editPeer(reorderer, emptyRows, (state) => ({
            rows: draggedToFront(state.rows, 'c'),
        }));
        editPeer(editor, emptyRows, (state) => ({
            rows: state.rows.map((row) => (row.id === 'a' ? { ...row, name: 'renamed by B' } : row)),
        }));

        const merged = projectMerged(reorderer, editor, emptyRows);

        expect(merged.rows.map((row) => row.id)).toStrictEqual(['c', 'a', 'b']);
        expect(merged.rows.find((row) => row.id === 'a')?.name).toBe('renamed by B');
    });

    it('loses a concurrent edit to the one row a peer actually moves', () => {
        // Accepted limit, asserted so it cannot drift unnoticed. Automerge
        // resolves list operations by element identity and exposes no move, so
        // relocating a row means removing and re-inserting it, which mints a
        // new element and discards a concurrent edit to that same row. The
        // blast radius is exactly the moved row: every other row survives, as
        // the tests above assert. Closing this needs an explicit order key per
        // row so a reorder becomes a field write, which is a wire-format change
        // and is not in this scope.
        const baseline = from<RootDocument>({
            slot: {
                rows: [
                    { id: 'a', name: 'a0' },
                    { id: 'b', name: 'b0' },
                    { id: 'c', name: 'c0' },
                ],
            },
        });
        const reorderer = createPeer(clone(baseline));
        const editor = createPeer(clone(baseline));

        editPeer(reorderer, emptyRows, (state) => ({
            rows: draggedToFront(state.rows, 'c'),
        }));
        // B edits the very row A is moving.
        editPeer(editor, emptyRows, (state) => ({
            rows: state.rows.map((row) => (row.id === 'c' ? { ...row, name: 'renamed by B' } : row)),
        }));

        const merged = projectMerged(reorderer, editor, emptyRows);

        expect(merged.rows.map((row) => row.id)).toStrictEqual(['c', 'a', 'b']);
        expect(merged.rows.find((row) => row.id === 'c')?.name).toBe('c0');
    });

    it('keeps a knob tweak on a sibling device when the other peer drags a device to the front', () => {
        const baseline = from<RootDocument>({
            slot: {
                devices: [
                    { id: 'dev-eq', type: 'eq', params: { drive: 0 } },
                    { id: 'dev-comp', type: 'comp', params: { drive: 0.1 } },
                    { id: 'dev-drive', type: 'drive', params: { drive: 0.2 } },
                ],
            },
        });
        const dragger = createPeer(clone(baseline));
        const tweaker = createPeer(clone(baseline));

        // A drags the drive pedal to the head of the chain.
        editPeer(dragger, emptyChain, (state) => ({
            devices: draggedToFront(state.devices, 'dev-drive'),
        }));
        // B turns a knob on a sibling device.
        editPeer(tweaker, emptyChain, (state) => ({
            devices: state.devices.map((device) =>
                device.id === 'dev-comp' ? { ...device, params: { drive: 0.9 } } : device
            ),
        }));

        const merged = projectMerged(dragger, tweaker, emptyChain);

        expect(merged.devices.map((device) => device.id)).toStrictEqual(['dev-drive', 'dev-eq', 'dev-comp']);
        expect(merged.devices.find((device) => device.id === 'dev-comp')?.params.drive).toBe(0.9);
    });
});
