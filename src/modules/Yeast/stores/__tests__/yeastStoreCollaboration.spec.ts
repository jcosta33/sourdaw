import { change, clone, from, getHeads, merge, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { executeAppAction, undo } from '#/modules/Command/useCases';

import { createYeastAutomergeStorage } from '../yeastAutomergeStorage';
import { setActiveYeastDevice, yeastStore, type YeastProcessorInfo, type YeastState } from '../yeastStore';

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
    // One device id for every peer in this suite: these tests exercise the
    // per-rack merge semantics, which are per device since issue #2422 scoped
    // the slot into `racks[deviceId]`.
    const deviceId = 'device-collab';
    const storage = createYeastAutomergeStorage({
        getLocalState: () => localState,
        getActiveDeviceId: () => deviceId,
        resolveFirstYeastDeviceId: () => deviceId,
    });
    return {
        get: () => storage.storage.get(),
        hydrate: () => {
            const hydrated = storage.storage.hydrate?.() ?? false;
            localState = storage.storage.get();
            return hydrated;
        },
        set: (state: YeastState) => {
            localState = state;
            storage.storage.set(state);
        },
        clear: () => {
            localState = null;
            storage.storage.clear();
        },
        // Flushes ONLY this view's pending write. The module-wide
        // flushAutomergeStorageWrites() would also commit every other peer
        // storage's unflushed pending — against whichever port is configured.
        flushPending: () => {
            storage.flushPendingRackWrite();
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

    it('deletes the active Yeast slot when storage is cleared', () => {
        const peer = createPeer(from<RootDocument>({}));
        const storage = createStorage();
        configureAutomergeStoragePort(peer.port);
        storage.set(createState([createProcessor('processor')]));
        storage.flushPending();
        expect(peer.getDoc()).toHaveProperty('yeast');

        storage.clear();
        storage.flushPending();

        expect(peer.getDoc()).not.toHaveProperty('yeast');
        expect(storage.get()).toBeNull();
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

    it('does not change the document when processor params are logically unchanged', () => {
        const peer = createPeer(from<RootDocument>({}));
        const storage = createStorage();
        configureAutomergeStoragePort(peer.port);
        storage.set(createState([{ ...createProcessor('processor'), params: { zeta: 1, alpha: 2 } }]));
        flushAutomergeStorageWrites();
        const headsBeforeNoOp = getHeads(peer.getDoc());

        storage.set(createState([{ ...createProcessor('processor'), params: { zeta: 1, alpha: 2 } }]));
        flushAutomergeStorageWrites();

        expect(getHeads(peer.getDoc())).toEqual(headsBeforeNoOp);
    });

    it('merges concurrent edits to different params on one processor', () => {
        const baseline = createBaseline(
            createState([{ ...createProcessor('processor'), params: { rate: 1, depth: 2 } }])
        );
        const leftPeer = createPeer(clone(baseline));
        const rightPeer = createPeer(clone(baseline));
        const leftStorage = createStorage();
        const rightStorage = createStorage();

        configureAutomergeStoragePort(leftPeer.port);
        leftStorage.hydrate();
        leftStorage.set(createState([{ ...createProcessor('processor'), params: { rate: 9, depth: 2 } }]));
        flushAutomergeStorageWrites();

        configureAutomergeStoragePort(rightPeer.port);
        rightStorage.hydrate();
        rightStorage.set(createState([{ ...createProcessor('processor'), params: { rate: 1, depth: 8 } }]));
        flushAutomergeStorageWrites();

        for (const merged of [
            merge(clone(leftPeer.getDoc()), rightPeer.getDoc()),
            merge(clone(rightPeer.getDoc()), leftPeer.getDoc()),
        ]) {
            const mergedPeer = createPeer(merged);
            const mergedStorage = createStorage();
            configureAutomergeStoragePort(mergedPeer.port);
            mergedStorage.hydrate();

            expect(mergedStorage.get()?.processors[0]?.params).toEqual({ rate: 9, depth: 8 });
        }
    });

    it('merges concurrent first param keys on a processor that had none', () => {
        // Issue #3186: a processor flushed without `params` used to omit the
        // map field. Each peer's first key then assigned a whole map, and
        // Automerge last-writer-wins dropped the other key.
        const baseline = createBaseline(createState([createProcessor('processor')]));
        const leftPeer = createPeer(clone(baseline));
        const rightPeer = createPeer(clone(baseline));
        const leftStorage = createStorage();
        const rightStorage = createStorage();

        configureAutomergeStoragePort(leftPeer.port);
        leftStorage.hydrate();
        leftStorage.set(createState([{ ...createProcessor('processor'), params: { rate: 9 } }]));
        flushAutomergeStorageWrites();

        configureAutomergeStoragePort(rightPeer.port);
        rightStorage.hydrate();
        rightStorage.set(createState([{ ...createProcessor('processor'), params: { depth: 8 } }]));
        flushAutomergeStorageWrites();

        for (const merged of [
            merge(clone(leftPeer.getDoc()), rightPeer.getDoc()),
            merge(clone(rightPeer.getDoc()), leftPeer.getDoc()),
        ]) {
            const mergedPeer = createPeer(merged);
            const mergedStorage = createStorage();
            configureAutomergeStoragePort(mergedPeer.port);
            mergedStorage.hydrate();

            expect(mergedStorage.get()?.processors[0]?.params).toEqual({ rate: 9, depth: 8 });
        }
    });

    it('keeps an empty params map after clearing so concurrent first keys still merge', () => {
        const withKeys = createBaseline(
            createState([{ ...createProcessor('processor'), params: { rate: 1, depth: 2 } }])
        );
        const clearerPeer = createPeer(clone(withKeys));
        const clearerStorage = createStorage();
        configureAutomergeStoragePort(clearerPeer.port);
        clearerStorage.hydrate();
        clearerStorage.set(createState([createProcessor('processor')]));
        flushAutomergeStorageWrites();

        const cleared = clearerPeer.getDoc();
        const leftPeer = createPeer(clone(cleared));
        const rightPeer = createPeer(clone(cleared));
        const leftStorage = createStorage();
        const rightStorage = createStorage();

        configureAutomergeStoragePort(leftPeer.port);
        leftStorage.hydrate();
        leftStorage.set(createState([{ ...createProcessor('processor'), params: { rate: 9 } }]));
        flushAutomergeStorageWrites();

        configureAutomergeStoragePort(rightPeer.port);
        rightStorage.hydrate();
        rightStorage.set(createState([{ ...createProcessor('processor'), params: { depth: 8 } }]));
        flushAutomergeStorageWrites();

        for (const merged of [
            merge(clone(leftPeer.getDoc()), rightPeer.getDoc()),
            merge(clone(rightPeer.getDoc()), leftPeer.getDoc()),
        ]) {
            const mergedPeer = createPeer(merged);
            const mergedStorage = createStorage();
            configureAutomergeStoragePort(mergedPeer.port);
            mergedStorage.hydrate();

            expect(mergedStorage.get()?.processors[0]?.params).toEqual({ rate: 9, depth: 8 });
        }
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

    it('rebases a pending local reorder over a newly hydrated remote field edit', () => {
        const baseline = createBaseline(
            createState([createProcessor('a'), createProcessor('b'), createProcessor('c')])
        );
        const localPeer = createPeer(clone(baseline));
        const remotePeer = createPeer(clone(baseline));
        const localStorage = createStorage();
        const remoteStorage = createStorage();

        configureAutomergeStoragePort(remotePeer.port);
        remoteStorage.hydrate();
        remoteStorage.set(
            createState([
                createProcessor('a'),
                { ...createProcessor('b'), name: 'Remote renamed' },
                createProcessor('c'),
            ])
        );
        flushAutomergeStorageWrites();

        configureAutomergeStoragePort(localPeer.port);
        localStorage.hydrate();
        localStorage.set(createState([createProcessor('c'), createProcessor('a'), createProcessor('b')]));
        localPeer.replaceDoc(merge(localPeer.getDoc(), remotePeer.getDoc()));
        expect(localStorage.hydrate()).toBe(true);
        expect(localStorage.get()?.processors).toEqual([
            createProcessor('c'),
            createProcessor('a'),
            { ...createProcessor('b'), name: 'Remote renamed' },
        ]);
    });

    it('keeps a newer remote field edit over an already rebased pending reorder', () => {
        // Issue #3183: the first hydrate rebases the pending reorder [c, a, b]
        // and absorbs the remote b.name B1 into the pending value, but the
        // pending's base stayed at the original set() snapshot. The next
        // hydrate then read base b = 'b' vs pending b = B1 as a LOCAL edit and
        // replayed the stale B1 over the newer remote B2.
        const baseline = createBaseline(
            createState([createProcessor('a'), createProcessor('b'), createProcessor('c')])
        );
        const localPeer = createPeer(clone(baseline));
        const remotePeer = createPeer(clone(baseline));
        const localStorage = createStorage();
        const remoteStorage = createStorage();

        configureAutomergeStoragePort(remotePeer.port);
        remoteStorage.hydrate();
        remoteStorage.set(
            createState([createProcessor('a'), { ...createProcessor('b'), name: 'B1' }, createProcessor('c')])
        );
        remoteStorage.flushPending();

        configureAutomergeStoragePort(localPeer.port);
        localStorage.hydrate();
        localStorage.set(createState([createProcessor('c'), createProcessor('a'), createProcessor('b')]));
        localPeer.replaceDoc(merge(localPeer.getDoc(), remotePeer.getDoc()));
        expect(localStorage.hydrate()).toBe(true);
        expect(localStorage.get()?.processors).toEqual([
            createProcessor('c'),
            createProcessor('a'),
            { ...createProcessor('b'), name: 'B1' },
        ]);

        configureAutomergeStoragePort(remotePeer.port);
        remoteStorage.set(
            createState([createProcessor('a'), { ...createProcessor('b'), name: 'B2' }, createProcessor('c')])
        );
        remoteStorage.flushPending();

        configureAutomergeStoragePort(localPeer.port);
        localPeer.replaceDoc(merge(localPeer.getDoc(), remotePeer.getDoc()));
        expect(localStorage.hydrate()).toBe(true);
        expect(localStorage.get()?.processors).toEqual([
            createProcessor('c'),
            createProcessor('a'),
            { ...createProcessor('b'), name: 'B2' },
        ]);
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

// ── Undo against a concurrent peer (#2111) ──────────────────────────────────
//
// The collaboration constraint the guarded Yeast actions exist for: a peer's
// edit to a DIFFERENT processor (or a different key of the same one) never
// blocks a local undo, while a diverged SAME key refuses instead of silently
// overwriting the peer. The peer arrives the way a real hydrate does — its
// document merge lands in the port, and the store re-hydrates over it.

const UNDO_DEVICE_ID = 'device-undo';

const notifyUserMock = vi.hoisted(() => vi.fn());
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: notifyUserMock }));

type PersistedUndoRack = { processors: Record<string, { value: YeastProcessorInfo }> };
type PersistedUndoYeast = { yeast: { racks: Record<string, PersistedUndoRack> } };

function paramProcessor(id: string, params: Record<string, number>): YeastProcessorInfo {
    return { id, type: 'filter', name: id, bypassed: false, params };
}

describe('Yeast undo against a concurrent peer (#2111)', () => {
    let document: Doc<RootDocument>;

    function peerRenames(doc: Doc<RootDocument>, processorId: string, name: string): Doc<RootDocument> {
        return change(clone(doc), (draft) => {
            const yeast = (draft as unknown as PersistedUndoYeast).yeast;
            for (const rack of Object.values(yeast.racks)) {
                const entry = rack.processors[processorId];
                if (entry) {
                    entry.value.name = name;
                }
            }
        });
    }

    function peerWritesParam(
        doc: Doc<RootDocument>,
        processorId: string,
        paramId: string,
        value: number
    ): Doc<RootDocument> {
        return change(clone(doc), (draft) => {
            const yeast = (draft as unknown as PersistedUndoYeast).yeast;
            for (const rack of Object.values(yeast.racks)) {
                const entry = rack.processors[processorId];
                if (entry?.value.params) {
                    entry.value.params[paramId] = value;
                }
            }
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        notifyUserMock.mockClear();
        undoHistoryStore.set({ past: [], future: [] });
        document = from({});
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                document = change(document, (draft) => changeFn(draft as unknown as Record<string, unknown>));
            },
        });
        yeastStore.hydrate();
        setActiveYeastDevice(UNDO_DEVICE_ID);
        yeastStore.set({
            processors: [paramProcessor('mine', { gate: 0.8 }), paramProcessor('theirs', { gate: 0.6 })],
            uiLevel: 3,
        });
        flushAutomergeStorageWrites();

        clearHandlerRegistry();
        for (const handlerMap of getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true })) {
            registerHandlerMap(handlerMap);
        }
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        setActiveYeastDevice(null);
        clearHandlerRegistry();
    });

    it('undoes a param edit while a peer renamed a DIFFERENT processor: both survive', async () => {
        await executeAppAction({
            type: 'setYeastProcessorParam',
            payload: { processorId: 'mine', paramId: 'gate', value: 1.4, expectedValue: 0.8 },
        });

        // A peer renames 'theirs' concurrently; the merged doc re-hydrates.
        const peerDoc = peerRenames(document, 'theirs', 'Theirs renamed');
        document = merge(document, peerDoc);
        yeastStore.hydrate();
        expect(yeastStore.value?.processors.find((processor) => processor.id === 'theirs')?.name).toBe(
            'Theirs renamed'
        );

        const result = await undo();

        expect(result.headConsumed).toBe(true);
        // The undo landed…
        expect(yeastStore.value?.processors.find((processor) => processor.id === 'mine')?.params?.gate).toBe(0.8);
        // …and the peer's rename survived it.
        expect(yeastStore.value?.processors.find((processor) => processor.id === 'theirs')?.name).toBe(
            'Theirs renamed'
        );
    });

    it('refuses an undo whose key a peer diverged, retaining the entry on past', async () => {
        await executeAppAction({
            type: 'setYeastProcessorParam',
            payload: { processorId: 'mine', paramId: 'gate', value: 1.4, expectedValue: 0.8 },
        });

        // A peer writes the SAME key concurrently.
        const peerDoc = peerWritesParam(document, 'mine', 'gate', 0.5);
        document = merge(document, peerDoc);
        yeastStore.hydrate();
        expect(yeastStore.value?.processors.find((processor) => processor.id === 'mine')?.params?.gate).toBe(0.5);

        const result = await undo();

        expect(result.headConsumed).toBe(false);
        // The peer's value stands and the undo entry stays retryable on past.
        expect(yeastStore.value?.processors.find((processor) => processor.id === 'mine')?.params?.gate).toBe(0.5);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        // The refusal was reported to the user, not swallowed.
        expect(notifyUserMock).toHaveBeenCalledWith(expect.stringContaining('Cannot undo'), 'warning');
    });
});
