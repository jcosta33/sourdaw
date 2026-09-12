import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, markerStore, trackStore, type Clip } from '#/modules/Arrangement/stores';
import { createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { projectClipMidiEvents } from '#/modules/MIDI/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

// #3763 — forward MIDI completion must extend the playable phrase: real
// production handlers, real stores, real dispatch, real undo machinery, and
// the real groove projection. Appending generated notes to a source clip
// whose extent ends at the last note left the completion outside the
// playable region, and the notes-only inverse could not restore extent
// changes — so the continuation now lands in its own clip whose extent
// covers exactly the written notes.

const mocks = vi.hoisted(() => ({
    llmGenerateNotes: vi.fn(),
}));

vi.mock('#/modules/AiGeneration/handlers/aiMidi/llmNoteHelpers', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiGeneration/handlers/aiMidi/llmNoteHelpers')>()),
    llmGenerateNotes: mocks.llmGenerateNotes,
}));

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

function clipByName(name: string): Clip | undefined {
    return trackStore.value?.tracks.flatMap((track) => track.clips).find((clip) => clip.name === name);
}

function notesFor(
    clipId: string
): { id: string; pitch: number; startBeat: number; duration: number; velocity: number }[] {
    return (midiStore.value?.notesByClipId[clipId] ?? []).map((note) => ({
        id: note.id,
        pitch: note.pitch,
        startBeat: note.startBeat,
        duration: note.duration,
        velocity: note.velocity,
    }));
}

function writtenNoteShapes(clipId: string): { pitch: number; startBeat: number; duration: number; velocity: number }[] {
    return notesFor(clipId).map(({ pitch, startBeat, duration, velocity }) => ({
        pitch,
        startBeat,
        duration,
        velocity,
    }));
}

/**
 * The same projection call the transport scheduler makes: notes + clip
 * geometry in, audible timeline events out.
 */
function projectedEvents(clip: Clip): { startBeat: number; duration: number; pitch: number }[] {
    return projectClipMidiEvents({
        events: notesFor(clip.id),
        clipId: clip.id,
        clipStartBeat: clip.startBeat,
        clipEndBeat: clip.endBeat,
        iterationStartBeat: clip.startBeat,
        loopLengthBeats: clip.endBeat - clip.startBeat,
        midiOffsetBeats: clip.midiOffsetBeats ?? 0,
    }).map((event) => ({ startBeat: event.startBeat, duration: event.duration, pitch: event.pitch }));
}

describe('forward MIDI completion extends the playable phrase (#3763)', () => {
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
        resetCrdtProjectAuthority('complete midi continuation integration');
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
        mocks.llmGenerateNotes.mockReset();
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

    async function createSourceClip(clip: Partial<Clip> & { id: string; endBeat: number }): Promise<Clip> {
        const payload = {
            id: clip.id,
            trackId: 't1',
            startBeat: clip.startBeat ?? 0,
            endBeat: clip.endBeat,
            name: clip.name ?? 'Lead',
            type: 'midi' as const,
        };
        if (clip.midiOffsetBeats !== undefined) {
            payload.midiOffsetBeats = clip.midiOffsetBeats;
        }
        await executeAppAction({ type: 'addClip', payload });
        const source = clipByName(clip.name ?? 'Lead');
        if (!source) {
            throw new Error('Expected the source clip to exist');
        }
        return source;
    }

    it('places the completion in an audible continuation clip and undoes and redoes notes and geometry', async () => {
        await createSourceClip({ id: 'src', startBeat: 0, endBeat: 4 });
        await executeAppAction({
            type: 'addNotes',
            payload: { clipId: 'src', notes: [{ pitch: 60, startBeat: 0, duration: 4, velocity: 100 }] },
        });
        // The model continues exactly where the source phrase ends (beat 4).
        mocks.llmGenerateNotes.mockResolvedValue([
            { pitch: 62, startBeat: 4, duration: 1, velocity: 90 },
            { pitch: 64, startBeat: 5, duration: 3, velocity: 80 },
        ]);

        await executeAppAction({ type: 'completeMidi', payload: { clipId: 'src', direction: 'forward', bars: 1 } });

        expect(mocks.llmGenerateNotes).toHaveBeenCalledTimes(1);
        const continuation = clipByName('Lead (continuation)');
        if (!continuation) {
            throw new Error('Expected the continuation clip to be created');
        }
        expect(continuation.startBeat).toBe(4);
        expect(continuation.endBeat).toBe(8);
        expect(writtenNoteShapes(continuation.id)).toEqual([
            { pitch: 62, startBeat: 0, duration: 1, velocity: 90 },
            { pitch: 64, startBeat: 1, duration: 3, velocity: 80 },
        ]);
        // The source clip keeps its identity, extent, and its own notes.
        const sourceAfterWrite = clipByName('Lead');
        if (!sourceAfterWrite) {
            throw new Error('Expected the source clip to survive');
        }
        expect(sourceAfterWrite.endBeat).toBe(4);
        expect(writtenNoteShapes(sourceAfterWrite.id)).toEqual([
            { pitch: 60, startBeat: 0, duration: 4, velocity: 100 },
        ]);

        // The generated material is audible in the real projection.
        expect(projectedEvents(continuation)).toEqual([
            { startBeat: 4, duration: 1, pitch: 62 },
            { startBeat: 5, duration: 3, pitch: 64 },
        ]);

        const undone = await undo();
        expect(undone.headConsumed).toBe(true);
        expect(clipByName('Lead (continuation)')).toBeUndefined();
        expect(trackStore.value?.tracks.flatMap((track) => track.clips).map((clip) => clip.name)).toEqual(['Lead']);
        expect(projectedEvents(sourceAfterWrite)).toEqual([{ startBeat: 0, duration: 4, pitch: 60 }]);

        await redo();
        const replayed = clipByName('Lead (continuation)');
        if (!replayed) {
            throw new Error('Expected redo to recreate the continuation clip');
        }
        expect(replayed.startBeat).toBe(4);
        expect(replayed.endBeat).toBe(8);
        expect(writtenNoteShapes(replayed.id)).toEqual([
            { pitch: 62, startBeat: 0, duration: 1, velocity: 90 },
            { pitch: 64, startBeat: 1, duration: 3, velocity: 80 },
        ]);
        expect(projectedEvents(replayed)).toEqual([
            { startBeat: 4, duration: 1, pitch: 62 },
            { startBeat: 5, duration: 3, pitch: 64 },
        ]);
        // Redo replayed the committed result; the model never ran again.
        expect(mocks.llmGenerateNotes).toHaveBeenCalledTimes(1);
        // The setup actions (addClip, addNotes) and the completion each hold
        // one undo entry after the undo/redo cycle.
        expect(undoHistoryStore.value?.past).toHaveLength(3);
    });

    it('places the continuation from a trimmed source at the position its material coordinates map to', async () => {
        // Visible window [4, 8); the material origin sits at 2, so the stored
        // note 2..6 is the audible phrase and beat 6 is its audible end.
        await createSourceClip({ id: 'src', startBeat: 4, endBeat: 8, midiOffsetBeats: 2 });
        await executeAppAction({
            type: 'addNotes',
            payload: { clipId: 'src', notes: [{ pitch: 60, startBeat: 2, duration: 4, velocity: 100 }] },
        });
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 62, startBeat: 6, duration: 2, velocity: 90 }]);

        await executeAppAction({ type: 'completeMidi', payload: { clipId: 'src', direction: 'forward', bars: 1 } });

        const continuation = clipByName('Lead (continuation)');
        if (!continuation) {
            throw new Error('Expected the continuation clip to be created');
        }
        // Material beat 6 plays at 4 + (6 - 2): the continuation starts where
        // the source's audible phrase ends, not four beats early.
        expect(continuation.startBeat).toBe(8);
        expect(continuation.endBeat).toBe(10);
        expect(projectedEvents(continuation)).toEqual([{ startBeat: 8, duration: 2, pitch: 62 }]);
        const sourceAfterWrite = clipByName('Lead');
        if (!sourceAfterWrite) {
            throw new Error('Expected the source clip to survive');
        }
        expect(projectedEvents(sourceAfterWrite)).toEqual([{ startBeat: 4, duration: 4, pitch: 60 }]);
    });

    it('covers the actual written notes when the phrase resumes inside the silent tail', async () => {
        // The source's last note ends at beat 3; beats 3..4 are trailing silence.
        await createSourceClip({ id: 'src', startBeat: 0, endBeat: 4 });
        await executeAppAction({
            type: 'addNotes',
            payload: { clipId: 'src', notes: [{ pitch: 60, startBeat: 0, duration: 3, velocity: 100 }] },
        });
        mocks.llmGenerateNotes.mockResolvedValue([{ pitch: 62, startBeat: 3, duration: 2, velocity: 90 }]);

        await executeAppAction({ type: 'completeMidi', payload: { clipId: 'src', direction: 'forward', bars: 1 } });

        const continuation = clipByName('Lead (continuation)');
        if (!continuation) {
            throw new Error('Expected the continuation clip to be created');
        }
        // The extent covers exactly the written notes (3..5), not a blind
        // bars-sized window past the old extent.
        expect(continuation.startBeat).toBe(3);
        expect(continuation.endBeat).toBe(5);
        expect(projectedEvents(continuation)).toEqual([{ startBeat: 3, duration: 2, pitch: 62 }]);
        const sourceAfterWrite = clipByName('Lead');
        if (!sourceAfterWrite) {
            throw new Error('Expected the source clip to survive');
        }
        expect(projectedEvents(sourceAfterWrite)).toEqual([{ startBeat: 0, duration: 3, pitch: 60 }]);
    });
});
