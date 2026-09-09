import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '../createStore';
import {
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
    runWithAutomergeStorageTransaction,
} from '../storage/createAutomergeStorage';
import { createMemoryStorage } from '../storage/createMemoryStorage';

/**
 * A sanitizer is a READ-side guard, not an authority over shared truth.
 *
 * Row validators in this codebase are structural and version-blind, and no
 * protocol version is negotiated anywhere in the sync layer. So a peer running
 * a build whose validator still requires a field a newer build has removed
 * rejects every row that lacks it. Rejecting is correct — an unreadable row
 * must not reach downstream readers. Writing the rejection back into the
 * shared document is not: it deletes, for every peer, rows that a peer on
 * another build reads perfectly well.
 *
 * The same argument covers genuinely corrupt data. Unilaterally rewriting a
 * shared document from one replica's opinion fights the CRDT: refusing to
 * display a bad row costs nothing and converges, broadcasting a repair does
 * not.
 *
 * `hydrate()` already honours this for the absent-slot case — see the
 * projection-purity note in createAutomergeStorage. Sanitization was the same
 * mistake in a second place.
 */

type LaneRow = { id: string; value: number; legacy?: string };
type LaneState = { lanes: LaneRow[] };
type TestDoc = { [key: string]: unknown };
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

function createTestPort(initialDoc: TestDoc): {
    doc: TestDoc;
    port: TestPort;
    /** Model a remote change landing: the slot moved without this replica writing it. */
    bumpHeads: () => void;
} {
    const doc = initialDoc;
    let headsCounter = 0;
    const port: TestPort = {
        getDoc: () => doc,
        getDocHeads: () => [`head-${headsCounter}`],
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            changeFn(doc);
            headsCounter += 1;
        },
    };
    return {
        doc,
        port,
        bumpHeads: () => {
            headsCounter += 1;
        },
    };
}

function isLaneRow(value: unknown): value is LaneRow {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as LaneRow).id === 'string' &&
        typeof (value as LaneRow).value === 'number'
    );
}

/** The build that removed `legacy`: it no longer requires the field. */
function sanitizeAsCurrentBuild(value: unknown): LaneState {
    const lanes = (value as LaneState | null)?.lanes;
    if (!Array.isArray(lanes)) {
        return { lanes: [] };
    }
    return { lanes: lanes.filter(isLaneRow).map((lane) => ({ id: lane.id, value: lane.value })) };
}

/** The older build: its validator still requires `legacy`, so rows written by
 *  the newer build fail every one of them. */
function sanitizeAsOlderBuild(value: unknown): LaneState {
    const lanes = (value as LaneState | null)?.lanes;
    if (!Array.isArray(lanes)) {
        return { lanes: [] };
    }
    const accepted = lanes.filter((lane): lane is LaneRow => isLaneRow(lane) && typeof lane.legacy === 'string');
    return { lanes: accepted.map((lane) => ({ id: lane.id, value: lane.value, legacy: lane.legacy })) };
}

describe('createStore sanitization against a shared document', () => {
    beforeEach(() => {
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn(() => 1)
        );
        vi.stubGlobal(
            'cancelAnimationFrame',
            vi.fn(() => undefined)
        );
        configureAutomergeStoragePort(null);
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        vi.unstubAllGlobals();
    });

    it('lets a peer whose validator rejects a row keep it readable for a peer that accepts it', () => {
        const { doc, port } = createTestPort({ lanes: { lanes: [{ id: 'lane-1', value: 7 }] } });
        configureAutomergeStoragePort(port);

        // The peer on the older build projects the shared slot. Its validator
        // requires `legacy`, so the row fails.
        const olderPeerStore = createStore<LaneState>({
            storage: createAutomergeStorage<LaneState>('root', 'lanes'),
            sanitize: sanitizeAsOlderBuild,
        });
        olderPeerStore.hydrate();
        flushAutomergeStorageWrites();

        // Rejecting is correct: the older peer must not surface a row it
        // cannot read.
        expect(olderPeerStore.value).toEqual({ lanes: [] });

        // Destroying it for everyone is not. The row is still in the document.
        expect(doc.lanes).toEqual({ lanes: [{ id: 'lane-1', value: 7 }] });

        // And a peer on the current build still reads it.
        const currentPeerStore = createStore<LaneState>({
            storage: createAutomergeStorage<LaneState>('root', 'lanes'),
            sanitize: sanitizeAsCurrentBuild,
        });
        currentPeerStore.hydrate();

        expect(currentPeerStore.value).toEqual({ lanes: [{ id: 'lane-1', value: 7 }] });
    });

    it('keeps a field the local build does not know rather than stripping it from the document', () => {
        // The reverse direction: a row carrying a field this build has never
        // heard of. The rebuild strips it for the local read view, which is
        // fine — writing the stripped row back deletes the field for the peer
        // that authored it, which is the same loss at field granularity.
        const { doc, port } = createTestPort({
            lanes: { lanes: [{ id: 'lane-1', value: 7, unknownFutureField: 'from-newer-build' }] },
        });
        configureAutomergeStoragePort(port);

        const store = createStore<LaneState>({
            storage: createAutomergeStorage<LaneState>('root', 'lanes'),
            sanitize: sanitizeAsCurrentBuild,
        });
        store.hydrate();
        flushAutomergeStorageWrites();

        expect(store.value).toEqual({ lanes: [{ id: 'lane-1', value: 7 }] });
        expect(doc.lanes).toEqual({ lanes: [{ id: 'lane-1', value: 7, unknownFutureField: 'from-newer-build' }] });
    });

    it('still repairs backing storage that no peer can see', () => {
        // Local-only storage has no peer to lose and repair is the whole
        // point, so the write-back must survive there.
        const storage = createMemoryStorage<LaneState>();
        storage.set({ lanes: [{ id: 'lane-1', value: 7 }, 'corrupt' as unknown as LaneRow] });

        const store = createStore<LaneState>({
            storage,
            sanitize: sanitizeAsCurrentBuild,
        });

        expect(store.value).toEqual({ lanes: [{ id: 'lane-1', value: 7 }] });
        expect(storage.get()).toEqual({ lanes: [{ id: 'lane-1', value: 7 }] });
    });

    it('reports the store slot whose content a sanitizer withheld from readers', () => {
        const { port } = createTestPort({ lanes: { lanes: [{ id: 'lane-1', value: 7 }] } });
        configureAutomergeStoragePort(port);
        const warn = vi.fn();
        const logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(), setWriters: vi.fn() };

        const store = createStore<LaneState>({
            storage: createAutomergeStorage<LaneState>('root', 'lanes'),
            sanitize: sanitizeAsOlderBuild,
            logger,
        });
        store.hydrate();

        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('quarantined');
    });

    it('delivers a local edit that was in flight while a sanitizer quarantined content', () => {
        // Quarantining is a read-side act, so it must not look like a commit to
        // an unflushed local write. The supersede guard abandons an unscoped
        // pending whose revision predates the newest committed value; if
        // quarantining advances that high-water mark, the guard fires with no
        // commit behind it and the user's edit is dropped on the floor while
        // `store.value` still shows it.
        const { doc, port } = createTestPort({ lanes: { lanes: [{ id: 'lane-1', value: 7 }] } });
        configureAutomergeStoragePort(port);
        const store = createStore<LaneState>({
            storage: createAutomergeStorage<LaneState>('root', 'lanes'),
            sanitize: sanitizeAsOlderBuild,
        });

        // A local edit the user has authored but whose rAF has not fired.
        store.set({ lanes: [{ id: 'lane-2', value: 2, legacy: 'kept' }] });
        // A sync message lands and is projected, quarantining lane-1.
        store.hydrate();
        flushAutomergeStorageWrites();

        expect(store.value).toEqual({ lanes: [{ id: 'lane-2', value: 2, legacy: 'kept' }] });

        // The store shows less than the document holds, and that gap is the
        // whole point of quarantining. The local edit has to reach the
        // document, and the row this build could not read has to survive there
        // — a write expresses the rows its author actually changed, so a row
        // the author never had in hand is not something it can delete.
        const lanes = (doc.lanes as LaneState).lanes;
        expect(lanes).toContainEqual({ id: 'lane-2', value: 2, legacy: 'kept' });
        expect(lanes).toContainEqual({ id: 'lane-1', value: 7 });
    });

    it('does not let a pending write the hydrate just rebased outrank the sanitizer', () => {
        // `toCrdt` strips a field on its way to the document — the documented
        // reason the option exists — so the slot legitimately carries fewer
        // keys than the store's own value. To stop a hydrate discarding the
        // stripped fields, the rebase re-supplies them from the pending write:
        // `{ ...pendingValue, ...crdtData }`. That blend is neither what the
        // user authored nor what the document holds, and it can be a
        // combination that is invalid while both halves are valid alone.
        //
        // The sanitizer sees the blend and rejects it. Its verdict then has to
        // survive: the pending write is a real armed rAF write, and `sanitize`
        // is never consulted on the commit path, so a rejected blend that
        // stays in the pending reaches the shared document unexamined.
        type PunchState = { punchInBeat: number; punchOutBeat: number };

        const stripPunchIn = (value: PunchState): PunchState => {
            const { punchInBeat: _ephemeral, ...persisted } = value;
            return persisted as PunchState;
        };
        const sanitizePunch = (value: unknown): PunchState => {
            const record = value as Partial<PunchState> | null;
            const punchInBeat = typeof record?.punchInBeat === 'number' ? record.punchInBeat : 0;
            const punchOutBeat = typeof record?.punchOutBeat === 'number' ? record.punchOutBeat : 1;
            if (punchOutBeat <= punchInBeat) {
                return { punchInBeat: 0, punchOutBeat: 1 };
            }
            return { punchInBeat, punchOutBeat };
        };

        const { doc, port, bumpHeads } = createTestPort({ punch: { punchOutBeat: 4 } });
        configureAutomergeStoragePort(port);
        const store = createStore<PunchState>({
            storage: createAutomergeStorage<PunchState>('root', 'punch', { toCrdt: stripPunchIn }),
            sanitize: sanitizePunch,
        });

        // Authored locally, still in flight. Valid: 8 < 10.
        store.set({ punchInBeat: 8, punchOutBeat: 10 });
        // A remote change lands. Valid: the absent punch-in reads as 0 < 5.
        doc.punch = { punchOutBeat: 5 };
        bumpHeads();
        // The rebase blends them into { punchInBeat: 8, punchOutBeat: 5 } — a
        // punch region that ends before it starts.
        store.hydrate();
        flushAutomergeStorageWrites();

        expect(store.value).toEqual({ punchInBeat: 0, punchOutBeat: 1 });
        // The armed write must not carry the combination the sanitizer refused.
        expect(doc.punch).toEqual({ punchOutBeat: 1 });
    });

    it('does not let constructor sanitization of a visible successor replace a committed clear baseline', () => {
        type CountState = { count: number };
        const doc: TestDoc = { state: { count: 7 } };
        let afterPublication: (() => void) | undefined;
        const port: TestPort = {
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                const candidate = structuredClone(doc);
                changeFn(candidate);
                for (const key of Object.keys(doc)) {
                    delete doc[key];
                }
                Object.assign(doc, candidate);
                const listener = afterPublication;
                afterPublication = undefined;
                listener?.();
            },
        };
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<CountState>('root', 'state', {
            hydrateMissing: () => ({ count: 0 }),
        });
        expect(storage.hydrate?.()).toBe(true);
        let successor: ReturnType<typeof runWithAutomergeStorageTransaction> | undefined;
        let store: ReturnType<typeof createStore<CountState>> | undefined;
        const clearing = runWithAutomergeStorageTransaction(undefined, () => {
            storage.clear();
        });
        afterPublication = () => {
            successor = runWithAutomergeStorageTransaction(undefined, () => {
                storage.set({ count: 1 });
            });
            store = createStore({
                storage,
                sanitize: (value) => (value === null ? null : { count: value.count }),
            });
        };

        clearing.commit();

        expect(store?.value).toEqual({ count: 1 });
        expect(Object.hasOwn(doc, 'state')).toBe(false);
        expect(countPendingAutomergeStorageWrites()).toBe(1);
        successor?.abort();
        expect(store?.value).toBeNull();
        expect(Object.hasOwn(doc, 'state')).toBe(false);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('preserves a fully settled clear beneath a sanitized optimistic successor', () => {
        type CountState = { count: number };
        const { doc, port } = createTestPort({ state: { count: 7 } });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<CountState>('root', 'state', {
            hydrateMissing: () => ({ count: 0 }),
        });
        expect(storage.hydrate?.()).toBe(true);
        const clearing = runWithAutomergeStorageTransaction(undefined, () => storage.clear());
        clearing.commit();
        expect(Object.hasOwn(doc, 'state')).toBe(false);
        expect(storage.get()).toBeNull();

        const successor = runWithAutomergeStorageTransaction(undefined, () => storage.set({ count: 1 }));
        const store = createStore({
            storage,
            sanitize: (value) => (value === null ? null : { count: value.count }),
        });

        successor.abort();

        expect(store.value).toBeNull();
        expect(Object.hasOwn(doc, 'state')).toBe(false);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('guards hydrated authority independently from a visible pending write', () => {
        const { doc, port } = createTestPort({ lanes: { lanes: [{ id: 'lane-1', value: 7 }] } });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<LaneState>('root', 'lanes');
        const store = createStore({ storage, sanitize: sanitizeAsOlderBuild });
        const successor = runWithAutomergeStorageTransaction(undefined, () => {
            store.set({ lanes: [{ id: 'lane-2', value: 2, legacy: 'kept' }] });
        });

        store.hydrate();
        successor.abort();

        expect(store.value).toEqual({ lanes: [] });
        expect(doc.lanes).toEqual({ lanes: [{ id: 'lane-1', value: 7 }] });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('guards a retained decoded baseline when a store registers after hydration', () => {
        const { doc, port } = createTestPort({ lanes: { lanes: [{ id: 'lane-1', value: 7 }] } });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<LaneState>('root', 'lanes');
        expect(storage.hydrate?.()).toBe(true);
        const successor = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ lanes: [{ id: 'lane-2', value: 2, legacy: 'kept' }] });
        });

        const store = createStore({ storage, sanitize: sanitizeAsOlderBuild });
        successor.abort();

        expect(store.value).toEqual({ lanes: [] });
        expect(doc.lanes).toEqual({ lanes: [{ id: 'lane-1', value: 7 }] });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('guards a partial-wire hydrated baseline before an optimistic punch edit aborts', () => {
        type PunchState = { punchInBeat: number; punchOutBeat: number };
        const { doc, port } = createTestPort({ punch: { punchOutBeat: 5 } });
        configureAutomergeStoragePort(port);
        const sanitizePunch = (value: unknown): PunchState => {
            const record = value as Partial<PunchState> | null;
            const punchInBeat = typeof record?.punchInBeat === 'number' ? record.punchInBeat : 0;
            const punchOutBeat = typeof record?.punchOutBeat === 'number' ? record.punchOutBeat : 1;
            return punchOutBeat > punchInBeat ? { punchInBeat, punchOutBeat } : { punchInBeat: 0, punchOutBeat: 1 };
        };
        const storage = createAutomergeStorage<PunchState>('root', 'punch', {
            toCrdt: ({ punchOutBeat }) => ({ punchOutBeat }),
        });
        const store = createStore({ storage, sanitize: sanitizePunch });
        const successor = runWithAutomergeStorageTransaction(undefined, () => {
            store.set({ punchInBeat: 8, punchOutBeat: 10 });
        });

        store.hydrate();
        successor.abort();

        expect(store.value).toEqual({ punchInBeat: 0, punchOutBeat: 1 });
        expect(doc.punch).toEqual({ punchOutBeat: 5 });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('guards a missing default before it becomes the baseline beneath an optimistic successor', () => {
        type CountState = { count: number };
        const { doc, port, bumpHeads } = createTestPort({ state: { count: 7 } });
        configureAutomergeStoragePort(port);
        const error = vi.fn();
        const storage = createAutomergeStorage<CountState>('root', 'state', {
            hydrateMissing: () => ({ count: 0 }),
        });
        expect(storage.hydrate?.()).toBe(true);
        const store = createStore({
            storage,
            initialData: { count: 9 },
            logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error, setWriters: vi.fn() },
            sanitize: (value) => {
                if (value?.count === 0) {
                    throw new Error('default rejected');
                }
                return value;
            },
        });
        const successor = runWithAutomergeStorageTransaction(undefined, () => store.set({ count: 1 }));
        delete doc.state;
        bumpHeads();

        store.hydrate();
        successor.abort();

        expect(store.value).toEqual({ count: 9 });
        expect(Object.hasOwn(doc, 'state')).toBe(false);
        expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'Store sanitization failed' }));
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('uses the configured fallback when an intervening publication cannot be sanitized', () => {
        type CountState = { count: number };
        const doc: TestDoc = { state: { count: 0 } };
        let publishInterveningValue = false;
        let mutationCount = 0;
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                changeFn(doc);
                mutationCount += 1;
                if (publishInterveningValue) {
                    publishInterveningValue = false;
                    doc.state = { count: 2 };
                }
            },
        });
        const storage = createAutomergeStorage<CountState>('root', 'state');
        expect(storage.hydrate?.()).toBe(true);
        const error = vi.fn();
        const store = createStore({
            storage,
            initialData: { count: 9 },
            logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error, setWriters: vi.fn() },
            sanitize: (value) => {
                if (value?.count === 2) {
                    throw new Error('intervening value rejected');
                }
                return value;
            },
        });
        const transaction = runWithAutomergeStorageTransaction(undefined, () => store.set({ count: 1 }));
        publishInterveningValue = true;

        transaction.commit();

        expect(store.value).toEqual({ count: 9 });
        expect(doc.state).toEqual({ count: 2 });
        expect(mutationCount).toBe(1);
        expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'Store sanitization failed' }));
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it.each(['returns null', 'throws'] as const)(
        'preserves a null fallback when a sanitizer %s during hydrate beneath a pending write',
        (mode) => {
            type CountState = { count: number };
            const { doc, port } = createTestPort({ state: { count: 7 } });
            configureAutomergeStoragePort(port);
            const storage = createAutomergeStorage<CountState>('root', 'state');
            const store = createStore({
                storage,
                sanitize: (value) => {
                    if (value?.count !== 7) {
                        return value;
                    }
                    if (mode === 'throws') {
                        throw new Error('count 7 rejected');
                    }
                    return null;
                },
            });
            const transaction = runWithAutomergeStorageTransaction(undefined, () => store.set({ count: 1 }));

            store.hydrate();
            transaction.abort();

            expect(doc.state).toEqual({ count: 7 });
            expect(store.value).toBeNull();
            expect(countPendingAutomergeStorageWrites()).toBe(0);
        }
    );

    it.each(['returns null', 'throws'] as const)(
        'preserves a null fallback when a sanitizer %s during committed terminal projection',
        (mode) => {
            type CountState = { count: number };
            const doc: TestDoc = { state: { count: 0 } };
            let publishInterveningValue = false;
            let mutationCount = 0;
            configureAutomergeStoragePort({
                getDoc: () => doc,
                getSemanticMessage: () => undefined,
                hasDoc: () => true,
                mutateDoc: ({ changeFn }) => {
                    changeFn(doc);
                    mutationCount += 1;
                    if (publishInterveningValue) {
                        publishInterveningValue = false;
                        doc.state = { count: 2 };
                    }
                },
            });
            const storage = createAutomergeStorage<CountState>('root', 'state');
            expect(storage.hydrate?.()).toBe(true);
            const store = createStore({
                storage,
                sanitize: (value) => {
                    if (value?.count !== 2) {
                        return value;
                    }
                    if (mode === 'throws') {
                        throw new Error('count 2 rejected');
                    }
                    return null;
                },
            });
            const transaction = runWithAutomergeStorageTransaction(undefined, () => store.set({ count: 1 }));
            publishInterveningValue = true;

            transaction.commit();

            expect(doc.state).toEqual({ count: 2 });
            expect(store.value).toBeNull();
            expect(mutationCount).toBe(1);
            expect(countPendingAutomergeStorageWrites()).toBe(0);
        }
    );

    it('preserves a later-authored same-slot commit made during terminal projection', () => {
        type CountState = { count: number };
        const { doc, port } = createTestPort({ state: { count: 0 } });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<CountState>('root', 'state');
        expect(storage.hydrate?.()).toBe(true);
        let publishNested = false;
        const store = createStore({
            storage,
            sanitize: (value) => {
                if (publishNested && value?.count === 1) {
                    publishNested = false;
                    const nested = runWithAutomergeStorageTransaction(undefined, () => storage.set({ count: 2 }));
                    nested.commit();
                }
                return value;
            },
        });
        const outer = runWithAutomergeStorageTransaction(undefined, () => store.set({ count: 1 }));
        publishNested = true;

        outer.commit();

        expect(doc.state).toEqual({ count: 2 });
        expect(store.value).toEqual({ count: 2 });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('preserves an earlier-authored same-slot commit published during a later terminal projection', () => {
        type CountState = { count: number };
        const { doc, port } = createTestPort({ state: { count: 0 } });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<CountState>('root', 'state');
        expect(storage.hydrate?.()).toBe(true);
        let publishNested = false;
        let earlier: ReturnType<typeof runWithAutomergeStorageTransaction> | undefined;
        const store = createStore({
            storage,
            sanitize: (value) => {
                if (publishNested && value?.count === 1) {
                    publishNested = false;
                    if (!earlier) {
                        throw new Error('Earlier transaction was not initialized');
                    }
                    earlier.commit();
                }
                return value;
            },
        });
        earlier = runWithAutomergeStorageTransaction(undefined, () => store.set({ count: 2 }));
        const outer = runWithAutomergeStorageTransaction(undefined, () => store.set({ count: 1 }));
        publishNested = true;

        outer.commit();

        expect(doc.state).toEqual({ count: 2 });
        expect(store.value).toEqual({ count: 2 });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('preserves a same-slot hydrate accepted during terminal projection', () => {
        type CountState = { count: number };
        const { doc, port, bumpHeads } = createTestPort({ state: { count: 0 } });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<CountState>('root', 'state');
        expect(storage.hydrate?.()).toBe(true);
        let hydrateNested = false;
        const store = createStore({
            storage,
            sanitize: (value) => {
                if (hydrateNested && value?.count === 1) {
                    hydrateNested = false;
                    doc.state = { count: 2 };
                    bumpHeads();
                    store.hydrate();
                }
                return value;
            },
        });
        const outer = runWithAutomergeStorageTransaction(undefined, () => store.set({ count: 1 }));
        hydrateNested = true;

        outer.commit();

        expect(doc.state).toEqual({ count: 2 });
        expect(store.value).toEqual({ count: 2 });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('does not let a stale hydrate stamp metadata after its projector resets authority', () => {
        type CountState = { count: number };
        const { doc, port, bumpHeads } = createTestPort({ state: { count: 0 } });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<CountState>('root', 'state', {
            hydrateMissing: () => ({ count: -1 }),
        });
        expect(storage.hydrate?.()).toBe(true);
        let resetDuringHydrate = false;
        const store = createStore({
            storage,
            sanitize: (value) => {
                if (resetDuringHydrate && value?.count === 1) {
                    resetDuringHydrate = false;
                    resetAutomergeStorageProjections('root');
                }
                return value;
            },
        });
        doc.state = { count: 1 };
        bumpHeads();
        resetDuringHydrate = true;

        store.hydrate();
        expect(store.value).toEqual({ count: -1 });

        store.hydrate();
        expect(store.value).toEqual({ count: 1 });
        expect(doc.state).toEqual({ count: 1 });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('does not let late projector registration overwrite authority committed by its callback', () => {
        type CountState = { count: number };
        const { doc, port } = createTestPort({ state: { count: 0 } });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<CountState>('root', 'state');
        expect(storage.hydrate?.()).toBe(true);
        const successor = runWithAutomergeStorageTransaction(undefined, () => storage.set({ count: 1 }));
        let publishNested = true;
        const store = createStore({
            storage,
            sanitize: (value) => {
                if (publishNested && value?.count === 0) {
                    publishNested = false;
                    const nested = runWithAutomergeStorageTransaction(undefined, () => storage.set({ count: 2 }));
                    nested.commit();
                }
                return value;
            },
        });

        successor.abort();

        expect(doc.state).toEqual({ count: 2 });
        expect(store.value).toEqual({ count: 2 });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });
});
