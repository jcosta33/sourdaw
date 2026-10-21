import { change, clone, from, getObjectId, init, load, merge, save, type Doc } from '@automerge/automerge';
import { afterEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '../createAutomergeStorage';
import { reconcileCrdtSlot } from '../reconcileCrdtSlot';

type Row = { id: string; value: number; detail?: { value: number } };
type Slot = Record<string, unknown> & { rows?: Row[] };
type RootDocument = Record<string, unknown> & { slot?: Slot };
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

const fraction = 0.9999999999999999;
const values = [0, fraction, 1.9999999999999998, -fraction, 0.4, 0.9999999999999998];
const subtree = {
    value: fraction,
    nested: { values, emptyMap: {}, emptyList: [], nullable: null, enabled: true, label: 'value' },
};

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

function storageFor(peer: ReturnType<typeof createPeer>) {
    configureAutomergeStoragePort(peer.port);
    const storage = createAutomergeStorage<Slot>('root', 'slot', { hydrateMissing: () => ({}) });
    storage.hydrate?.();
    return storage;
}

function expectPersisted(peer: ReturnType<typeof createPeer>, expected: Slot): void {
    expect(peer.getDoc().slot).toStrictEqual(expected);
    expect(storageFor(peer).get()).toStrictEqual(expected);
    const reopened = createPeer(load<RootDocument>(save(peer.getDoc())));
    expect(reopened.getDoc().slot).toStrictEqual(expected);
    expect(storageFor(reopened).get()).toStrictEqual(expected);
}

afterEach(() => {
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
});

describe('createAutomergeStorage numeric fidelity', () => {
    const materializations: { name: string; initial: RootDocument; desired: Slot }[] = [
        { name: 'missing root slot', initial: {}, desired: { subtree } },
        { name: 'missing deep map and list', initial: { slot: { retained: 1 } }, desired: { retained: 1, subtree } },
        { name: 'primitive array replacement', initial: { slot: { values: [0] } }, desired: { values } },
        {
            name: 'idless array replacement',
            initial: { slot: { values: [{ value: 0 }] } },
            desired: { values: [{ value: fraction }, { nested: subtree }] },
        },
        { name: 'scalar to composite replacement', initial: { slot: { subtree: 0 } }, desired: { subtree } },
        {
            name: 'new identified row',
            initial: { slot: { rows: [] } },
            desired: { rows: [{ id: 'new', value: fraction, detail: { value: fraction } }] },
        },
        { name: 'scalar field update', initial: { slot: { value: 0 } }, desired: { value: fraction } },
    ];

    it.each(materializations)(
        'preserves exact JSON leaves in $name through projection and binary reload',
        ({ initial, desired }) => {
            const peer = createPeer(change(init<RootDocument>(), (draft) => Object.assign(draft, initial)));
            const storage = storageFor(peer);
            storage.set(desired);
            flushAutomergeStorageWrites();

            expectPersisted(peer, desired);
        }
    );

    it('preserves a relocated row and independent peer edits without replacing pinned descendants', () => {
        let baseline = from<RootDocument>({
            slot: {
                rows: [
                    { id: 'a', value: 0 },
                    { id: 'b', value: 0 },
                    { id: 'c', value: 0 },
                ],
            },
        });
        baseline = change(baseline, (draft) => {
            if (!draft.slot?.rows?.[2]) {
                throw new Error('Missing fixture row');
            }
            draft.slot.rows[2].value = fraction;
        });
        const reorderer = createPeer(clone(baseline));
        const editor = createPeer(clone(baseline));
        const originalPinnedId = getObjectId(baseline.slot?.rows?.[1]);
        const reorderStorage = storageFor(reorderer);
        const rows = reorderStorage.get()?.rows;
        if (!rows?.[0] || !rows[1] || !rows[2]) {
            throw new Error('Missing projected fixture rows');
        }
        reorderStorage.set({ rows: [rows[2], rows[0], rows[1], { id: 'new', value: fraction }] });
        flushAutomergeStorageWrites();
        expect(getObjectId(reorderer.getDoc().slot?.rows?.[2])).toBe(originalPinnedId);

        const editorStorage = storageFor(editor);
        editorStorage.set({
            rows: [
                { id: 'a', value: 0 },
                { id: 'b', value: 0, detail: { value: fraction } },
                { id: 'c', value: fraction },
                { id: 'foreign', value: fraction },
            ],
        });
        flushAutomergeStorageWrites();
        const foreignDetailId = getObjectId(editor.getDoc().slot?.rows?.[1]?.detail);
        const merged = createPeer(merge(clone(reorderer.getDoc()), editor.getDoc()));
        const mergedRows = merged.getDoc().slot?.rows;
        expect(mergedRows?.map((row) => row.id).sort()).toStrictEqual(['a', 'b', 'c', 'foreign', 'new']);
        expect(mergedRows?.find((row) => row.id === 'c')?.value).toBe(fraction);
        expect(mergedRows?.find((row) => row.id === 'new')?.value).toBe(fraction);
        expect(mergedRows?.find((row) => row.id === 'foreign')?.value).toBe(fraction);
        expect(mergedRows?.find((row) => row.id === 'b')?.detail?.value).toBe(fraction);
        expect(getObjectId(mergedRows?.find((row) => row.id === 'b')?.detail)).toBe(foreignDetailId);
        const expected = structuredClone(storageFor(merged).get());
        if (!expected) {
            throw new Error('Missing merged projection');
        }
        expectPersisted(merged, expected);
    });

    it.each(['map', 'row'] as const)('lands an unchanged stranded %s seed without reviving peer deletions', (kind) => {
        const initial: Slot = { retained: 1, rows: [] };
        const seed = kind === 'map' ? { subtree } : { rows: [{ id: 'seed', value: fraction }] };
        const desired: Slot = { ...initial, ...seed, deletedByPeer: { value: fraction } };
        const doc = change(from<RootDocument>({ slot: initial }), (draft) => {
            reconcileCrdtSlot({
                doc: draft,
                key: 'slot',
                baseValue: desired,
                value: desired,
                documentPresence: { slot: { ...initial, deletedByPeer: { value: fraction } } },
            });
        });

        expectPersisted(createPeer(doc), { ...initial, ...seed });
    });
});
