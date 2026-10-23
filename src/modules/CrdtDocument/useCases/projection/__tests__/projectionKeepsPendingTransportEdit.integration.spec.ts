import { change, clone, merge, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { createCrdtDoc } from '../../createCrdtDoc';
import { getCrdtDoc } from '../../getCrdtDoc';
import { registerCrdtStorageRuntime } from '../../registerCrdtStorageRuntime';
import { removeCrdtDoc } from '../../removeCrdtDoc';
import { replaceCrdtDocInLineage } from '../../replaceCrdtDocInLineage';
import { setupProjectionBridge } from '../setupProjectionBridge';

// The store projects the document, and a local durable edit that has not
// flushed yet is the only thing the document does not carry. A projection must
// leave the store's durable fields equal to the document, except for the keys
// that pending edit changed, which win until it flushes and then reach the
// document.

type TransportSlot = { tempo?: number; metronomeEnabled?: boolean };
type RootDocument = { transport?: TransportSlot };

// Sorts after the local actor, so its write wins an Automerge conflict.
const WINNING_PEER_ACTOR_ID = 'ffffffffffffffff';
const EARLIER_PEER_ACTOR_ID = 'bbbbbbbbbbbbbbbb';
const LOCAL_TEMPO = 100;
const PEER_TEMPO = 150;

let unsubscribe_projection: (() => void) | null = null;

function live_document(): Doc<RootDocument> {
    const doc = getCrdtDoc<RootDocument>('root');
    if (!doc) {
        throw new Error('Expected a live root document');
    }
    return doc;
}

function transport_slot(): TransportSlot {
    const slot = live_document().transport;
    if (!slot) {
        throw new Error('Expected the transport slot in the document');
    }
    return slot;
}

function peer_edit_from(
    base: Doc<RootDocument>,
    edit: (draft: RootDocument) => void,
    actorId = WINNING_PEER_ACTOR_ID
): Doc<RootDocument> {
    return change(clone(base, actorId), edit);
}

function receive(remote: Doc<RootDocument>): void {
    replaceCrdtDocInLineage({ id: 'root', doc: merge(clone(live_document()), remote) });
}

function set_peer_tempo(draft: RootDocument): void {
    if (!draft.transport) {
        throw new Error('Expected the transport slot in the forked document');
    }
    draft.transport.tempo = PEER_TEMPO;
}

describe('projecting the document into the transport store', () => {
    beforeEach(() => {
        removeCrdtDoc('root');
        createCrdtDoc('root');
        resetAutomergeStorageProjections('root');
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

    it('keeps a metronome toggle that has not flushed and takes the collaborator tempo, then writes the toggle', () => {
        const base = clone(live_document());
        transportStore.set({ ...defaultTransportState, metronomeEnabled: !defaultTransportState.metronomeEnabled });

        receive(peer_edit_from(base, set_peer_tempo));

        expect(transportStore.value).toMatchObject({
            metronomeEnabled: !defaultTransportState.metronomeEnabled,
            tempo: PEER_TEMPO,
        });

        flushAutomergeStorageWrites();

        expect(transport_slot()).toMatchObject({
            metronomeEnabled: !defaultTransportState.metronomeEnabled,
            tempo: PEER_TEMPO,
        });
        expect(transportStore.value).toMatchObject({
            metronomeEnabled: !defaultTransportState.metronomeEnabled,
            tempo: PEER_TEMPO,
        });
    });

    it('keeps an unflushed local tempo the collaborator also changed, and writes it over theirs', () => {
        const base = clone(live_document());
        transportStore.set({ ...defaultTransportState, tempo: LOCAL_TEMPO });

        receive(peer_edit_from(base, set_peer_tempo));

        flushAutomergeStorageWrites();

        expect(transport_slot().tempo).toBe(LOCAL_TEMPO);
        expect(transportStore.value?.tempo).toBe(LOCAL_TEMPO);
    });

    it('follows the document when the collaborator wins a conflict over a flushed local tempo', () => {
        // The collaborator's tempo was projected once already, so the slot the
        // conflict resolves to is byte-identical to the slot last hydrated.
        const base = clone(live_document());
        receive(peer_edit_from(base, set_peer_tempo, EARLIER_PEER_ACTOR_ID));
        expect(transportStore.value?.tempo).toBe(PEER_TEMPO);
        transportStore.set({ ...defaultTransportState, ...transportStore.value, tempo: LOCAL_TEMPO });
        flushAutomergeStorageWrites();
        expect(transport_slot().tempo).toBe(LOCAL_TEMPO);

        // The collaborator reaches the same tempo through more edits than the
        // local one took, so its write carries the greater counter and wins.
        const peerOvershoot = peer_edit_from(base, (draft) => {
            if (draft.transport) {
                draft.transport.tempo = PEER_TEMPO + 2;
            }
        });
        const peerSettled = change(
            change(peerOvershoot, (draft) => {
                if (draft.transport) {
                    draft.transport.tempo = PEER_TEMPO + 1;
                }
            }),
            set_peer_tempo
        );
        receive(peerSettled);

        expect(transport_slot().tempo).toBe(PEER_TEMPO);
        expect(transportStore.value?.tempo).toBe(PEER_TEMPO);
    });
});
