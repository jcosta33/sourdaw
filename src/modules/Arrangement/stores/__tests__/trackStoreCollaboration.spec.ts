import { change, clone, from, merge, type Doc } from '@automerge/automerge';
import { describe, it, expect, afterEach } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
} from '#/infra/store/storage/createAutomergeStorage';

import { createTrack, type Clip, type Track } from '../../models/Track';
import { trackStore, type TrackStoreState } from '../trackStore';

type RootDocument = Record<string, unknown> & { tracks?: unknown };

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

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

/**
 * `trackStore` is a singleton, so each peer has to start from a dropped
 * projection — otherwise the previous peer's cache becomes this peer's write
 * base and the test measures the harness rather than the merge.
 */
function attachPeer(peer: ReturnType<typeof createPeer>): void {
    configureAutomergeStoragePort(peer.port);
    resetAutomergeStorageProjections('root');
    trackStore.hydrate();
}

function projectedState(): TrackStoreState {
    const state = trackStore.value;
    if (!state) {
        throw new Error('trackStore must hold a projected value');
    }
    return state;
}

/** Read the slot through the store, apply one edit, write it back. */
function editPeer(peer: ReturnType<typeof createPeer>, edit: (tracks: Track[]) => void): void {
    attachPeer(peer);
    const state = projectedState();
    const tracks = structuredClone(state.tracks);
    edit(tracks);
    trackStore.set({ ...state, tracks });
    flushAutomergeStorageWrites();
}

function readMerged(left: ReturnType<typeof createPeer>, right: ReturnType<typeof createPeer>): Track[] {
    const merged = createPeer(merge(clone(left.getDoc()), right.getDoc()));
    attachPeer(merged);
    return projectedState().tracks;
}

function audioClip(input: { id: string; trackId: string; name: string; endBeat: number }): Clip {
    return {
        id: input.id,
        trackId: input.trackId,
        name: input.name,
        startBeat: 0,
        endBeat: input.endBeat,
        type: 'audio',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

function baselineDoc(): Doc<RootDocument> {
    const drums = createTrack({ id: 'track-drums', name: 'Drums', kind: 'audio' });
    const bass = createTrack({ id: 'track-bass', name: 'Bass', kind: 'audio' });
    return from<RootDocument>({ tracks: { tracks: [drums, bass] } });
}

afterEach(() => {
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
});

describe('trackStore concurrent collaboration', () => {
    it('keeps both peers gain changes when each edits a different track', () => {
        const baseline = baselineDoc();
        const peerA = createPeer(clone(baseline));
        const peerB = createPeer(clone(baseline));

        editPeer(peerA, (tracks) => {
            const drums = tracks.find((track) => track.id === 'track-drums');
            if (drums) {
                drums.gain = 0.25;
            }
        });
        editPeer(peerB, (tracks) => {
            const bass = tracks.find((track) => track.id === 'track-bass');
            if (bass) {
                bass.gain = 0.75;
            }
        });

        const tracks = readMerged(peerA, peerB);

        expect(tracks.find((track) => track.id === 'track-drums')?.gain).toBe(0.25);
        expect(tracks.find((track) => track.id === 'track-bass')?.gain).toBe(0.75);
    });

    it('keeps both peers renames when each renames a different track', () => {
        const baseline = baselineDoc();
        const peerA = createPeer(clone(baseline));
        const peerB = createPeer(clone(baseline));

        editPeer(peerA, (tracks) => {
            const drums = tracks.find((track) => track.id === 'track-drums');
            if (drums) {
                drums.name = 'Drum Bus';
            }
        });
        editPeer(peerB, (tracks) => {
            const bass = tracks.find((track) => track.id === 'track-bass');
            if (bass) {
                bass.name = 'Sub Bass';
            }
        });

        const tracks = readMerged(peerA, peerB);

        expect(tracks.map((track) => track.name).sort()).toStrictEqual(['Drum Bus', 'Sub Bass']);
    });

    it('keeps both peers sends when each adds a send to a different bus on the same track', () => {
        const baseline = baselineDoc();
        const peerA = createPeer(clone(baseline));
        const peerB = createPeer(clone(baseline));

        editPeer(peerA, (tracks) => {
            const drums = tracks.find((track) => track.id === 'track-drums');
            if (drums) {
                drums.sends = [...drums.sends, { busId: 'bus-reverb', level: 0.4, preFader: false }];
            }
        });
        editPeer(peerB, (tracks) => {
            const drums = tracks.find((track) => track.id === 'track-drums');
            if (drums) {
                drums.sends = [...drums.sends, { busId: 'bus-delay', level: 0.6, preFader: false }];
            }
        });

        const tracks = readMerged(peerA, peerB);
        const sends = tracks.find((track) => track.id === 'track-drums')?.sends ?? [];

        expect(sends.map((send) => send.busId).sort()).toStrictEqual(['bus-delay', 'bus-reverb']);
        expect(sends.find((send) => send.busId === 'bus-reverb')?.level).toBe(0.4);
        expect(sends.find((send) => send.busId === 'bus-delay')?.level).toBe(0.6);
    });

    it('keeps a peers clip when the other peer concurrently adds a clip to a different track', () => {
        const baseline = baselineDoc();
        const peerA = createPeer(clone(baseline));
        const peerB = createPeer(clone(baseline));

        editPeer(peerA, (tracks) => {
            const drums = tracks.find((track) => track.id === 'track-drums');
            if (drums) {
                drums.clips = [audioClip({ id: 'clip-a', trackId: 'track-drums', name: 'Loop A', endBeat: 4 })];
            }
        });
        editPeer(peerB, (tracks) => {
            const bass = tracks.find((track) => track.id === 'track-bass');
            if (bass) {
                bass.clips = [audioClip({ id: 'clip-b', trackId: 'track-bass', name: 'Loop B', endBeat: 8 })];
            }
        });

        const tracks = readMerged(peerA, peerB);

        expect(tracks.find((track) => track.id === 'track-drums')?.clips.map((clip) => clip.id)).toStrictEqual([
            'clip-a',
        ]);
        expect(tracks.find((track) => track.id === 'track-bass')?.clips.map((clip) => clip.id)).toStrictEqual([
            'clip-b',
        ]);
    });
});
