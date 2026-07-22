import { change, from, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';

import { chordTrackStore, defaultChordTrackState, type ChordTrackState } from '../chordTrackStore';

type RootDocument = {
    chordTrack?: unknown;
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

function createPeer(initialDoc: Doc<RootDocument>): { getDoc: () => Doc<RootDocument>; port: TestPort } {
    let doc = initialDoc;
    return {
        getDoc: () => doc,
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

        expect(readChordTrack(peer)).toEqual(state);
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

    it('sanitizes malformed collaborative chord state to the safe default', () => {
        const malformed = {
            enabled: true,
            events: [{ id: 'bad-chord', beat: -1, root: 14, quality: 'unknown', duration: 0 }],
        };
        const peer = createPeer(from<RootDocument>({ chordTrack: malformed }));
        configureAutomergeStoragePort(peer.port);

        chordTrackStore.hydrate();

        expect(chordTrackStore.value).toEqual(defaultChordTrackState);
    });
});
