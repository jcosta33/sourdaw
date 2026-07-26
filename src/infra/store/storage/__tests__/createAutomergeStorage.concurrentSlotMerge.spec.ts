import { change, clone, from, merge, type Doc } from '@automerge/automerge';
import { describe, it, expect, afterEach } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '../createAutomergeStorage';

type Marker = { id: string; beat: number; name: string; color: string };
type MarkerSlot = { markers: Marker[]; sections: never[] };
type RootDocument = Record<string, unknown> & { markers?: unknown };

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

const defaultSlot: MarkerSlot = { markers: [], sections: [] };

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

function createSlotStorage() {
    return createAutomergeStorage<MarkerSlot>('root', 'markers', {
        hydrateMissing: () => defaultSlot,
    });
}

/** Read the slot, apply one row-level edit, write it back the way every use case does. */
function editPeer(peer: ReturnType<typeof createPeer>, edit: (state: MarkerSlot) => MarkerSlot): void {
    configureAutomergeStoragePort(peer.port);
    const storage = createSlotStorage();
    storage.hydrate?.();
    const state = storage.get() ?? defaultSlot;
    storage.set(edit(state));
    flushAutomergeStorageWrites();
}

function projectMerged(left: ReturnType<typeof createPeer>, right: ReturnType<typeof createPeer>): MarkerSlot {
    const merged = createPeer(merge(clone(left.getDoc()), right.getDoc()));
    configureAutomergeStoragePort(merged.port);
    const storage = createSlotStorage();
    storage.hydrate?.();
    return storage.get() ?? defaultSlot;
}

function marker(id: string, beat: number, name: string): Marker {
    return { id, beat, name, color: '#ffffff' };
}

afterEach(() => {
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
});

describe('createAutomergeStorage concurrent slot merge', () => {
    it('keeps both peers row edits when each edits a different row of one slot', () => {
        const baseline = from<RootDocument>({
            markers: { markers: [marker('marker-1', 0, 'intro'), marker('marker-2', 4, 'verse')], sections: [] },
        });
        const peerA = createPeer(clone(baseline));
        const peerB = createPeer(clone(baseline));

        editPeer(peerA, (state) => ({
            ...state,
            markers: state.markers.map((row) => (row.id === 'marker-1' ? { ...row, name: 'intro renamed by A' } : row)),
        }));
        editPeer(peerB, (state) => ({
            ...state,
            markers: state.markers.map((row) => (row.id === 'marker-2' ? { ...row, name: 'verse renamed by B' } : row)),
        }));

        const merged = projectMerged(peerA, peerB);

        expect(merged.markers.find((row) => row.id === 'marker-1')?.name).toBe('intro renamed by A');
        expect(merged.markers.find((row) => row.id === 'marker-2')?.name).toBe('verse renamed by B');
    });

    it('keeps both peers rows when each appends a different row to one slot', () => {
        const baseline = from<RootDocument>({
            markers: { markers: [marker('marker-1', 0, 'intro')], sections: [] },
        });
        const peerA = createPeer(clone(baseline));
        const peerB = createPeer(clone(baseline));

        editPeer(peerA, (state) => ({ ...state, markers: [...state.markers, marker('from-a', 8, 'bridge')] }));
        editPeer(peerB, (state) => ({ ...state, markers: [...state.markers, marker('from-b', 12, 'outro')] }));

        const merged = projectMerged(peerA, peerB);

        expect(merged.markers.map((row) => row.id).sort()).toStrictEqual(['from-a', 'from-b', 'marker-1']);
    });
});
