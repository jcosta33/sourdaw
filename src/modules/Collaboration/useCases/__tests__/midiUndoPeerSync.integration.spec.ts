import { change, clone, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearUndoHistory, pushUndoEntry, undo } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { type MidiNote, midiStore } from '#/modules/MIDI/stores';
import { getNotesForClip, replaceMidiNotesIfUnchanged, resizeMidiNote, setNotesForClip } from '#/modules/MIDI/useCases';

import { AutomergeSync } from '../automergeSync';

import { createPeerSyncMessages } from './peerSyncHandshake';

// #4858 — a MIDI callback undo defers a whole-state store write. When a real
// peer sync lands between the undo and that deferred flush, the stale pending
// snapshot must restore only what the undo actually changed, never rewrite the
// peer's concurrent edit to a different note (or a different field).

type RootDocumentNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};

type RootDocument = {
    midi?: {
        notesByClipId?: Record<string, RootDocumentNote[]>;
    };
};

const CLIP_ID = 'clip-collab';
const EDITED_NOTE_ID = 'note-edited';
const PEER_NOTE_ID = 'note-peer';
/** The peer fork's own actor id, so its change never collides with the live document's. */
const PEER_ACTOR_ID = 'bbbbbbbbbbbbbbbb';

function seedNotes(): MidiNote[] {
    return [
        { id: EDITED_NOTE_ID, pitch: 60, startBeat: 0, duration: 3, velocity: 100 },
        { id: PEER_NOTE_ID, pitch: 64, startBeat: 4, duration: 2, velocity: 50 },
    ];
}

function create_sync(): AutomergeSync {
    return new AutomergeSync({
        getConnectedPeerIds: () => [],
        sendCrdtSync: () => undefined,
    });
}

function live_document(): Doc<RootDocument> {
    const doc = getCrdtDoc<RootDocument>('root');
    if (!doc) {
        throw new Error('Expected a live root document');
    }
    return doc;
}

function document_notes(): RootDocumentNote[] {
    const notes = live_document().midi?.notesByClipId?.[CLIP_ID];
    if (!notes) {
        throw new Error(`Expected ${CLIP_ID} notes in the root document`);
    }
    return notes;
}

function document_note(note_id: string): RootDocumentNote {
    const note = document_notes().find((candidate) => candidate.id === note_id);
    if (!note) {
        throw new Error(`Expected note ${note_id} in the root document`);
    }
    return note;
}

function store_note(note_id: string): MidiNote {
    const note = midiStore.value?.notesByClipId[CLIP_ID]?.find((candidate) => candidate.id === note_id);
    if (!note) {
        throw new Error(`Expected note ${note_id} in the projected MIDI store`);
    }
    return note;
}

/** The peer's own copy of the live document — same lineage, distinct actor. */
function peer_fork(): Doc<RootDocument> {
    return clone(live_document(), PEER_ACTOR_ID);
}

function deliver_peer_sync(remote: Doc<RootDocument>): AutomergeSync {
    const sync = create_sync();
    for (const syncMessageBase64 of createPeerSyncMessages({ remote, local: live_document() })) {
        sync.receiveSync({ peerId: 'peer-1', docId: 'root', syncMessageBase64 });
    }
    return sync;
}

function drain_frame(): void {
    for (const callback of frame_callbacks.splice(0)) {
        callback(16);
    }
}

let frame_callbacks: FrameRequestCallback[] = [];
let unsubscribe_projection: (() => void) | null = null;

describe('MIDI callback undo against a concurrent peer note edit (#4858)', () => {
    beforeEach(() => {
        frame_callbacks = [];
        // The deferred write is driven by hand so the peer sync provably lands
        // while the undo's store write is still pending.
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
            frame_callbacks.push(callback);
            return frame_callbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', () => {});
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearUndoHistory();
        unsubscribe_projection = setupProjectionBridge();
    });

    afterEach(() => {
        unsubscribe_projection?.();
        unsubscribe_projection = null;
        clearUndoHistory();
        flushAutomergeStorageWrites();
        vi.unstubAllGlobals();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('restores the edited note without reverting a peer edit to a different note', async () => {
        setNotesForClip(CLIP_ID, seedNotes());
        drain_frame();
        expect(document_note(EDITED_NOTE_ID).velocity).toBe(100);
        expect(document_note(PEER_NOTE_ID).velocity).toBe(50);

        // Forward edit: resize the edited note 3 → 1 and let the write land.
        const before_notes = structuredClone(getNotesForClip(CLIP_ID));
        resizeMidiNote(CLIP_ID, EDITED_NOTE_ID, undefined, 1);
        drain_frame();
        expect(document_note(EDITED_NOTE_ID).duration).toBe(1);

        // The production undo registration for a note resize
        // (pushEditedNoteUndo): per-note expected/replacement through the
        // production restore use case.
        const after_note = getNotesForClip(CLIP_ID).find((note) => note.id === EDITED_NOTE_ID);
        const before_note = before_notes.find((note) => note.id === EDITED_NOTE_ID);
        if (!after_note || !before_note) {
            throw new Error('Expected the edited note before and after the resize');
        }
        pushUndoEntry(
            'Resize MIDI note',
            () => replaceMidiNotesIfUnchanged(CLIP_ID, [{ expected: after_note, replacement: before_note }]),
            () => replaceMidiNotesIfUnchanged(CLIP_ID, [{ expected: before_note, replacement: after_note }])
        );

        // The undo consumes the history entry while its store write stays pending.
        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect(countPendingAutomergeStorageWrites()).toBeGreaterThan(0);
        expect(document_note(EDITED_NOTE_ID).duration).toBe(1);

        // A real peer changes the OTHER note's velocity while the undo write
        // is still deferred, and it projects through the production bridge.
        const peer = change(peer_fork(), (draft) => {
            const notes = draft.midi?.notesByClipId?.[CLIP_ID];
            const peer_note = notes?.find((candidate) => candidate.id === PEER_NOTE_ID);
            if (!peer_note) {
                throw new Error('Expected the peer note in the forked document');
            }
            peer_note.velocity = 77;
        });
        const sync = deliver_peer_sync(peer);
        expect(document_note(PEER_NOTE_ID).velocity).toBe(77);
        await sync.flushPersistence();

        flushAutomergeStorageWrites();

        // The undo still restores the edited note…
        expect(document_note(EDITED_NOTE_ID).duration).toBe(3);
        // …and the peer's concurrent edit survives in the document…
        expect(document_note(PEER_NOTE_ID).velocity).toBe(77);
        // …and in the projected store.
        expect(store_note(EDITED_NOTE_ID).duration).toBe(3);
        expect(store_note(PEER_NOTE_ID).velocity).toBe(77);
    });

    it('restores the edited field without reverting a peer edit to another field of the same note', async () => {
        setNotesForClip(CLIP_ID, seedNotes());
        drain_frame();

        const before_notes = structuredClone(getNotesForClip(CLIP_ID));
        resizeMidiNote(CLIP_ID, EDITED_NOTE_ID, undefined, 1);
        drain_frame();
        expect(document_note(EDITED_NOTE_ID).duration).toBe(1);

        const after_note = getNotesForClip(CLIP_ID).find((note) => note.id === EDITED_NOTE_ID);
        const before_note = before_notes.find((note) => note.id === EDITED_NOTE_ID);
        if (!after_note || !before_note) {
            throw new Error('Expected the edited note before and after the resize');
        }
        pushUndoEntry(
            'Resize MIDI note',
            () => replaceMidiNotesIfUnchanged(CLIP_ID, [{ expected: after_note, replacement: before_note }]),
            () => replaceMidiNotesIfUnchanged(CLIP_ID, [{ expected: before_note, replacement: after_note }])
        );
        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect(countPendingAutomergeStorageWrites()).toBeGreaterThan(0);

        // The peer concurrently changes the edited note's velocity — a field
        // the undo never touched — while the undo write is still deferred.
        const peer = change(peer_fork(), (draft) => {
            const notes = draft.midi?.notesByClipId?.[CLIP_ID];
            const edited = notes?.find((candidate) => candidate.id === EDITED_NOTE_ID);
            if (!edited) {
                throw new Error('Expected the edited note in the forked document');
            }
            edited.velocity = 88;
        });
        const sync = deliver_peer_sync(peer);
        expect(document_note(EDITED_NOTE_ID).velocity).toBe(88);
        await sync.flushPersistence();

        flushAutomergeStorageWrites();

        expect(document_note(EDITED_NOTE_ID).duration).toBe(3);
        expect(document_note(EDITED_NOTE_ID).velocity).toBe(88);
        expect(store_note(EDITED_NOTE_ID).duration).toBe(3);
        expect(store_note(EDITED_NOTE_ID).velocity).toBe(88);
    });

    it('leaves a note a peer deleted gone when the deferred undo write never touched it', async () => {
        setNotesForClip(CLIP_ID, seedNotes());
        drain_frame();
        expect(document_note(EDITED_NOTE_ID).velocity).toBe(100);
        expect(document_note(PEER_NOTE_ID).velocity).toBe(50);

        const before_notes = structuredClone(getNotesForClip(CLIP_ID));
        resizeMidiNote(CLIP_ID, EDITED_NOTE_ID, undefined, 1);
        drain_frame();
        expect(document_note(EDITED_NOTE_ID).duration).toBe(1);

        const after_note = getNotesForClip(CLIP_ID).find((note) => note.id === EDITED_NOTE_ID);
        const before_note = before_notes.find((note) => note.id === EDITED_NOTE_ID);
        if (!after_note || !before_note) {
            throw new Error('Expected the edited note before and after the resize');
        }
        pushUndoEntry(
            'Resize MIDI note',
            () => replaceMidiNotesIfUnchanged(CLIP_ID, [{ expected: after_note, replacement: before_note }]),
            () => replaceMidiNotesIfUnchanged(CLIP_ID, [{ expected: before_note, replacement: after_note }])
        );
        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect(countPendingAutomergeStorageWrites()).toBeGreaterThan(0);

        // A real peer deletes the OTHER note outright — a whole row the
        // pending snapshot still carries, unchanged — while the undo write
        // is still deferred.
        const peer = change(peer_fork(), (draft) => {
            const notes = draft.midi?.notesByClipId?.[CLIP_ID];
            if (!notes) {
                throw new Error(`Expected ${CLIP_ID} notes in the forked document`);
            }
            const peer_index = notes.findIndex((candidate) => candidate.id === PEER_NOTE_ID);
            if (peer_index === -1) {
                throw new Error(`Expected note ${PEER_NOTE_ID} in the forked document`);
            }
            notes.splice(peer_index, 1);
        });
        const sync = deliver_peer_sync(peer);
        expect(document_notes().some((candidate) => candidate.id === PEER_NOTE_ID)).toBe(false);
        await sync.flushPersistence();

        flushAutomergeStorageWrites();

        // The undo still restores the edited note…
        expect(document_note(EDITED_NOTE_ID).duration).toBe(3);
        // …and the peer's deletion stands in the document…
        expect(document_notes().some((candidate) => candidate.id === PEER_NOTE_ID)).toBe(false);
        // …and in the projected store.
        expect(store_note(EDITED_NOTE_ID).duration).toBe(3);
        expect(
            midiStore.value?.notesByClipId[CLIP_ID]?.some((candidate) => candidate.id === PEER_NOTE_ID) ?? false
        ).toBe(false);
    });
});
