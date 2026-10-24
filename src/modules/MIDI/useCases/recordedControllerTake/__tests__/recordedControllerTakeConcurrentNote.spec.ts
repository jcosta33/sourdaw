import { change, clone, from, merge, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';

import { heldPedalState } from '../../../repositories/webMidi/heldPedalState';
import { recordedControllerTakeState } from '../../../repositories/webMidi/recordedControllerTakeState';
import { defaultMidiStoreState, midiStore } from '../../../stores/midiStore';
import { appendRecordedMidiNote } from '../../appendRecordedMidiNote';
import { beginRecordedControllerTake } from '../beginRecordedControllerTake';
import { bufferRecordedMidiCC } from '../bufferRecordedMidiCC';
import { commitRecordedControllers } from '../commitRecordedControllers';

const mocks = vi.hoisted(() => ({
    activeRecordingRef: { current: [] as string[] },
    trackState: {
        value: null as { tracks: { id: string; clips: { id: string; startBeat: number; endBeat: number }[] }[] } | null,
    },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    activeRecordingRef: mocks.activeRecordingRef,
    trackStore: {
        get value() {
            return mocks.trackState.value;
        },
    },
}));

vi.mock('#/modules/ControlSurface/useCases', () => ({
    getMidiLearnState: () => null,
}));

vi.mock('../../../repositories/webMidi/getTargetTrackId', () => ({
    getTargetTrackId: () => 'track-1',
}));

type RootDocument = Record<string, unknown>;
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

const CLIP = 'rec-clip-1';
const FIRST_NOTE = { id: 'note-from-peer', pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
/** The clip the take opened, on the timeline from beat 4 to beat 8. */
const CLIP_SPAN = { id: CLIP, startBeat: 4, endBeat: 8 };

/** Automerge breaks a conflict on one key by actor id, so the tests fix both to try each side winning. */
const LOW_ACTOR = '00000000000000000000000000000001';
const HIGH_ACTOR = 'ffffffffffffffffffffffffffffffff';

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

type Peer = ReturnType<typeof createPeer>;

/** Run `edit` against the real MIDI store as this peer's replica of the document, and flush it into that replica. */
function editAs(peer: Peer, edit: () => void): void {
    configureAutomergeStoragePort(peer.port);
    midiStore.hydrate();
    edit();
    flushAutomergeStorageWrites();
}

function readMerged(merged: Doc<RootDocument>) {
    configureAutomergeStoragePort(createPeer(merged).port);
    midiStore.hydrate();
    return midiStore.value;
}

beforeEach(() => {
    mocks.activeRecordingRef.current = [CLIP];
    mocks.trackState.value = { tracks: [{ id: 'track-1', clips: [CLIP_SPAN] }] };
    heldPedalState.clear();
    recordedControllerTakeState.buffers.clear();
    recordedControllerTakeState.openedClipIds.clear();
    recordedControllerTakeState.committedClipIds.clear();
    recordedControllerTakeState.heldPedalSeeds.clear();
});

afterEach(() => {
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
});

/**
 * A take of controllers alone commits on one peer while another peer, which saw
 * the recorder's clip with no note list for the whole take, writes the clip's
 * first note. The commit leaves the clip's note list absent, so the two writes
 * touch different keys and neither can displace the other.
 */
describe('a controller-only take committing while a peer writes the clip first note', () => {
    it.each([
        { name: 'the committing peer holds the lower actor id', committer: LOW_ACTOR, peer: HIGH_ACTOR },
        { name: 'the committing peer holds the higher actor id', committer: HIGH_ACTOR, peer: LOW_ACTOR },
    ])('keeps the peer note and the take controllers in both merge orders when $name', ({ committer, peer }) => {
        const baseline = from<RootDocument>({ midi: defaultMidiStoreState });
        const committingPeer = createPeer(clone(baseline, { actor: committer }));
        const notePeer = createPeer(clone(baseline, { actor: peer }));

        editAs(committingPeer, () => {
            beginRecordedControllerTake();
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 64, value: 127, beat: 0.5, channel: 0 } });
            bufferRecordedMidiCC({ clipId: CLIP, row: { controller: 64, value: 0, beat: 1.5, channel: 0 } });
            commitRecordedControllers({ clip: CLIP_SPAN });
        });
        editAs(notePeer, () => {
            appendRecordedMidiNote({ clipId: CLIP, note: FIRST_NOTE });
        });

        const mergedForwards = readMerged(merge(clone(committingPeer.getDoc()), notePeer.getDoc()));
        const mergedBackwards = readMerged(merge(clone(notePeer.getDoc()), committingPeer.getDoc()));

        for (const merged of [mergedForwards, mergedBackwards]) {
            expect(merged?.notesByClipId[CLIP]).toEqual([FIRST_NOTE]);
            expect(
                merged?.ccByClipId[CLIP]?.map(({ controller, value, beat }) => ({ controller, value, beat }))
            ).toEqual([
                { controller: 64, value: 127, beat: 0.5 },
                { controller: 64, value: 0, beat: 1.5 },
            ]);
        }
    });
});
