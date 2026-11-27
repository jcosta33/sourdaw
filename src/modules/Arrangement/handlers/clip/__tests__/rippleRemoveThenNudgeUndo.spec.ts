import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
    getMacroHandlers,
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
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trimClipEnd } from '../../../useCases/clipEditing/trimClipEnd';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

let notifications: NotifyPayload[] = [];
let unsubscribeFromNotifications: () => void = () => undefined;

function placement(id: string): [number, number] | null {
    const clip = trackStore.value?.tracks[0]?.clips.find((candidate) => candidate.id === id);
    return clip ? [clip.startBeat, clip.endBeat] : null;
}

function seedTrack(): void {
    const a = ClipDummy.create({ id: 'clip-a', trackId: 'track-1', startBeat: 0, endBeat: 4 });
    const b = ClipDummy.create({ id: 'clip-b', trackId: 'track-1', startBeat: 4, endBeat: 8 });
    const track = TrackDummy.create({ id: 'track-1', clips: [a, b] });
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    flushAutomergeStorageWrites();
}

const batch: AppAction[] = [
    { type: 'removeClip', payload: { clipId: 'clip-a', ripple: true } },
    { type: 'nudgeClip', payload: { clipId: 'clip-b', beats: 1 } },
];

describe('ripple removeClip then nudgeClip in one batch', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('ripple remove then nudge undo');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        const notificationEventBus = createEventBus<NotificationEvents>();
        notifications = [];
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationEventBus);
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        transportStore.set({ ...defaultTransportState, isPlaying: false, isRecording: false });
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        registerHandlerMap(getMacroHandlers());
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        unsubscribeFromNotifications();
        Container.clear();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        transportStore.set(defaultTransportState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('undoes the nudge and the removal and restores both clips with no warning', async () => {
        seedTrack();

        const result = await executeAppActionBatch(batch, { source: 'prompt' });

        expect(result.status).toBe('committed');
        expect(placement('clip-a')).toBeNull();
        expect(placement('clip-b')).toEqual([1, 5]);

        const notificationsBefore = notifications.length;
        await undo();
        expect(placement('clip-b')).toEqual([0, 4]);
        await undo();

        expect(placement('clip-a')).toEqual([0, 4]);
        expect(placement('clip-b')).toEqual([4, 8]);
        expect(notifications.slice(notificationsBefore)).toEqual([]);
    });

    it('refuses the undo and keeps a peer edit of the rippled clip', async () => {
        seedTrack();
        await executeAppActionBatch(batch, { source: 'prompt' });
        trimClipEnd('clip-b', 9);
        const notificationsBefore = notifications.length;

        await undo();

        expect(placement('clip-a')).toBeNull();
        expect(placement('clip-b')).toEqual([1, 9]);
        expect(undoStore.value?.past).toHaveLength(2);
        expect(notifications.slice(notificationsBefore)).toEqual([
            expect.objectContaining({ level: 'warning', message: expect.stringContaining('Cannot undo') }),
        ]);
    });
});
