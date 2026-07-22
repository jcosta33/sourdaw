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
        const legacy = from<RootDocument>({ chordTrack: initial });
        const leftPeer = createPeer(clone(legacy));
        const rightPeer = createPeer(clone(legacy));
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
});
