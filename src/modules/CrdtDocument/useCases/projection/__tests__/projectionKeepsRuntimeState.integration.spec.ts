import { change, clone, merge, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { markerStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { createCrdtDoc } from '../../createCrdtDoc';
import { getCrdtDoc } from '../../getCrdtDoc';
import { registerCrdtStorageRuntime } from '../../registerCrdtStorageRuntime';
import { removeCrdtDoc } from '../../removeCrdtDoc';
import { replaceCrdtDocInLineage } from '../../replaceCrdtDocInLineage';
import { projectCrdtToStores } from '../projectProjection';
import { setupProjectionBridge } from '../setupProjectionBridge';

// A collaborator's change reaches the repository as a lineage replacement, which
// notifies without a slot hint and so re-projects every root slot. The transport
// slot's runtime keys (playing, recording, playhead) are local and never
// synced, so that projection must leave them alone; a project load must not.

type RootDocument = {
    transport?: { tempo?: number; metronomeEnabled?: boolean };
    markers?: { markers: { id: string; beat: number; name: string; color: string }[]; sections: never[] };
};

const PEER_ACTOR_ID = 'bbbbbbbbbbbbbbbb';
const PLAYHEAD_BEAT = 12;

let unsubscribe_projection: (() => void) | null = null;

function live_document(): Doc<RootDocument> {
    const doc = getCrdtDoc<RootDocument>('root');
    if (!doc) {
        throw new Error('Expected a live root document');
    }
    return doc;
}

/** The local document after it merges a collaborator's edit, as a sync receive publishes it. */
function receive_remote_edit(edit: (draft: RootDocument) => void): void {
    const local = live_document();
    const remote = change(clone(local, PEER_ACTOR_ID), edit);
    replaceCrdtDocInLineage({ id: 'root', doc: merge(clone(local), remote) });
}

function start_recording_playback(): void {
    transportStore.set({
        ...defaultTransportState,
        isPlaying: true,
        isRecording: true,
        overdubEnabled: true,
        playheadPosition: PLAYHEAD_BEAT,
    });
    flushAutomergeStorageWrites();
}

function expect_playback_running(): void {
    expect(transportStore.value).toMatchObject({
        isPlaying: true,
        isRecording: true,
        overdubEnabled: true,
        playheadPosition: PLAYHEAD_BEAT,
    });
}

describe('projecting the document into the transport store', () => {
    beforeEach(() => {
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        transportStore.set(defaultTransportState);
        flushAutomergeStorageWrites();
        unsubscribe_projection = setupProjectionBridge();
    });

    afterEach(() => {
        unsubscribe_projection?.();
        unsubscribe_projection = null;
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('keeps playback and recording running when a collaborator edits the tempo', () => {
        start_recording_playback();

        receive_remote_edit((draft) => {
            if (!draft.transport) {
                throw new Error('Expected the transport slot in the forked document');
            }
            draft.transport.tempo = 150;
        });

        expect(transportStore.value?.tempo).toBe(150);
        expect_playback_running();
    });

    it('keeps playback and recording running when a collaborator edits another slot after a local transport edit', () => {
        start_recording_playback();
        transportStore.set({ ...defaultTransportState, ...transportStore.value, metronomeEnabled: true });
        flushAutomergeStorageWrites();

        receive_remote_edit((draft) => {
            draft.markers = {
                markers: [{ id: 'marker-peer', beat: 8, name: 'Chorus', color: '#ff0000' }],
                sections: [],
            };
        });

        expect(markerStore.value?.markers.map((marker) => marker.id)).toEqual(['marker-peer']);
        expect(transportStore.value?.metronomeEnabled).toBe(true);
        expect_playback_running();
    });

    it('keeps playback running when a collaborator edits another slot before the local transport edit is flushed', () => {
        start_recording_playback();
        transportStore.set({ ...defaultTransportState, ...transportStore.value, metronomeEnabled: true });

        receive_remote_edit((draft) => {
            draft.markers = {
                markers: [{ id: 'marker-peer', beat: 8, name: 'Chorus', color: '#ff0000' }],
                sections: [],
            };
        });

        expect(markerStore.value?.markers.map((marker) => marker.id)).toEqual(['marker-peer']);
        expect_playback_running();
    });

    it('keeps playback running when the document has no transport slot', () => {
        start_recording_playback();

        receive_remote_edit((draft) => {
            delete draft.transport;
        });

        expect(live_document().transport).toBeUndefined();
        expect_playback_running();
    });

    it('resets the runtime transport state when a project load re-projects the document', () => {
        start_recording_playback();

        projectCrdtToStores({ resetProjections: true });

        expect(transportStore.value).toMatchObject({
            isPlaying: false,
            isRecording: false,
            overdubEnabled: false,
            playheadPosition: 0,
        });
    });
});
