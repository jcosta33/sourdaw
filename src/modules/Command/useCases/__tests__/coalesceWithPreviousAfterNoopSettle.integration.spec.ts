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
import { midiStore } from '#/modules/MIDI/stores';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

// Audit #4591 — the channel strip's double-click reset commits with
// `coalesceWithPrevious` after a same-value settle that recorded nothing, so
// the reset joins whatever same-type entry is on top of the stack. This drives
// the exact call sequence `useChannelStripActions` produces through real
// production handlers, stores, dispatch and undo machinery.

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

describe('coalesceWithPrevious after a no-op settle', () => {
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
        resetCrdtProjectAuthority('coalesce integration');
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
            tracks: [
                createTrack({ id: 't-a', name: 'Vox', kind: 'audio' }),
                createTrack({ id: 't-b', name: 'Bass', kind: 'audio' }),
            ],
            selectedTrackId: 't-b',
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

    it("a double-click reset on track B does not also undo track A's older fader move", async () => {
        const gainOf = (trackId: string): number | undefined =>
            trackStore.value?.tracks.find((track) => track.id === trackId)?.gain;
        const gainA = gainOf('t-a')!;
        const gainB = gainOf('t-b')!;

        // Earlier edit: track A's fader moved.
        await executeAppAction({ type: 'setTrackGain', payload: { trackId: 't-a', gain: 0.3, expectedGain: gainA } });
        // Track B, first click of the double-click: a pointer jitter emits a
        // transient at the unchanged value, so the settle commits B's own gain.
        await executeAppAction({ type: 'setTrackGain', payload: { trackId: 't-b', gain: gainB, expectedGain: gainB } });
        // Track B, the double-click reset, inside the strip's 500 ms window.
        await executeAppAction(
            { type: 'setTrackGain', payload: { trackId: 't-b', gain: 1, expectedGain: gainB } },
            { coalesceWithPrevious: true }
        );

        await undo();

        expect.soft(gainOf('t-b')).toBe(gainB);
        expect.soft(gainOf('t-a')).toBe(0.3);
    });
});
