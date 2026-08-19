import { change, clone, from, merge, type Doc } from '@automerge/automerge';
import { afterEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';

import { createYeastAutomergeStorage } from '../yeastAutomergeStorage';
import { type YeastProcessorInfo, type YeastState } from '../yeastStore';

type RootDocument = { yeast?: unknown };
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

function createProcessor(id: string): YeastProcessorInfo {
    return { id, type: 'groove', name: id, bypassed: false };
}

function createState(processors: YeastProcessorInfo[]): YeastState {
    return { processors, uiLevel: 1 };
}

function createPeer(initialDoc: Doc<RootDocument>): {
    getDoc: () => Doc<RootDocument>;
    replaceDoc: (doc: Doc<RootDocument>) => void;
    port: TestPort;
} {
    let doc = initialDoc;
    return {
        getDoc: () => doc,
        replaceDoc: (nextDoc) => {
            doc = nextDoc;
        },
        port: {
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: (docId) => docId === 'root',
            mutateDoc: ({ changeFn }) => {
                doc = change(doc, (draft) => changeFn(draft as unknown as Record<string, unknown>));
            },
        },
    };
}

function createStorage() {
    let localState: YeastState | null = null;
    const storage = createYeastAutomergeStorage(() => localState);
    return {
        get: () => storage.get(),
        hydrate: () => {
            const hydrated = storage.hydrate?.() ?? false;
            localState = storage.get();
            return hydrated;
        },
        set: (state: YeastState) => {
            localState = state;
            storage.set(state);
        },
    };
}

function createBaseline(state: YeastState): Doc<RootDocument> {
    const peer = createPeer(from<RootDocument>({}));
    const storage = createStorage();
    configureAutomergeStoragePort(peer.port);
    storage.set(state);
    flushAutomergeStorageWrites();
    return peer.getDoc();
}

describe('Yeast collaboration storage', () => {
    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
    });

    it('preserves concurrent first writes for different processors', () => {
        const empty = from<RootDocument>({});
        const leftPeer = createPeer(clone(empty));
        const rightPeer = createPeer(clone(empty));
        const leftStorage = createStorage();
        const rightStorage = createStorage();

        configureAutomergeStoragePort(leftPeer.port);
        leftStorage.set(createState([createProcessor('left')]));
        flushAutomergeStorageWrites();

        configureAutomergeStoragePort(rightPeer.port);
        rightStorage.set(createState([createProcessor('right')]));
        flushAutomergeStorageWrites();

        const mergedPeer = createPeer(merge(leftPeer.getDoc(), rightPeer.getDoc()));
        const mergedStorage = createStorage();
        configureAutomergeStoragePort(mergedPeer.port);

        expect(mergedStorage.hydrate()).toBe(true);
        expect(mergedStorage.get()?.processors.map((processor) => processor.id)).toEqual(['left', 'right']);
    });

    it('preserves concurrent edits to different processor entities', () => {
        const baseline = createBaseline(createState([createProcessor('left'), createProcessor('right')]));
        const leftPeer = createPeer(clone(baseline));
        const rightPeer = createPeer(clone(baseline));
        const leftStorage = createStorage();
        const rightStorage = createStorage();

        configureAutomergeStoragePort(leftPeer.port);
        leftStorage.hydrate();
        leftStorage.set(createState([{ ...createProcessor('left'), name: 'Left edited' }, createProcessor('right')]));
        flushAutomergeStorageWrites();

        configureAutomergeStoragePort(rightPeer.port);
        rightStorage.hydrate();
        rightStorage.set(createState([createProcessor('left'), { ...createProcessor('right'), bypassed: true }]));
        flushAutomergeStorageWrites();

        const mergedPeer = createPeer(merge(leftPeer.getDoc(), rightPeer.getDoc()));
        const mergedStorage = createStorage();
        configureAutomergeStoragePort(mergedPeer.port);
        mergedStorage.hydrate();

        expect(mergedStorage.get()?.processors).toEqual([
            { ...createProcessor('left'), name: 'Left edited' },
            { ...createProcessor('right'), bypassed: true },
        ]);
    });

    it('rebases a pending local edit over a newly hydrated remote processor', () => {
        const baseline = createBaseline(createState([createProcessor('local')]));
        const localPeer = createPeer(clone(baseline));
        const remotePeer = createPeer(clone(baseline));
        const localStorage = createStorage();
        const remoteStorage = createStorage();

        configureAutomergeStoragePort(remotePeer.port);
        remoteStorage.hydrate();
        remoteStorage.set(createState([createProcessor('local'), createProcessor('remote')]));
        flushAutomergeStorageWrites();

        configureAutomergeStoragePort(localPeer.port);
        localStorage.hydrate();
        localStorage.set(createState([{ ...createProcessor('local'), name: 'Pending local edit' }]));
        localPeer.replaceDoc(merge(localPeer.getDoc(), remotePeer.getDoc()));
        expect(localStorage.hydrate()).toBe(true);
        expect(localStorage.get()?.processors).toEqual([
            { ...createProcessor('local'), name: 'Pending local edit' },
            createProcessor('remote'),
        ]);

        flushAutomergeStorageWrites();
        expect(localStorage.get()?.processors.map((processor) => processor.id)).toEqual(['local', 'remote']);
    });

    it('round-trips a reorder of the processor list through storage', () => {
        // Mirrors what reorderYeastProcessor commits: the same three entities,
        // written back in a new order. A peer that hydrates afterward must see
        // the new order, not a merge that keeps the original positions.
        const baseline = createBaseline(
            createState([createProcessor('a'), createProcessor('b'), createProcessor('c')])
        );
        const peer = createPeer(clone(baseline));
        const storage = createStorage();
        configureAutomergeStoragePort(peer.port);
        storage.hydrate();

        storage.set(createState([createProcessor('b'), createProcessor('c'), createProcessor('a')]));
        flushAutomergeStorageWrites();

        const freshPeer = createPeer(clone(peer.getDoc()));
        const freshStorage = createStorage();
        configureAutomergeStoragePort(freshPeer.port);

        expect(freshStorage.hydrate()).toBe(true);
        expect(freshStorage.get()?.processors.map((processor) => processor.id)).toEqual(['b', 'c', 'a']);
    });

    it('migrates a v1 document (no explicit order) and then preserves a reorder written on top of it', () => {
        // v1 stored no `order` field and decodeProcessors always sorted by id
        // — this is the shape every already-persisted Yeast document has.
        // decodeProcessors must still read it (falling back to id order, the
        // only order v1 ever had), and the next local mutation must migrate
        // it so a SUBSEQUENT reorder actually sticks.
        //
        // Built as TWO changes, not one bulk-assign of `{ b, a }`: assigning
        // a whole object literal in one Automerge change materializes its
        // keys sorted, so a single-change fixture would pass on id order
        // whether or not the entityOrder comparator falls through to the id
        // tiebreak correctly — it could not catch a NaN-from-Infinity bug in
        // that comparator (two order-less entities produce
        // `Infinity - Infinity = NaN`, which `NaN !== 0` sends down the
        // "changed" branch of a delta-based comparator, letting SortCompare
        // coerce it to +0 and never reach the tiebreak). Writing `b` first
        // and appending `a` in a second change instead reproduces how a real
        // v1 document was actually built — add order `b`, then `a` — which
        // is the opposite of id order, so only a comparator that truly falls
        // through to `compareEntityKeys` on a tie decodes it as `['a', 'b']`.
        const v1Doc = from<RootDocument>({});
        const withFirstEntity = change(v1Doc, (draft) => {
            (draft as unknown as { yeast: unknown }).yeast = {
                schemaVersion: 1,
                processors: {
                    b: { deleted: false, value: createProcessor('b') },
                },
            };
        });
        const migrated = change(withFirstEntity, (draft) => {
            const yeast = (draft as unknown as { yeast: { processors: Record<string, unknown> } }).yeast;
            yeast.processors.a = { deleted: false, value: createProcessor('a') };
        });
        const peer = createPeer(clone(migrated));
        const storage = createStorage();
        configureAutomergeStoragePort(peer.port);

        // Read: v1 has no order, so decode falls back to id order.
        expect(storage.hydrate()).toBe(true);
        expect(storage.get()?.processors.map((processor) => processor.id)).toEqual(['a', 'b']);

        // Write: reorder on top of the migrated-in-memory state.
        storage.set(createState([createProcessor('b'), createProcessor('a')]));
        flushAutomergeStorageWrites();

        const freshPeer = createPeer(clone(peer.getDoc()));
        const freshStorage = createStorage();
        configureAutomergeStoragePort(freshPeer.port);
        expect(freshStorage.hydrate()).toBe(true);
        expect(freshStorage.get()?.processors.map((processor) => processor.id)).toEqual(['b', 'a']);
    });

    it('converges a concurrent reorder and a same-row param edit from either merge direction, losing no processor', () => {
        // The generic Automerge-list reconciler cannot survive this shape —
        // see createAutomergeStorage.concurrentReorder.spec.ts's "loses a
        // concurrent edit to the one row a peer actually moves": a list
        // reorder removes and re-inserts the moved element, colliding with a
        // concurrent field write to that same element. The Yeast slot is an
        // id-keyed map with an explicit `order` field instead: a reorder
        // writes only `order`, a param edit writes only `value.params`, and
        // those are different fields on the same map entry, so both survive
        // regardless of merge direction — the property this test pins.
        const baseline = createBaseline(
            createState([createProcessor('a'), createProcessor('b'), createProcessor('c')])
        );

        const reordererPeer = createPeer(clone(baseline));
        const reordererStorage = createStorage();
        configureAutomergeStoragePort(reordererPeer.port);
        reordererStorage.hydrate();
        // A drags `c` to the front of the chain.
        reordererStorage.set(createState([createProcessor('c'), createProcessor('a'), createProcessor('b')]));
        flushAutomergeStorageWrites();

        const tweakerPeer = createPeer(clone(baseline));
        const tweakerStorage = createStorage();
        configureAutomergeStoragePort(tweakerPeer.port);
        tweakerStorage.hydrate();
        // B, concurrently, turns a knob on `c` — the very row A is moving —
        // without reordering anything.
        tweakerStorage.set(
            createState([
                createProcessor('a'),
                createProcessor('b'),
                { ...createProcessor('c'), params: { depth: 0.75 } },
            ])
        );
        flushAutomergeStorageWrites();

        function projectMerged(left: Doc<RootDocument>, right: Doc<RootDocument>): YeastState | undefined {
            const mergedPeer = createPeer(merge(clone(left), right));
            const mergedStorage = createStorage();
            configureAutomergeStoragePort(mergedPeer.port);
            mergedStorage.hydrate();
            return mergedStorage.get() ?? undefined;
        }

        const mergedForward = projectMerged(reordererPeer.getDoc(), tweakerPeer.getDoc());
        const mergedBackward = projectMerged(tweakerPeer.getDoc(), reordererPeer.getDoc());

        for (const merged of [mergedForward, mergedBackward]) {
            // Convergence: both merge directions land on the same order.
            expect(merged?.processors.map((processor) => processor.id)).toEqual(['c', 'a', 'b']);
            // Permutation completeness: exactly the three original ids, no
            // duplicate and none lost.
            expect(new Set(merged?.processors.map((processor) => processor.id)).size).toBe(3);
            // The concurrent param edit on the moved row survives.
            expect(merged?.processors.find((processor) => processor.id === 'c')?.params).toEqual({ depth: 0.75 });
        }
    });
});
