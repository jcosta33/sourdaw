import { getHeads } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, markerStore, trackStore, type Clip } from '#/modules/Arrangement/stores';
import { createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { type AppAction, type MidiClipNoteSnapshot } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

// #4876 — a generated MIDI replay used to admit sparse JavaScript note arrays:
// Array.prototype.every skips missing slots and Array.prototype.map preserves
// them, so `new Array(1)` passed replay admission and the handler created the
// destination clip or restored the track first — then stored the mapped notes,
// where the hole normalized away and the document advanced with an empty note
// list, silently losing the generated notes. These cases dispatch the real
// action through the real production handlers and observe the refusal at the
// document boundary: no clip, no track, no document head, no history entry.

type ReplayAction = Extract<AppAction, { type: 'replayGeneratedMidi' }>;
type ReplayClip = Extract<ReplayAction['payload']['operation'], { kind: 'create-clip' }>['clip'];

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

type ArrangementTrackEvents = {
    'track.added': { trackId: string; name: string; kind: string };
    'track.removed': { trackId: string };
    'track.selectionChanged': { trackId: string | null; previousTrackId: string | null };
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function generatedNote(): MidiClipNoteSnapshot {
    return { id: 'generated-note', pitch: 62, startBeat: 0, duration: 1, velocity: 90 };
}

function clipById(clipId: string): Clip | undefined {
    return trackStore.value?.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId);
}

function noteShapes(clipId: string): { pitch: number; startBeat: number; duration: number; velocity: number }[] {
    return (midiStore.value?.notesByClipId[clipId] ?? []).map((note) => ({
        pitch: note.pitch,
        startBeat: note.startBeat,
        duration: note.duration,
        velocity: note.velocity,
    }));
}

type DocumentObservation = {
    heads: ReturnType<typeof getHeads>;
    document: string;
    projection: { tracks: typeof trackStore.value; midi: typeof midiStore.value };
    history: typeof undoHistoryStore.value;
};

function observeDocument(): DocumentObservation {
    const doc = getCrdtDoc('root');
    if (!doc) {
        throw new Error('Expected authoritative project document');
    }
    return {
        heads: getHeads(doc),
        document: JSON.stringify(doc),
        projection: { tracks: structuredClone(trackStore.value), midi: structuredClone(midiStore.value) },
        history: undoHistoryStore.value,
    };
}

function expectDocumentUnchanged(before: DocumentObservation): void {
    flushAutomergeStorageWrites();
    const doc = getCrdtDoc('root');
    if (!doc) {
        throw new Error('Expected authoritative project document');
    }
    expect(getHeads(doc)).toEqual(before.heads);
    expect(JSON.stringify(doc)).toBe(before.document);
    expect({ tracks: trackStore.value, midi: midiStore.value }).toEqual(before.projection);
    expect(undoHistoryStore.value).toBe(before.history);
}

describe('replay generated MIDI refuses sparse note arrays before mutating (#4876)', () => {
    let notifications: NotifyPayload[] = [];
    let unsubscribeFromNotifications: () => void = () => undefined;

    beforeEach(() => {
        Container.clear();
        const notificationEventBus = createEventBus<NotificationEvents>();
        notifications = [];
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationEventBus);
        setArrangementEventBus(createEventBus<ArrangementTrackEvents>());
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('replay sparse note arrays integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        automationStore.set({ lanes: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        markerStore.set({ markers: [], sections: [] });
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: 't1', name: 'Lead', kind: 'midi' })],
            selectedTrackId: 't1',
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setTrackStoreState(structuredClone(defaultTrackState));
        markerStore.set({ markers: [], sections: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        unsubscribeFromNotifications();
        unsubscribeFromNotifications = () => undefined;
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    async function createSource(): Promise<{ sourceClip: ReplayClip; sourceNotes: MidiClipNoteSnapshot[] }> {
        await executeAppAction({
            type: 'addClip',
            payload: { id: 'src', trackId: 't1', startBeat: 0, endBeat: 4, name: 'Lead', type: 'midi' },
        });
        await executeAppAction({
            type: 'addNotes',
            payload: { clipId: 'src', notes: [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] },
        });
        flushAutomergeStorageWrites();
        const source = clipById('src');
        if (!source) {
            throw new Error('Expected the source clip to exist');
        }
        return {
            sourceClip: {
                id: source.id,
                trackId: source.trackId,
                name: source.name,
                startBeat: source.startBeat,
                endBeat: source.endBeat,
                type: 'midi',
            },
            sourceNotes: structuredClone(midiStore.value?.notesByClipId.src ?? []),
        };
    }

    it('refuses a create-clip replay whose notes array is wholly sparse', async () => {
        const { sourceClip, sourceNotes } = await createSource();
        const before = observeDocument();
        const whollySparse: MidiClipNoteSnapshot[] = [];
        whollySparse.length = 1; // a wholly missing slot — a hole, never a JSON value

        await expect(
            executeAppAction({
                type: 'replayGeneratedMidi',
                payload: {
                    operation: {
                        kind: 'create-clip',
                        source: { trackId: sourceClip.trackId, clip: sourceClip, notes: sourceNotes },
                        targetTrackId: sourceClip.trackId,
                        clip: { ...sourceClip, id: 'generated-clip', name: 'Generated' },
                        notes: whollySparse,
                    },
                },
            })
        ).rejects.toThrow();

        expectDocumentUnchanged(before);
        expect(clipById('generated-clip')).toBeUndefined();
    });

    it('refuses a create-track replay whose notes array holds a missing slot after a valid note', async () => {
        const { sourceClip, sourceNotes } = await createSource();

        // Build the canonical track snapshot the way the generator does: the
        // live store track holding the generated clip, serialized verbatim.
        await executeAppAction({
            type: 'addTrack',
            payload: { id: 'generated-track', name: 'Bass', kind: 'midi' },
        });
        await executeAppAction({
            type: 'addClip',
            payload: {
                id: 'generated-clip',
                trackId: 'generated-track',
                startBeat: 0,
                endBeat: 4,
                name: 'Bassline',
                type: 'midi',
            },
        });
        const liveTrack = trackStore.value?.tracks.find((track) => track.id === 'generated-track');
        if (!liveTrack) {
            throw new Error('Expected the generated track to exist');
        }
        const trackJson = JSON.stringify(liveTrack);
        while (trackStore.value?.tracks.some((track) => track.id === 'generated-track')) {
            await undo();
        }
        flushAutomergeStorageWrites();
        const before = observeDocument();

        const sparseNotes: MidiClipNoteSnapshot[] = [{ ...generatedNote(), pitch: 36 }];
        sparseNotes.length = 2; // the slot after the valid note is missing — a hole, never a JSON value

        await expect(
            executeAppAction({
                type: 'replayGeneratedMidi',
                payload: {
                    operation: {
                        kind: 'create-track',
                        source: { trackId: sourceClip.trackId, clip: sourceClip, notes: sourceNotes },
                        trackJson,
                        trackIndex: 1,
                        clip: {
                            id: 'generated-clip',
                            trackId: 'generated-track',
                            name: 'Bassline',
                            startBeat: 0,
                            endBeat: 4,
                            type: 'midi',
                        },
                        notes: sparseNotes,
                    },
                },
            })
        ).rejects.toThrow();

        expectDocumentUnchanged(before);
        expect(trackStore.value?.tracks.some((track) => track.id === 'generated-track')).toBe(false);
    });

    it('refuses a replace-notes replay whose replacementNotes array holds a missing slot after a valid note', async () => {
        const { sourceClip, sourceNotes } = await createSource();
        const before = observeDocument();
        const sparseNotes: MidiClipNoteSnapshot[] = [generatedNote()];
        sparseNotes.length = 2; // the slot after the valid note is missing — a hole, never a JSON value

        await expect(
            executeAppAction({
                type: 'replayGeneratedMidi',
                payload: {
                    operation: {
                        kind: 'replace-notes',
                        trackId: sourceClip.trackId,
                        clip: sourceClip,
                        expectedNotes: sourceNotes,
                        replacementNotes: sparseNotes,
                    },
                },
            })
        ).rejects.toThrow();

        expectDocumentUnchanged(before);
        expect(noteShapes('src')).toEqual([{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }]);
    });

    it('refuses a create-clip replay whose notes array holds an explicit JSON null element', async () => {
        const { sourceClip, sourceNotes } = await createSource();
        const before = observeDocument();
        const action: ReplayAction = {
            type: 'replayGeneratedMidi',
            payload: {
                operation: {
                    kind: 'create-clip',
                    source: { trackId: sourceClip.trackId, clip: sourceClip, notes: sourceNotes },
                    targetTrackId: sourceClip.trackId,
                    clip: { ...sourceClip, id: 'generated-clip', name: 'Generated' },
                    notes: [generatedNote()],
                },
            },
        };
        // A present position holding JSON null is invalid payload the static
        // contract cannot express; inject it past the compiler to prove the
        // runtime contract refuses it — distinct from a missing slot (#4876).
        Object.assign(action.payload.operation, { notes: [null] });

        await expect(executeAppAction(action)).rejects.toThrow();

        expectDocumentUnchanged(before);
        expect(clipById('generated-clip')).toBeUndefined();
    });

    it('writes a create-clip replay with a dense notes array', async () => {
        const { sourceClip, sourceNotes } = await createSource();
        const before = observeDocument();

        await executeAppAction({
            type: 'replayGeneratedMidi',
            payload: {
                operation: {
                    kind: 'create-clip',
                    source: { trackId: sourceClip.trackId, clip: sourceClip, notes: sourceNotes },
                    targetTrackId: sourceClip.trackId,
                    clip: { ...sourceClip, id: 'generated-clip', name: 'Generated' },
                    notes: [generatedNote()],
                },
            },
        });
        flushAutomergeStorageWrites();

        const doc = getCrdtDoc('root');
        if (!doc) {
            throw new Error('Expected authoritative project document');
        }
        expect(getHeads(doc)).not.toEqual(before.heads);
        expect(clipById('generated-clip')).toBeDefined();
        expect(noteShapes('generated-clip')).toEqual([{ pitch: 62, startBeat: 0, duration: 1, velocity: 90 }]);
    });

    it('writes a create-clip replay with a valid empty notes array', async () => {
        const { sourceClip, sourceNotes } = await createSource();
        const before = observeDocument();

        await executeAppAction({
            type: 'replayGeneratedMidi',
            payload: {
                operation: {
                    kind: 'create-clip',
                    source: { trackId: sourceClip.trackId, clip: sourceClip, notes: sourceNotes },
                    targetTrackId: sourceClip.trackId,
                    clip: { ...sourceClip, id: 'generated-clip', name: 'Generated' },
                    notes: [],
                },
            },
        });
        flushAutomergeStorageWrites();

        const doc = getCrdtDoc('root');
        if (!doc) {
            throw new Error('Expected authoritative project document');
        }
        expect(getHeads(doc)).not.toEqual(before.heads);
        expect(clipById('generated-clip')).toBeDefined();
        expect(noteShapes('generated-clip')).toEqual([]);
    });
});
