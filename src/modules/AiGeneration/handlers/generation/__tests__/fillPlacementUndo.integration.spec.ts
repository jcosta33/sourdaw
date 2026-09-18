import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, markerStore, trackStore, type Track } from '#/modules/Arrangement/stores';
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
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

// #3765 — full-stack proof that the fill/transition generation actions write
// real material and that undo/redo replay it: real production handlers, real
// stores, real dispatch and real undo machinery.

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

function drumTrackClips(): Track['clips'] {
    return trackStore.value?.tracks.find((track) => track.name === 'Drums')?.clips ?? [];
}

function placedFillNotes(): { clip: Track['clips'][number]; starts: number[]; ends: number[] } | null {
    const clip = drumTrackClips()[0];
    if (!clip) {
        return null;
    }
    const notes = midiStore.value?.notesByClipId[clip.id] ?? [];
    return {
        clip,
        starts: notes.map((note) => clip.startBeat + note.startBeat),
        ends: notes.map((note) => clip.startBeat + note.startBeat + note.duration),
    };
}

describe('fill generation placement, undo and redo (#3765)', () => {
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
        resetCrdtProjectAuthority('fill placement undo integration');
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
            tracks: [createTrack({ id: 't-drums', name: 'Drums', kind: 'midi' })],
            selectedTrackId: 't-drums',
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

    it('places a drum fill at the requested beat, undoes it away and redoes it back', async () => {
        await executeAppAction({ type: 'generateFill', payload: { atBeat: 14, durationBeats: 2 } });
        const placed = placedFillNotes();
        if (!placed) {
            throw new Error('Expected the fill clip to be placed on the drum track');
        }
        expect(placed.clip.name).toBe('Fill (descending)');
        expect(placed.clip.startBeat).toBe(14);
        expect(placed.clip.endBeat).toBe(17);
        expect(placed.starts).toHaveLength(9);
        expect(Math.min(...placed.starts)).toBe(14);
        expect(placed.ends.at(-1)).toBe(17);
        expect(undoHistoryStore.value?.past).toHaveLength(1);

        const undone = await undo();
        expect(undone.headConsumed).toBe(true);
        expect(drumTrackClips()).toHaveLength(0);
        expect(midiStore.value?.notesByClipId[placed.clip.id] ?? []).toHaveLength(0);

        await redo();
        const replays = placedFillNotes();
        if (!replays) {
            throw new Error('Expected redo to re-place the fill clip');
        }
        expect(replays.clip.id).toBe(placed.clip.id);
        expect(replays.starts).toEqual(placed.starts);

        // The cycle stays stable: the guard captured at first write still
        // matches the exactly re-placed material, so undo works again.
        const undoneAgain = await undo();
        expect(undoneAgain.headConsumed).toBe(true);
        expect(drumTrackClips()).toHaveLength(0);
    });

    it('places transition fills at every section boundary and undoes them as one step', async () => {
        markerStore.set({
            markers: [],
            sections: [
                { id: 's1', startBeat: 0, endBeat: 16, name: 'Verse', color: '#111' },
                { id: 's2', startBeat: 16, endBeat: 32, name: 'Chorus', color: '#222' },
            ],
        });

        await executeAppAction({ type: 'generateAllTransitions', payload: undefined });

        const placed = placedFillNotes();
        if (!placed) {
            throw new Error('Expected the transition fills clip to be placed on the drum track');
        }
        expect(placed.clip.name).toBe('Transition fills');
        // The single Verse→Chorus boundary routes to a riser over [14, 18).
        expect(placed.clip.startBeat).toBe(14);
        expect(placed.clip.endBeat).toBe(18);
        expect(placed.starts).toHaveLength(16);
        expect(Math.min(...placed.starts)).toBe(14);
        expect(notifications.some((notification) => notification.message.includes('transition fills'))).toBe(true);

        const undone = await undo();
        expect(undone.headConsumed).toBe(true);
        expect(drumTrackClips()).toHaveLength(0);

        await redo();
        expect(drumTrackClips()).toHaveLength(1);
        expect(placedFillNotes()?.starts).toEqual(placed.starts);
    });

    it('creates a Drums track on an empty project and undo removes the whole track', async () => {
        setTrackStoreState({ ...defaultTrackState, tracks: [] });

        await executeAppAction({ type: 'generateFill', payload: { atBeat: 0 } });

        expect(trackStore.value?.tracks.map((track) => track.name)).toEqual(['Drums']);
        expect(drumTrackClips()).toHaveLength(1);

        const undone = await undo();
        expect(undone.headConsumed).toBe(true);
        expect(trackStore.value?.tracks).toHaveLength(0);
    });

    it('refuses to fake success when no sections exist and leaves no undo entry', async () => {
        await executeAppAction({ type: 'generateAllTransitions', payload: undefined });

        expect(drumTrackClips()).toHaveLength(0);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(notifications.some((notification) => notification.level === 'warning')).toBe(true);
    });
});
