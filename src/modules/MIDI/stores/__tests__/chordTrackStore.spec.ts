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
    rightPeer: ReturnType<typeof createPeer>,
    direction: 'left-right' | 'right-left' = 'left-right'
): ChordTrackState {
    const doc =
        direction === 'left-right'
            ? merge(leftPeer.getDoc(), rightPeer.getDoc())
            : merge(rightPeer.getDoc(), leftPeer.getDoc());
    const peer = createPeer(doc);
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
    if (chordTrack === undefined) {
        return undefined;
    }
    return JSON.parse(JSON.stringify(chordTrack));
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

    it('hydrates persisted chord state from the active root document', () => {
        const persisted = chordState('loaded-chord', 5);
        const peer = createPeer(from<RootDocument>({ chordTrack: persisted }));
        configureAutomergeStoragePort(peer.port);

        chordTrackStore.hydrate();

        expect(chordTrackStore.value).toEqual(persisted);
        expect(readChordTrack(peer)).toEqual(persisted);
    });

    it('creates the chord slot through the root Automerge authority', () => {
        const peer = createPeer(from<RootDocument>({}));
        const state = chordState('created-chord', 7);
        configureAutomergeStoragePort(peer.port);

        chordTrackStore.set(state);
        flushAutomergeStorageWrites();

        expect(readChordTrack(peer)).toBeDefined();
        chordTrackStore.hydrate();
        expect(chordTrackStore.value).toEqual(state);
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

    it('resets stale projection state when a legacy root document has no chord slot', () => {
        const oldPeer = createPeer(from<RootDocument>({}));
        configureAutomergeStoragePort(oldPeer.port);
        chordTrackStore.set(chordState('stale-chord', 10));
        flushAutomergeStorageWrites();

        const legacyPeer = createPeer(from<RootDocument>({}));
        configureAutomergeStoragePort(legacyPeer.port);
        chordTrackStore.hydrate();

        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
        expect(readChordTrack(legacyPeer)).toBeUndefined();
    });

    it('reprojects chord state from each active branch root', () => {
        const mainState = chordState('main-chord', 0);
        const featureState = chordState('feature-chord', 2);
        const mainPeer = createPeer(from<RootDocument>({ chordTrack: mainState }));
        const featurePeer = createPeer(from<RootDocument>({ chordTrack: featureState }));

        configureAutomergeStoragePort(mainPeer.port);
        chordTrackStore.hydrate();
        expect(chordTrackStore.value).toEqual(mainState);

        configureAutomergeStoragePort(featurePeer.port);
        chordTrackStore.hydrate();

        expect(chordTrackStore.value).toEqual(featureState);
        expect(readChordTrack(mainPeer)).toEqual(mainState);
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

        const expectedIds = ['legacy-add'];
        expect(projectMerged(leftPeer, rightPeer, 'left-right').events.map((event) => event.id)).toEqual(expectedIds);
        expect(projectMerged(leftPeer, rightPeer, 'right-left').events.map((event) => event.id)).toEqual(expectedIds);
    });

    it('rebases a pending local addition over a remote hydrate', () => {
        const frameCallbacks: FrameRequestCallback[] = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frameCallbacks.push(callback);
            return frameCallbacks.length;
        });
        const baseline = createBaseline({ enabled: true, events: [] });
        const remotePeer = createPeer(clone(baseline));
        writePeer(remotePeer, chordState('remote-add', 6));

        const localPeer = createPeer(clone(baseline));
        const localStorage = createChordTrackAutomergeStorage();
        configureAutomergeStoragePort(localPeer.port);
        localStorage.hydrate?.();
        localStorage.set(chordState('local-pending', 1));
        localPeer.replaceDoc(merge(localPeer.getDoc(), remotePeer.getDoc()));
        localStorage.hydrate?.();
        frameCallbacks.at(-1)?.(100);

        localStorage.hydrate?.();
        expect(localStorage.get()?.events.map((event) => event.id)).toEqual(['local-pending', 'remote-add']);
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
