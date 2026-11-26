import { change, from, getHeads, type Doc } from '@automerge/automerge';
import { afterEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '../createAutomergeStorage';

type Entry = { tempo: number; label: string };
type EntrySlot = { entries: Record<string, Entry> };

type Mapping = { id: string; cc: number };
type MappingSlot = { mappings: Mapping[]; learning: boolean };

type RootDocument = Record<string, unknown>;
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

function createDocumentPort(initial: RootDocument) {
    let doc: Doc<RootDocument> = from<RootDocument>(initial);
    const port: TestPort = {
        getDoc: () => doc,
        getDocHeads: () => getHeads(doc),
        getSemanticMessage: () => undefined,
        hasDoc: (docId: string) => docId === 'root',
        mutateDoc: ({ changeFn }) => {
            doc = change(doc, (draft) => changeFn(draft));
        },
    };
    return {
        port,
        readEntries: (): Record<string, Entry> => structuredClone((doc.slot as EntrySlot).entries),
        readSlot: (): unknown => structuredClone(doc.slot),
        readMappingIds: (): string[] => (doc.mappings as { mappings: Mapping[] }).mappings.map(({ id }) => id).sort(),
        /** A collaborator's change arriving in the shared document. */
        applyPeerChange: (changeFn: (draft: RootDocument) => void): void => {
            doc = change(doc, changeFn);
        },
    };
}

function entry(tempo: number): Entry {
    return { tempo, label: `entry at ${tempo}` };
}

function createEntryStorage() {
    return createAutomergeStorage<EntrySlot>('root', 'slot', { hydrateMissing: () => ({ entries: {} }) });
}

function readEntries(storage: ReturnType<typeof createEntryStorage>): Record<string, Entry> {
    const value = storage.get();
    if (!value) {
        throw new Error('Expected the store to hold a value');
    }
    return value.entries;
}

function peerEntries(draft: RootDocument): Record<string, Entry> {
    return (draft.slot as EntrySlot).entries;
}

/**
 * `initialEntries` in the document, then a local write that has not flushed,
 * made as a use case makes one: the store's current entries with `edits` applied.
 */
function openPendingWrite(initialEntries: Record<string, Entry>, edits: Record<string, Entry>) {
    const document = createDocumentPort({ slot: { entries: initialEntries } });
    configureAutomergeStoragePort(document.port);
    const storage = createEntryStorage();
    storage.hydrate?.();
    storage.set({ entries: { ...readEntries(storage), ...edits } });
    expect(countPendingAutomergeStorageWrites()).toBe(1);
    return { document, storage };
}

afterEach(() => {
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
});

describe('createAutomergeStorage rebasing a pending write over a peer change', () => {
    it('shows and keeps an entry a peer adds while a local write adding another entry is pending', () => {
        const { document, storage } = openPendingWrite({ A: entry(1) }, { B: entry(2) });

        document.applyPeerChange((draft) => {
            peerEntries(draft).C = entry(3);
        });
        expect(storage.hydrate?.()).toBe(true);

        expect(readEntries(storage)).toEqual({ A: entry(1), B: entry(2), C: entry(3) });
        flushAutomergeStorageWrites();
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        expect(document.readEntries()).toEqual({ A: entry(1), B: entry(2), C: entry(3) });
        expect(readEntries(storage)).toEqual({ A: entry(1), B: entry(2), C: entry(3) });
    });

    it('keeps removed an entry a peer removes that the pending write left untouched', () => {
        const { document, storage } = openPendingWrite({ A: entry(1) }, { B: entry(2) });

        document.applyPeerChange((draft) => {
            delete peerEntries(draft).A;
        });
        storage.hydrate?.();

        expect(readEntries(storage)).toEqual({ B: entry(2) });
        flushAutomergeStorageWrites();
        expect(document.readEntries()).toEqual({ B: entry(2) });
        expect(readEntries(storage)).toEqual({ B: entry(2) });
    });

    it('lets the pending write win a field both sides changed and keeps every field only the peer changed', () => {
        const { document, storage } = openPendingWrite({ A: entry(1), B: entry(2) }, { A: { ...entry(1), tempo: 10 } });

        document.applyPeerChange((draft) => {
            const entries = peerEntries(draft);
            entries.A = { tempo: 20, label: 'peer label' };
            entries.B = entry(30);
        });
        storage.hydrate?.();

        const expected = { A: { tempo: 10, label: 'peer label' }, B: entry(30) };
        expect(readEntries(storage)).toEqual(expected);
        flushAutomergeStorageWrites();
        expect(document.readEntries()).toEqual(expected);
        expect(readEntries(storage)).toEqual(expected);
    });

    it('keeps a pending add when the merge holds a peer row the store sanitizer drops', () => {
        const { document, storage } = openPendingWrite({ A: entry(1) }, { B: entry(2) });
        storage.registerInboundProjector?.(({ value }) => {
            if (value === null) {
                return value;
            }
            const valid = Object.entries(value.entries).filter(([, row]) => typeof row.tempo === 'number');
            return { entries: Object.fromEntries(valid) };
        });

        document.applyPeerChange((draft) => {
            (draft.slot as { entries: Record<string, unknown> }).entries.malformed = { tempo: 'not a tempo' };
        });
        storage.hydrate?.();

        expect(readEntries(storage)).toEqual({ A: entry(1), B: entry(2) });
        flushAutomergeStorageWrites();
        expect(document.readEntries()).toMatchObject({ A: entry(1), B: entry(2) });
        expect(readEntries(storage)).toEqual({ A: entry(1), B: entry(2) });
    });

    it('keeps absent an optional field a peer removes that the pending write left untouched', () => {
        const document = createDocumentPort({ slot: { entries: { A: entry(1) }, note: 'peer note' } });
        configureAutomergeStoragePort(document.port);
        const storage = createAutomergeStorage<EntrySlot & { note?: string }>('root', 'slot', {
            hydrateMissing: () => ({ entries: {} }),
        });
        storage.hydrate?.();
        const current = storage.get();
        if (!current) {
            throw new Error('Expected the store to hold a value');
        }
        storage.set({ ...current, entries: { ...current.entries, B: entry(2) } });

        document.applyPeerChange((draft) => {
            delete (draft.slot as { note?: string }).note;
        });
        storage.hydrate?.();

        expect(storage.get()?.note).toBeUndefined();
        flushAutomergeStorageWrites();
        expect(document.readSlot()).toEqual({ entries: { A: entry(1), B: entry(2) } });
        expect(storage.get()).toEqual({ entries: { A: entry(1), B: entry(2) } });
    });

    it('merges rows by identity in a slot whose durable fields are narrowed by toCrdt', () => {
        const document = createDocumentPort({ mappings: { mappings: [{ id: 'm1', cc: 1 }] } });
        configureAutomergeStoragePort(document.port);
        const storage = createAutomergeStorage<MappingSlot>('root', 'mappings', {
            toCrdt: ({ mappings }) => ({ mappings }),
            fromCrdt: (value) => ({ mappings: value.mappings, learning: false }),
            hydrateMissing: () => ({ mappings: [], learning: false }),
        });
        storage.hydrate?.();
        storage.set({
            mappings: [
                { id: 'm1', cc: 1 },
                { id: 'local', cc: 2 },
            ],
            learning: false,
        });

        document.applyPeerChange((draft) => {
            (draft.mappings as { mappings: Mapping[] }).mappings.push({ id: 'peer', cc: 3 });
        });
        storage.hydrate?.();

        const ids = (): string[] => (storage.get()?.mappings ?? []).map(({ id }) => id).sort();
        expect(ids()).toEqual(['local', 'm1', 'peer']);
        flushAutomergeStorageWrites();
        expect(document.readMappingIds()).toEqual(['local', 'm1', 'peer']);
        expect(ids()).toEqual(['local', 'm1', 'peer']);
    });

    it('keeps the behaviour of a slot that supplies its own rebasePending', () => {
        const document = createDocumentPort({ slot: { entries: { A: entry(1) } } });
        configureAutomergeStoragePort(document.port);
        const storage = createAutomergeStorage<EntrySlot>('root', 'slot', {
            hydrateMissing: () => ({ entries: {} }),
            // The slot's own rule: the pending write's entries replace the document's wholesale.
            rebasePending: ({ pendingValue }) => pendingValue,
        });
        storage.hydrate?.();
        storage.set({ entries: { A: entry(1), B: entry(2) } });

        document.applyPeerChange((draft) => {
            peerEntries(draft).C = entry(3);
        });
        storage.hydrate?.();

        expect(storage.get()?.entries).toEqual({ A: entry(1), B: entry(2) });
    });
});
