import { change, clone, from, getHeads, merge, save, type Doc } from '@automerge/automerge';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';

import {
    chordTrackStore,
    createChordTrackAutomergeStorage,
    defaultChordTrackState,
    isChordTrackState,
    type ChordTrackState,
} from '../chordTrackStore';

type RootDocument = Record<string, unknown> & { chordTrack?: unknown };

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

function createPeer(initialDoc: Doc<RootDocument>) {
    let doc = initialDoc;
    return {
        getDoc: () => doc,
        replaceDoc: (nextDoc: Doc<RootDocument>) => {
            doc = nextDoc;
        },
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

function createStorage(peer: ReturnType<typeof createPeer>) {
    configureAutomergeStoragePort(peer.port);
    const storage = createChordTrackAutomergeStorage();
    storage.hydrate?.();
    return storage;
}

const STORAGE_KEY = 'sourdaw_chord_track';

function loadStore() {
    const root: RootDocument = {};
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored !== null) {
            root.chordTrack = JSON.parse(stored);
        }
    } catch {
        // Treat inaccessible or malformed legacy data as a missing root.
    }
    const peer = createPeer(from<RootDocument>(root));
    const originalHeads = getHeads(peer.getDoc());
    const originalBytes = save(peer.getDoc());
    configureAutomergeStoragePort(peer.port);
    chordTrackStore.hydrate();
    return Promise.resolve({ chordTrackStore, defaultChordTrackState, peer, originalHeads, originalBytes });
}

function createBaseline(state: ChordTrackState): Doc<RootDocument> {
    const peer = createPeer(from<RootDocument>({ chordTrack: defaultChordTrackState }));
    const storage = createStorage(peer);
    storage.set(state);
    flushAutomergeStorageWrites();
    return peer.getDoc();
}

function writePeer(peer: ReturnType<typeof createPeer>, state: ChordTrackState): void {
    const storage = createStorage(peer);
    storage.set(state);
    flushAutomergeStorageWrites();
}

function projectMerged(
    leftPeer: ReturnType<typeof createPeer>,
    rightPeer: ReturnType<typeof createPeer>
): ChordTrackState {
    const peer = createPeer(merge(leftPeer.getDoc(), rightPeer.getDoc()));
    const storage = createStorage(peer);
    return storage.get() ?? defaultChordTrackState;
}

function chordState(id: string, root: number): ChordTrackState {
    return {
        enabled: true,
        events: [{ id, beat: 4, root, quality: 'min7', duration: 8 }],
    };
}

const validEvent = { id: 'event', beat: 0, root: 5, quality: 'major' as const, duration: 4 };
const validSchema = { schemaVersion: 1, enabled: true, events: {} };
const rejectedAuthorities = [
    [
        'mismatched entity id',
        { ...validSchema, events: { expected: { deleted: false, value: { ...validEvent, id: 'other' } } } },
    ],
    ['non-boolean tombstone', { ...validSchema, events: { event: { deleted: 'no', value: validEvent } } }],
    [
        'invalid event value',
        { ...validSchema, events: { event: { deleted: false, value: { ...validEvent, root: 12 } } } },
    ],
    [
        'invalid migration base',
        { ...validSchema, migrationBase: { enabled: true, events: [{ ...validEvent, id: '' }] } },
    ],
    ['unsupported version', { ...validSchema, schemaVersion: 2 }],
] as const;

function projectPendingHydrate(
    base: ChordTrackState,
    pending: ChordTrackState,
    remote: ChordTrackState
): ChordTrackState {
    const baseline = createBaseline(base);
    const remotePeer = createPeer(clone(baseline));
    writePeer(remotePeer, remote);
    const localPeer = createPeer(clone(baseline));
    const storage = createStorage(localPeer);
    storage.set(pending);
    localPeer.replaceDoc(merge(localPeer.getDoc(), remotePeer.getDoc()));
    storage.hydrate?.();
    flushAutomergeStorageWrites();
    return storage.get() ?? defaultChordTrackState;
}

describe('chordTrackStore CRDT projection', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        flushAutomergeStorageWrites();
        chordTrackStore.set(defaultChordTrackState);
        flushAutomergeStorageWrites();
        localStorage.removeItem(STORAGE_KEY);
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        vi.restoreAllMocks();
        localStorage.removeItem(STORAGE_KEY);
    });

    it('loads a well-formed persisted state', async () => {
        const persisted = {
            enabled: true,
            events: [{ id: 'e1', beat: 0, root: 5, quality: 'major', duration: 4 }],
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));

        const { chordTrackStore } = await loadStore();
        expect(chordTrackStore.value).toEqual(persisted);
    });

    it('should persist changes with the existing key and plain JSON shape', async () => {
        const { chordTrackStore, peer } = await loadStore();
        const state = {
            enabled: true,
            events: [{ id: 'e1', beat: 0, root: 5, quality: 'major', duration: 4 }],
        } satisfies ChordTrackState;

        chordTrackStore.set(state);
        flushAutomergeStorageWrites();

        expect(peer.getDoc().chordTrack).toMatchObject({ schemaVersion: 1, enabled: true });
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('falls back to the default state when the persisted shape is invalid', async () => {
        // `enabled` is the wrong type and an event is missing required fields —
        // an unchecked cast would have trusted this as a valid ChordTrackState.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: 'yes', events: [{ id: 'e1' }] }));

        const { chordTrackStore, defaultChordTrackState, peer, originalHeads, originalBytes } = await loadStore();
        flushAutomergeStorageWrites();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
        expect(getHeads(peer.getDoc())).toEqual(originalHeads);
        expect(save(peer.getDoc())).toEqual(originalBytes);
    });

    it('should fall back to the default state when a persisted event has an invalid quality', async () => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                enabled: true,
                events: [{ id: 'e1', beat: 0, root: 5, quality: 'custom', duration: 4 }],
            })
        );

        const { chordTrackStore, defaultChordTrackState } = await loadStore();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });

    it('should fall back when a persisted event quality is only an inherited object key', async () => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                enabled: true,
                events: [{ id: 'e1', beat: 0, root: 5, quality: 'toString', duration: 4 }],
            })
        );

        const { chordTrackStore, defaultChordTrackState } = await loadStore();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });

    it('should fall back to the default state when a persisted event has a non-finite number', async () => {
        localStorage.setItem(
            STORAGE_KEY,
            '{"enabled":true,"events":[{"id":"e1","beat":1e999,"root":5,"quality":"major","duration":4}]}'
        );

        const { chordTrackStore, defaultChordTrackState } = await loadStore();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });

    it('should fall back when a persisted event has a negative beat', async () => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                enabled: true,
                events: [{ id: 'e1', beat: -3, root: 5, quality: 'major', duration: 4 }],
            })
        );

        const { chordTrackStore, defaultChordTrackState } = await loadStore();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });

    it('should fall back when a persisted event root is outside the pitch-class range', async () => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                enabled: true,
                events: [{ id: 'e1', beat: 0, root: -1, quality: 'major', duration: 4 }],
            })
        );

        const { chordTrackStore, defaultChordTrackState } = await loadStore();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });

    it('should fall back when a persisted event duration is below the chord editor minimum', async () => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                enabled: true,
                events: [{ id: 'e1', beat: 0, root: 5, quality: 'major', duration: 0.01 }],
            })
        );

        const { chordTrackStore, defaultChordTrackState } = await loadStore();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });

    it('falls back to the default state when the persisted JSON is malformed', async () => {
        localStorage.setItem(STORAGE_KEY, '{ not valid json');

        const { chordTrackStore, defaultChordTrackState } = await loadStore();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });

    it('should fall back to the default state when browser storage is unavailable', async () => {
        const browserStorage = window.localStorage;
        Object.defineProperty(window, 'localStorage', { configurable: true, value: undefined });

        try {
            const { chordTrackStore, defaultChordTrackState } = await loadStore();
            expect(chordTrackStore.value).toEqual(defaultChordTrackState);
        } finally {
            Object.defineProperty(window, 'localStorage', { configurable: true, value: browserStorage });
        }
    });

    it('should fall back to the default state when storage reads fail', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('read blocked');
        });

        const { chordTrackStore, defaultChordTrackState } = await loadStore();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });

    it('should not crash when storage writes fail', async () => {
        const { chordTrackStore } = await loadStore();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('write blocked');
        });

        expect(() => {
            chordTrackStore.set({
                enabled: true,
                events: [{ id: 'e1', beat: 0, root: 5, quality: 'major', duration: 4 }],
            });
        }).not.toThrow();
    });

    it('converges additions, updates, and removal by stable event ID', () => {
        const emptyBaseline = createBaseline({ enabled: true, events: [] });
        const leftAdd = createPeer(clone(emptyBaseline));
        const rightAdd = createPeer(clone(emptyBaseline));
        writePeer(leftAdd, chordState('left-add', 2));
        writePeer(rightAdd, chordState('right-add', 7));
        expect(projectMerged(leftAdd, rightAdd).events.map((event) => event.id)).toEqual(['left-add', 'right-add']);
        const initial = chordState('shared-event', 3);
        const baseline = createBaseline(initial);
        const leftEdit = createPeer(clone(baseline));
        const rightEdit = createPeer(clone(baseline));
        writePeer(leftEdit, { ...initial, events: [{ ...initial.events[0]!, duration: 16 }] });
        writePeer(rightEdit, { ...initial, events: [{ ...initial.events[0]!, root: 8 }] });
        expect(projectMerged(leftEdit, rightEdit).events).toEqual([
            expect.objectContaining({ id: 'shared-event', duration: 16, root: 8 }),
        ]);
        const removed = createPeer(clone(baseline));
        const added = createPeer(clone(baseline));
        writePeer(removed, { enabled: true, events: [] });
        writePeer(added, { enabled: true, events: [...initial.events, ...chordState('keep-add', 9).events] });
        expect(projectMerged(removed, added).events.map((event) => event.id)).toEqual(['keep-add']);
    });

    it('reconciles concurrent first migration without losing independent edits', () => {
        const initial = { ...chordState('legacy-shared', 3), enabled: false };
        const emptyRoot = from<RootDocument>({});
        const leftPeer = createPeer(clone(emptyRoot));
        const rightPeer = createPeer(clone(emptyRoot));
        writePeer(leftPeer, initial);
        writePeer(rightPeer, initial);
        writePeer(leftPeer, { enabled: true, events: [{ ...initial.events[0]!, duration: 16 }] });
        writePeer(rightPeer, {
            enabled: false,
            events: [{ ...initial.events[0]!, root: 8 }, ...chordState('legacy-add', 11).events],
        });
        const projected = projectMerged(leftPeer, rightPeer);
        expect(projected.enabled).toBe(true);
        expect(projected.events.map((event) => event.id)).toEqual(['legacy-add', 'legacy-shared']);
        expect(projected.events[1]).toMatchObject({ duration: 16, root: 8 });
    });

    it('rebases pending edits field-by-field with delete-wins semantics', () => {
        const addition = projectPendingHydrate(
            { enabled: true, events: [] },
            chordState('local-pending', 1),
            chordState('remote-add', 6)
        );
        expect(addition.events.map((event) => event.id)).toEqual(['local-pending', 'remote-add']);
        const initial = chordState('pending-shared', 3);
        const projected = projectPendingHydrate(
            initial,
            { ...initial, events: [{ ...initial.events[0]!, duration: 16 }] },
            { ...initial, events: [{ ...initial.events[0]!, root: 8 }] }
        );
        expect(projected.events).toEqual([expect.objectContaining({ duration: 16, root: 8 })]);
        const updated = { ...initial, events: [{ ...initial.events[0]!, quality: 'dim' as const }] };
        expect(projectPendingHydrate(initial, { enabled: true, events: [] }, updated).events).toEqual([]);
        expect(projectPendingHydrate(initial, updated, { enabled: true, events: [] }).events).toEqual([]);
    });

    it.each(rejectedAuthorities)(
        'projects a safe public default for %s authority without allowing overwrite',
        (_label, malformed) => {
            chordTrackStore.set(chordState('stale-project', 2));
            flushAutomergeStorageWrites();
            const peer = createPeer(from<RootDocument>({ chordTrack: malformed }));
            const originalHeads = getHeads(peer.getDoc());
            const originalBytes = save(peer.getDoc());
            configureAutomergeStoragePort(peer.port);
            chordTrackStore.hydrate();
            expect(chordTrackStore.value).toEqual(defaultChordTrackState);
            expect(getHeads(peer.getDoc())).toEqual(originalHeads);
            expect(save(peer.getDoc())).toEqual(originalBytes);
            chordTrackStore.set(chordState('replacement', 8));
            expect(() => flushAutomergeStorageWrites()).toThrow();
            expect(getHeads(peer.getDoc())).toEqual(originalHeads);
            expect(save(peer.getDoc())).toEqual(originalBytes);
            configureAutomergeStoragePort(null);
            flushAutomergeStorageWrites();
        }
    );

    it('discards a whole-slot clear pending when a concurrent remote change hydrates', () => {
        // Domain: a `clear()` (null pending) is a terminal whole-slot intent, not a
        // field-level edit, so rebasePending returns null and the cached value stays
        // null (the slot is cleared) rather than field-merging a deletion against the
        // concurrent remote addition.
        const initial = chordState('shared', 3);
        const baseline = createBaseline(initial);
        const remotePeer = createPeer(clone(baseline));
        writePeer(remotePeer, chordState('remote-add', 6));
        const localPeer = createPeer(clone(baseline));
        const storage = createStorage(localPeer);

        storage.clear();
        localPeer.replaceDoc(merge(localPeer.getDoc(), remotePeer.getDoc()));
        storage.hydrate?.();
        flushAutomergeStorageWrites();

        expect(storage.get()).toBeNull();
    });

    it('preserves a pending enabled toggle over a concurrent remote event edit', () => {
        // Domain: `enabled` is whole-track state, not an event field. A local toggle
        // must win the rebase, while a concurrent per-event edit on the remote still
        // merges in field-by-field.
        const initial = chordState('shared', 3);
        const baseline = createBaseline(initial);
        const remotePeer = createPeer(clone(baseline));
        writePeer(remotePeer, { ...initial, events: [{ ...initial.events[0]!, root: 8 }] });
        const localPeer = createPeer(clone(baseline));
        const storage = createStorage(localPeer);

        storage.set({ ...initial, enabled: false });
        localPeer.replaceDoc(merge(localPeer.getDoc(), remotePeer.getDoc()));
        storage.hydrate?.();
        flushAutomergeStorageWrites();

        const projected = storage.get() ?? defaultChordTrackState;
        expect(projected.enabled).toBe(false);
        expect(projected.events).toEqual([expect.objectContaining({ id: 'shared', root: 8 })]);
    });

    it('lets an unchanged pending event track a concurrent remote edit to that event', () => {
        // Domain: when pending carries an event forward untouched (same JSON as base),
        // rebasePending skips it so the hydrated/remote version of that event wins.
        const kept = { id: 'keep', beat: 0, root: 3, quality: 'major' as const, duration: 4 };
        const initial = { enabled: true, events: [kept] };
        const baseline = createBaseline(initial);
        const remotePeer = createPeer(clone(baseline));
        writePeer(remotePeer, {
            enabled: true,
            events: [{ ...kept, root: 7 }, ...chordState('remote-add', 6).events],
        });
        const localPeer = createPeer(clone(baseline));
        const storage = createStorage(localPeer);

        storage.set({ enabled: true, events: [...initial.events, ...chordState('local-add', 2).events] });
        localPeer.replaceDoc(merge(localPeer.getDoc(), remotePeer.getDoc()));
        storage.hydrate?.();
        flushAutomergeStorageWrites();

        const projected = storage.get() ?? defaultChordTrackState;
        expect(projected.events).toEqual([
            expect.objectContaining({ id: 'keep', root: 7 }),
            expect.objectContaining({ id: 'local-add' }),
            expect.objectContaining({ id: 'remote-add' }),
        ]);
    });

    it('migrates from a defined legacy plain shape, tombstoning removed events', () => {
        // Domain: a pre-CRDT plain {enabled,events} already in the doc is a valid prior
        // state, so the first CRDT write derives its migrationBase from it and records
        // tombstones for events the new state drops.
        const legacy = {
            enabled: true,
            events: [{ id: 'legacy', beat: 0, root: 5, quality: 'major', duration: 4 }],
        };
        const peer = createPeer(from<RootDocument>({ chordTrack: legacy }));
        const storage = createStorage(peer);

        storage.set({ enabled: true, events: chordState('new', 2).events });
        flushAutomergeStorageWrites();

        const crdt = peer.getDoc().chordTrack as {
            events: Record<string, { deleted?: boolean }>;
            migrationBase?: unknown;
        };
        const eventIds = Object.keys(crdt.events);
        expect(crdt.events.legacy?.deleted).toBe(true);
        expect(eventIds).toContain('new');
        expect(crdt.migrationBase).toBeDefined();
    });

    it('migrates from defined garbage without deriving a migration base', () => {
        // Domain: a defined-but-invalid prior slot has no trustworthy prior state, so the
        // CRDT write encodes the desired state from scratch and carries no migrationBase
        // (the slot is treated as a fresh migration, not a rebase over real history).
        const peer = createPeer(from<RootDocument>({ chordTrack: { garbage: true, nope: 123 } }));
        const storage = createStorage(peer);

        storage.set(chordState('fresh', 2));
        flushAutomergeStorageWrites();

        const crdt = peer.getDoc().chordTrack as {
            schemaVersion: number;
            events: Record<string, unknown>;
            migrationBase?: unknown;
        };
        expect(crdt.schemaVersion).toBe(1);
        expect(Object.keys(crdt.events)).toEqual(['fresh']);
        expect(crdt.migrationBase).toBeUndefined();
    });

    it('reconciles conflicting plain-legacy values with last-writer enabled and unioned events', () => {
        // Domain: when two replicas each carry a plain legacy shape that conflicts,
        // neither side advertises a migrationBase. The reconciler falls back to a
        // last-writer `enabled` merge plus a union of both sides' events.
        const left = createPeer(
            from<RootDocument>({
                chordTrack: { enabled: true, events: [{ id: 'a', beat: 0, root: 0, quality: 'major', duration: 4 }] },
            })
        );
        const right = createPeer(
            from<RootDocument>({
                chordTrack: { enabled: false, events: [{ id: 'b', beat: 0, root: 2, quality: 'minor', duration: 4 }] },
            })
        );
        const peer = createPeer(merge(left.getDoc(), right.getDoc()));
        const storage = createStorage(peer);

        const projected = storage.get() ?? defaultChordTrackState;
        expect(projected.events.map((event) => event.id).sort()).toEqual(['a', 'b']);
    });

    it('commits the reconciled conflict state before the next CRDT mutation', () => {
        // Domain: after resolveCrdtConflicts materializes a reconciled doc, the next
        // set() must first write that whole reconciled state (so causal identity and
        // tombstones survive) before applying the new mutation. Two replicas diverging
        // from a shared empty baseline with conflicting `enabled` flags forces a real
        // Automerge conflict that resolveCrdtConflicts must reconcile.
        const left = createPeer(from<RootDocument>({ chordTrack: defaultChordTrackState }));
        const right = createPeer(from<RootDocument>({ chordTrack: defaultChordTrackState }));
        writePeer(left, { enabled: true, events: chordState('left', 4).events });
        writePeer(right, { enabled: false, events: chordState('right', 7).events });
        const peer = createPeer(merge(left.getDoc(), right.getDoc()));
        const storage = createStorage(peer);

        storage.set(chordState('after-conflict', 9));
        flushAutomergeStorageWrites();

        const crdt = peer.getDoc().chordTrack as { events: Record<string, unknown> };
        expect(Object.keys(crdt.events).sort()).toEqual(['after-conflict', 'left', 'right']);
    });

    it('drops reconciled conflict state when the same adapter hydrates a new missing authority', () => {
        const legacy = from<RootDocument>({ chordTrack: chordState('legacy', 3) });
        const left = createPeer(clone(legacy));
        const right = createPeer(clone(legacy));
        writePeer(left, chordState('left', 4));
        writePeer(right, chordState('right', 7));
        const peer = createPeer(merge(left.getDoc(), right.getDoc()));
        const storage = createStorage(peer);

        peer.replaceDoc(from<RootDocument>({}));
        storage.hydrate?.();
        storage.set(chordState('fresh', 9));
        flushAutomergeStorageWrites();

        expect(Object.keys((peer.getDoc().chordTrack as { events: Record<string, unknown> }).events)).toEqual([
            'fresh',
        ]);
    });
});

describe('isChordTrackState', () => {
    // Domain: this guard validates untrusted persisted/synced data before any unchecked
    // cast to ChordTrackState. Each rejection path must fail closed (return false) so the
    // store falls back to the default state instead of trusting malformed input.
    it.each([
        ['non-object top-level', 42],
        ['null top-level', null],
        ['array top-level', []],
        ['enabled is not a boolean', { enabled: 'yes', events: [] }],
        ['events is not an array', { enabled: true, events: {} }],
    ])('rejects %s', (_label, value) => {
        expect(isChordTrackState(value)).toBe(false);
    });

    it('rejects a non-object chord event entry', () => {
        expect(isChordTrackState({ enabled: true, events: ['not-an-event'] })).toBe(false);
    });

    it('rejects an event whose quality is not a string', () => {
        expect(
            isChordTrackState({
                enabled: true,
                events: [{ id: 'e1', beat: 0, root: 5, quality: 7, duration: 4 }],
            })
        ).toBe(false);
    });

    it('rejects duplicate event ids (an unchecked cast would silently drop a duplicate)', () => {
        const event = { id: 'dup', beat: 0, root: 5, quality: 'major', duration: 4 };
        expect(isChordTrackState({ enabled: true, events: [event, { ...event }] })).toBe(false);
    });

    it('accepts a well-formed state', () => {
        expect(
            isChordTrackState({
                enabled: true,
                events: [{ id: 'e1', beat: 0, root: 5, quality: 'major', duration: 4 }],
            })
        ).toBe(true);
    });
});
