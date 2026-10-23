import { change, clone, merge, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { markerStore } from '#/modules/Arrangement/stores';
import { midiLearnStore, sanitizeMidiLearnState } from '#/modules/ControlSurface/stores';
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
    midiLearn?: {
        mappingsSchemaVersion: number;
        mappings: {
            id: string;
            channel: number;
            cc: number;
            targetType: 'trackGain';
            trackId: string;
            minValue: number;
            maxValue: number;
        }[];
    };
};

const PEER_ACTOR_ID = 'bbbbbbbbbbbbbbbb';
const PLAYHEAD_BEAT = 12;
const LEARNING_TARGET = { targetType: 'trackGain', trackId: 'track-learning' } as const;
const PEER_MAPPING = {
    id: 'mapping-peer',
    channel: 1,
    cc: 7,
    targetType: 'trackGain',
    trackId: 'track-peer',
    minValue: 0,
    maxValue: 1,
} as const;

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

function arm_midi_learn(): void {
    const current = midiLearnStore.value;
    if (!current) {
        throw new Error('Expected the MIDI Learn store to be initialised');
    }
    midiLearnStore.set({ ...current, isLearning: true, learningTarget: LEARNING_TARGET });
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
        midiLearnStore.set(sanitizeMidiLearnState(undefined));
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

    it('keeps an armed MIDI learn and takes the mappings from the document when a collaborator maps a controller', () => {
        arm_midi_learn();

        receive_remote_edit((draft) => {
            draft.midiLearn = {
                mappingsSchemaVersion: midiLearnStore.value?.mappingsSchemaVersion ?? 1,
                mappings: [PEER_MAPPING],
            };
        });

        expect(midiLearnStore.value?.mappings.map((mapping) => mapping.id)).toEqual([PEER_MAPPING.id]);
        expect(midiLearnStore.value).toMatchObject({ isLearning: true, learningTarget: LEARNING_TARGET });
    });

    it('resets an armed MIDI learn when a project load re-projects the document', () => {
        arm_midi_learn();

        projectCrdtToStores({ resetProjections: true });

        expect(midiLearnStore.value).toMatchObject({ isLearning: false, learningTarget: null });
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
