import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { transportStore } from '#/modules/Transport/stores';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { startRecording } from '../../../useCases/recording/startRecording';
import { updateTrack } from '../../../useCases/updateTrack';

const TRACK_ID = 'track-midi';

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

let notifications: NotifyPayload[] = [];
let unsubscribeFromNotifications: () => void = () => undefined;

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function readTrack() {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID);
    if (!track) {
        throw new Error('expected the MIDI track');
    }
    return track;
}

function freezeTrackInStore(): void {
    updateTrack(TRACK_ID, (track) => ({
        ...track,
        frozen: true,
        frozenBufferId: 'frozen-buffer',
        freezeState: { status: 'frozen', frozenBufferId: 'frozen-buffer' },
    }));
    flushAutomergeStorageWrites();
}

describe('recording onto a frozen track (issue #7239)', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('frozen track recording integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
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
        trackStore.set({
            tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'midi', armed: false, clips: [] })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        transportStore.set({ ...transportStore.value!, playheadPosition: 4 });
    });

    afterEach(() => {
        unsubscribeFromNotifications();
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('refuses to arm a frozen track and arms it again once it is unfrozen', async () => {
        freezeTrackInStore();

        await executeAppAction({ type: 'armTrack', payload: { trackId: TRACK_ID, armed: true } });

        expect(readTrack().armed).toBe(false);
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(0);
        expect(notifications.map((notification) => notification.message)).toEqual([
            'Unfreeze the track to record on it.',
        ]);

        updateTrack(TRACK_ID, (track) => ({
            ...track,
            frozen: false,
            frozenBufferId: undefined,
            freezeState: { status: 'unfrozen' },
        }));
        flushAutomergeStorageWrites();
        await executeAppAction({ type: 'armTrack', payload: { trackId: TRACK_ID, armed: true } });

        expect(readTrack().armed).toBe(true);
    });

    it('opens no recording clip on an armed track that is frozen', () => {
        updateTrack(TRACK_ID, (track) => ({ ...track, armed: true }));
        freezeTrackInStore();

        const clips = startRecording(4);

        expect(clips).toEqual([]);
        expect(readTrack().clips).toEqual([]);
    });

    it('refuses to commit a take onto a track frozen after the recording opened', async () => {
        updateTrack(TRACK_ID, (track) => ({ ...track, armed: true }));
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        freezeTrackInStore();
        const before = JSON.stringify(readTrack().clips);

        await executeAppAction({
            type: 'commitRecording',
            payload: { clip: { ...provisional, endBeat: 8, name: 'Recorded take' } },
        });
        flushAutomergeStorageWrites();

        expect(JSON.stringify(readTrack().clips)).toBe(before);
        expect(undoHistoryStore.value?.past ?? []).toHaveLength(0);
    });
});
