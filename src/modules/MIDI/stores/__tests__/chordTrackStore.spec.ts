import { change, clone, from, getHeads, merge, save, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

type RootDocument = {
    chordTrack?: unknown;
    [key: string]: unknown;
};

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

function createBaseline(state: ChordTrackState): Doc<RootDocument> {
    const peer = createPeer(from<RootDocument>({ chordTrack: defaultChordTrackState }));
    const storage = createChordTrackAutomergeStorage();
    configureAutomergeStoragePort(peer.port);
    storage.hydrate?.();
    storage.set(state);
    flushAutomergeStorageWrites();
    return peer.getDoc();
}

function writePeer(peer: ReturnType<typeof createPeer>, state: ChordTrackState): void {
    const storage = createChordTrackAutomergeStorage();
    configureAutomergeStoragePort(peer.port);
    storage.hydrate?.();
    storage.set(state);
    flushAutomergeStorageWrites();
}

function projectMerged(
    leftPeer: ReturnType<typeof createPeer>,
    rightPeer: ReturnType<typeof createPeer>
): ChordTrackState {
    const peer = createPeer(merge(leftPeer.getDoc(), rightPeer.getDoc()));
    const storage = createChordTrackAutomergeStorage();
    configureAutomergeStoragePort(peer.port);
    storage.hydrate?.();
    return storage.get() ?? defaultChordTrackState;
}

function chordState(id: string, root: number): ChordTrackState {
    return {
        enabled: true,
        events: [{ id, beat: 4, root, quality: 'min7', duration: 8 }],
    };
}

function readChordTrack(peer: ReturnType<typeof createPeer>): unknown {
    const chordTrack = peer.getDoc().chordTrack;
    return chordTrack === undefined ? undefined : JSON.parse(JSON.stringify(chordTrack));
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
    const storage = createChordTrackAutomergeStorage();
    configureAutomergeStoragePort(localPeer.port);
    storage.hydrate?.();
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
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        vi.restoreAllMocks();
    });

    it('projects the active root, creates its slot, and resets when the slot is missing', () => {
        const mainState = chordState('main-chord', 5);
        const mainPeer = createPeer(from<RootDocument>({ chordTrack: mainState }));
        configureAutomergeStoragePort(mainPeer.port);
        chordTrackStore.hydrate();
        expect(chordTrackStore.value).toEqual(mainState);
        const createdState = chordState('created-chord', 7);
        const createdPeer = createPeer(from<RootDocument>({}));
        configureAutomergeStoragePort(createdPeer.port);
        chordTrackStore.set(createdState);
        flushAutomergeStorageWrites();
        expect(readChordTrack(createdPeer)).toBeDefined();
        const missingPeer = createPeer(from<RootDocument>({}));
        configureAutomergeStoragePort(missingPeer.port);
        chordTrackStore.hydrate();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
        expect(readChordTrack(missingPeer)).toBeUndefined();
        expect(readChordTrack(mainPeer)).toEqual(mainState);
    });

    it('does not read or write independent process-global localStorage', () => {
        const peer = createPeer(from<RootDocument>({}));
        const getItem = vi.spyOn(Storage.prototype, 'getItem');
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        configureAutomergeStoragePort(peer.port);
        chordTrackStore.set(chordState('crdt-only-chord', 9));
        flushAutomergeStorageWrites();
        chordTrackStore.hydrate();
        expect(getItem).not.toHaveBeenCalled();
        expect(setItem).not.toHaveBeenCalled();
    });

    it('converges concurrent additions by stable event ID', () => {
        const baseline = createBaseline({ enabled: true, events: [] });
        const leftPeer = createPeer(clone(baseline));
        const rightPeer = createPeer(clone(baseline));
        writePeer(leftPeer, chordState('left-add', 2));
        writePeer(rightPeer, chordState('right-add', 7));
        expect(projectMerged(leftPeer, rightPeer).events.map((event) => event.id)).toEqual(['left-add', 'right-add']);
    });

    it('converges independent concurrent updates to one event', () => {
        const initial = chordState('shared-update', 3);
        const baseline = createBaseline(initial);
        const leftPeer = createPeer(clone(baseline));
        const rightPeer = createPeer(clone(baseline));
        writePeer(leftPeer, { ...initial, events: [{ ...initial.events[0]!, duration: 16 }] });
        writePeer(rightPeer, { ...initial, events: [{ ...initial.events[0]!, root: 8 }] });
        expect(projectMerged(leftPeer, rightPeer).events).toEqual([
            expect.objectContaining({ id: 'shared-update', duration: 16, root: 8 }),
        ]);
    });

    it('keeps a concurrent removal causal while preserving an unrelated addition', () => {
        const initial = chordState('remove-me', 4);
        const baseline = createBaseline(initial);
        const leftPeer = createPeer(clone(baseline));
        const rightPeer = createPeer(clone(baseline));
        writePeer(leftPeer, { enabled: true, events: [] });
        writePeer(rightPeer, { enabled: true, events: [...initial.events, ...chordState('keep-add', 9).events] });
        expect(projectMerged(leftPeer, rightPeer).events.map((event) => event.id)).toEqual(['keep-add']);
    });

    it('deterministically reconciles concurrent first writes from a legacy root', () => {
        const initial = chordState('legacy-remove', 5);
        const legacy = from<RootDocument>({ chordTrack: initial });
        const leftPeer = createPeer(clone(legacy));
        const rightPeer = createPeer(clone(legacy));
        writePeer(leftPeer, { enabled: true, events: [] });
        writePeer(rightPeer, { enabled: true, events: [...initial.events, ...chordState('legacy-add', 11).events] });
        expect(projectMerged(leftPeer, rightPeer).events.map((event) => event.id)).toEqual(['legacy-add']);
    });

    it('preserves independent same-event fields and enabled during concurrent first migration', () => {
        const initial = { ...chordState('legacy-shared', 3), enabled: false };
        const legacy = from<RootDocument>({ chordTrack: initial });
        const leftPeer = createPeer(clone(legacy));
        const rightPeer = createPeer(clone(legacy));
        writePeer(leftPeer, {
            enabled: true,
            events: [{ ...initial.events[0]!, duration: 16 }],
        });
        writePeer(rightPeer, {
            enabled: false,
            events: [{ ...initial.events[0]!, root: 8 }],
        });
        const projected = projectMerged(leftPeer, rightPeer);
        expect(projected.enabled).toBe(true);
        expect(projected.events).toEqual([expect.objectContaining({ id: 'legacy-shared', duration: 16, root: 8 })]);
    });

    it('rebases pending additions and same-event fields without reviving deletions', () => {
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
        expect(projected.events).toEqual([expect.objectContaining({ id: 'pending-shared', duration: 16, root: 8 })]);
        const updated = { ...initial, events: [{ ...initial.events[0]!, quality: 'dim' as const }] };
        expect(projectPendingHydrate(initial, { enabled: true, events: [] }, updated).events).toEqual([]);
        expect(projectPendingHydrate(initial, updated, { enabled: true, events: [] }).events).toEqual([]);
    });

    it('sanitizes malformed collaborative chord state to the safe default', () => {
        const malformed = {
            enabled: true,
            events: [{ id: 'bad-chord', beat: -1, root: 14, quality: 'unknown', duration: 0 }],
        };
        const peer = createPeer(from<RootDocument>({ chordTrack: malformed }));
        configureAutomergeStoragePort(peer.port);
        const heads = getHeads(peer.getDoc());
        const bytes = save(peer.getDoc());
        chordTrackStore.hydrate();
        flushAutomergeStorageWrites();
        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
        expect(getHeads(peer.getDoc())).toEqual(heads);
        expect(save(peer.getDoc())).toEqual(bytes);
    });
});
