import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, markerStore, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
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
import { cvGateStore, defaultCvGateState, type CvOutputChannel } from '#/modules/CvGate/stores';
import { midiStore } from '#/modules/MIDI/stores';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

// #4615 — Add CV Pitch/Gate Output recorded an inverse-less undo entry, so undo
// skipped it and reverted the previous unrelated edit instead. Real production
// handlers, stores, dispatch and undo machinery.

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

function outputsOnChannel(channel: number): CvOutputChannel[] {
    return cvGateStore.value?.outputs.filter((output) => output.outputChannel === channel) ?? [];
}

function trackColor(): string | undefined {
    return trackStore.value?.tracks.find((track) => track.id === 't-drums')?.color;
}

describe('CV/Gate output undo', () => {
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
        resetCrdtProjectAuthority('cv output undo integration');
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
        cvGateStore.set(structuredClone(defaultCvGateState));
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
        cvGateStore.set(structuredClone(defaultCvGateState));
        markerStore.set({ markers: [], sections: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        unsubscribeFromNotifications();
        unsubscribeFromNotifications = () => undefined;
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('undoes addCvOutput instead of the edit made before it', async () => {
        await executeAppAction({ type: 'setTrackColor', payload: { trackId: 't-drums', color: '#222222' } });
        await executeAppAction({ type: 'addCvOutput', payload: { name: 'Gate 1', channel: 5, type: 'gate' } });
        expect(outputsOnChannel(5)).toHaveLength(1);

        await undo();

        expect.soft(outputsOnChannel(5)).toHaveLength(0);
        expect.soft(trackColor()).toBe('#222222');
    });

    it('records no entry when the channel is already occupied, so undo reverts the earlier edit', async () => {
        const seeded: CvOutputChannel = {
            id: 'cv-seeded',
            name: 'Existing',
            outputChannel: 5,
            type: 'gate',
            minVoltage: 0,
            maxVoltage: 5,
            value: 0,
            active: true,
        };
        cvGateStore.set({ ...structuredClone(defaultCvGateState), outputs: [seeded] });
        const colorBefore = trackColor();
        await executeAppAction({ type: 'setTrackColor', payload: { trackId: 't-drums', color: '#222222' } });
        // The use case refuses a duplicate channel silently — no undo entry may
        // exist above the color edit, or undo would target the seeded output.
        await executeAppAction({ type: 'addCvOutput', payload: { name: 'Gate 1', channel: 5, type: 'gate' } });

        await undo();

        expect.soft(trackColor()).toBe(colorBefore);
        expect.soft(outputsOnChannel(5).map((output) => output.id)).toEqual(['cv-seeded']);
    });
});
