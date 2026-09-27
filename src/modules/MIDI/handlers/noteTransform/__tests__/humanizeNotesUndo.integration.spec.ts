import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, markerStore, trackStore } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore } from '#/modules/Command/stores';
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

// Audit #4591 — the palette's Humanize Notes records an undo entry with no
// inverse. Real production handlers, stores, dispatch and undo machinery.

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

describe('humanizeNotes undo', () => {
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
        resetCrdtProjectAuthority('humanize undo integration');
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

    it('restores the humanized notes instead of undoing the edit made before it', async () => {
        const clip = addClip({
            id: 'clip-groove',
            trackId: 't-drums',
            startBeat: 0,
            endBeat: 4,
            name: 'Groove',
            type: 'midi',
        });
        if (clip === null) {
            throw new Error('Expected MIDI clip fixture');
        }
        const original = [0, 1, 2, 3].map((startBeat, index) => ({
            id: `note-${String(index)}`,
            pitch: 36,
            startBeat,
            duration: 0.5,
            velocity: 100,
            channel: 0,
        }));
        midiStore.set({ ...midiStore.value!, notesByClipId: { 'clip-groove': original } });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'setTrackColor', payload: { trackId: 't-drums', color: '#222222' } });
        await executeAppAction({ type: 'humanizeNotes', payload: { clipId: 'clip-groove', amount: 0.3 } });
        const humanized = midiStore.value?.notesByClipId['clip-groove']?.map((note) => note.startBeat);
        expect(humanized).not.toEqual([0, 1, 2, 3]);

        await undo();

        expect.soft(midiStore.value?.notesByClipId['clip-groove']?.map((note) => note.startBeat)).toEqual([0, 1, 2, 3]);
        expect.soft(trackStore.value?.tracks.find((track) => track.id === 't-drums')?.color).toBe('#222222');
    });
});
