import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeUserAppAction,
    redo,
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

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

const TRACK_ID = 'track-keys';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function createClipFixture(id: string, startBeat: number, endBeat: number): Clip {
    return {
        id,
        trackId: TRACK_ID,
        name: `Clip ${id}`,
        startBeat,
        endBeat,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

/**
 * Issue #3622 end to end: a multi-clip delete or duplicate gesture dispatches
 * one registered action per clip, and every dispatch of the gesture shares one
 * fresh `groupId`, so a single `undo()` must revert the whole gesture. The real
 * handlers are registered and the real undo machinery runs — grouping that only
 * held through a mocked undo store would prove nothing.
 */
describe('clip gesture undo grouping (issue #3622)', () => {
    let notifications: NotifyPayload[] = [];
    let unsubscribeFromNotifications: () => void = () => undefined;

    const trackClips = (): Clip[] => trackStore.value?.tracks.find((track) => track.id === TRACK_ID)?.clips ?? [];

    beforeEach(() => {
        Container.clear();
        const notificationEventBus = createEventBus<NotificationEvents>();
        notifications = [];
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationEventBus);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('clip gesture undo grouping integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const track = TrackDummy.create({
            id: TRACK_ID,
            name: 'Keys',
            kind: 'midi',
            clips: [createClipFixture('clip-a', 0, 4), createClipFixture('clip-b', 4, 8)],
        });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        unsubscribeFromNotifications();
        unsubscribeFromNotifications = () => undefined;
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('restores both clips of a grouped two-clip delete gesture with one undo, and redoes it as one step', async () => {
        const groupId = `clip-menu-delete-${crypto.randomUUID()}`;
        await executeUserAppAction(
            { type: 'removeClip', payload: { clipId: 'clip-a' } },
            { groupId, groupLabel: 'Delete 2 clips' }
        );
        await executeUserAppAction(
            { type: 'removeClip', payload: { clipId: 'clip-b' } },
            { groupId, groupLabel: 'Delete 2 clips' }
        );

        expect(trackClips()).toEqual([]);
        expect(undoStore.value?.past).toHaveLength(2);

        await undo();

        expect(notifications).toEqual([]);
        expect(
            trackClips()
                .map((clip) => clip.id)
                .sort()
        ).toEqual(['clip-a', 'clip-b']);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(2);

        await redo();

        expect(notifications).toEqual([]);
        expect(trackClips()).toEqual([]);
        expect(undoStore.value?.future).toEqual([]);
        expect(undoStore.value?.past).toHaveLength(2);
    });

    it('discards both copies of a grouped two-clip duplicate gesture with one undo', async () => {
        const groupId = `clip-menu-duplicate-${crypto.randomUUID()}`;
        await executeUserAppAction(
            { type: 'duplicateClip', payload: { clipId: 'clip-a' } },
            { groupId, groupLabel: 'Duplicate 2 clips' }
        );
        await executeUserAppAction(
            { type: 'duplicateClip', payload: { clipId: 'clip-b' } },
            { groupId, groupLabel: 'Duplicate 2 clips' }
        );

        const duplicatedIds = trackClips().map((clip) => clip.id);
        expect(duplicatedIds).toHaveLength(4);
        expect(duplicatedIds).toEqual(expect.arrayContaining(['clip-a', 'clip-b']));
        expect(undoStore.value?.past).toHaveLength(2);

        await undo();

        expect(notifications).toEqual([]);
        expect(
            trackClips()
                .map((clip) => clip.id)
                .sort()
        ).toEqual(['clip-a', 'clip-b']);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(2);
    });
});
