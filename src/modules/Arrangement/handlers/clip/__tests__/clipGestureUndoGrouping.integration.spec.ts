import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
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

    it('reverts only the latest gesture when two delete gestures run back to back', async () => {
        const current = trackStore.value;
        if (!current) {
            throw new Error('Expected the track store to be initialized');
        }
        trackStore.set({
            ...current,
            tracks: [
                TrackDummy.create({
                    id: TRACK_ID,
                    name: 'Keys',
                    kind: 'midi',
                    clips: [
                        createClipFixture('clip-a', 0, 4),
                        createClipFixture('clip-b', 4, 8),
                        createClipFixture('clip-c', 8, 12),
                        createClipFixture('clip-d', 12, 16),
                    ],
                }),
            ],
        });

        const firstGesture = `clip-menu-delete-${crypto.randomUUID()}`;
        await executeUserAppAction(
            { type: 'removeClip', payload: { clipId: 'clip-a' } },
            { groupId: firstGesture, groupLabel: 'Delete 2 clips' }
        );
        await executeUserAppAction(
            { type: 'removeClip', payload: { clipId: 'clip-b' } },
            { groupId: firstGesture, groupLabel: 'Delete 2 clips' }
        );
        const secondGesture = `clip-menu-delete-${crypto.randomUUID()}`;
        await executeUserAppAction(
            { type: 'removeClip', payload: { clipId: 'clip-c' } },
            { groupId: secondGesture, groupLabel: 'Delete 2 clips' }
        );
        await executeUserAppAction(
            { type: 'removeClip', payload: { clipId: 'clip-d' } },
            { groupId: secondGesture, groupLabel: 'Delete 2 clips' }
        );

        expect(trackClips()).toEqual([]);
        expect(undoStore.value?.past).toHaveLength(4);

        await undo();

        // Each gesture mints its own group, so one undo reverts exactly the
        // second gesture: its two clips return, the first gesture's stay gone.
        expect(notifications).toEqual([]);
        expect(
            trackClips()
                .map((clip) => clip.id)
                .sort()
        ).toEqual(['clip-c', 'clip-d']);
        expect(undoStore.value?.past).toHaveLength(2);
        expect(undoStore.value?.future).toHaveLength(2);
    });

    describe('batch composition', () => {
        it('refuses a batch that removes the same clip twice', async () => {
            const result = await executeAppActionBatch([
                { type: 'removeClip', payload: { clipId: 'clip-a' } },
                { type: 'removeClip', payload: { clipId: 'clip-a' } },
            ]);

            expect(result).toMatchObject({ status: 'conflicted' });
            expect(
                trackClips()
                    .map((clip) => clip.id)
                    .sort()
            ).toEqual(['clip-a', 'clip-b']);
            expect(undoStore.value?.past).toEqual([]);
        });

        it('refuses a batch that removes a track together with a clip living on it', async () => {
            const result = await executeAppActionBatch([
                { type: 'removeTrack', payload: { trackId: TRACK_ID } },
                { type: 'removeClip', payload: { clipId: 'clip-a' } },
            ]);

            expect(result).toMatchObject({ status: 'conflicted' });
            expect(trackStore.value?.tracks.map((track) => track.id)).toEqual([TRACK_ID]);
            expect(
                trackClips()
                    .map((clip) => clip.id)
                    .sort()
            ).toEqual(['clip-a', 'clip-b']);
            expect(undoStore.value?.past).toEqual([]);
        });

        it('refuses a batch that duplicates a clip and removes its track', async () => {
            const result = await executeAppActionBatch([
                { type: 'duplicateClip', payload: { clipId: 'clip-a' } },
                { type: 'removeTrack', payload: { trackId: TRACK_ID } },
            ]);

            expect(result).toMatchObject({ status: 'conflicted' });
            expect(trackStore.value?.tracks.map((track) => track.id)).toEqual([TRACK_ID]);
            expect(
                trackClips()
                    .map((clip) => clip.id)
                    .sort()
            ).toEqual(['clip-a', 'clip-b']);
            expect(undoStore.value?.past).toEqual([]);
        });

        it('executes a batch of two removeClip actions on distinct clips as one undo group', async () => {
            const result = await executeAppActionBatch(
                [
                    { type: 'removeClip', payload: { clipId: 'clip-a' } },
                    { type: 'removeClip', payload: { clipId: 'clip-b' } },
                ],
                { groupId: `clip-menu-delete-${crypto.randomUUID()}`, groupLabel: 'Delete 2 clips' }
            );

            expect(result).toMatchObject({ status: 'committed' });
            expect(trackClips()).toEqual([]);
            expect(undoStore.value?.past).toHaveLength(2);

            await undo();

            expect(notifications).toEqual([]);
            expect(
                trackClips()
                    .map((clip) => clip.id)
                    .sort()
            ).toEqual(['clip-a', 'clip-b']);
        });

        it('executes a batch of two restoreClip actions on distinct clips', async () => {
            await executeUserAppAction({ type: 'removeClip', payload: { clipId: 'clip-a' } }, { skipUndo: true });
            await executeUserAppAction({ type: 'removeClip', payload: { clipId: 'clip-b' } }, { skipUndo: true });
            expect(trackClips()).toEqual([]);

            const result = await executeAppActionBatch([
                {
                    type: 'restoreClip',
                    payload: {
                        clipId: 'clip-a',
                        trackId: TRACK_ID,
                        clipSnapshot: createClipFixture('clip-a', 0, 4),
                        ripplePlan: null,
                        midiNotesSnapshot: null,
                        midiCcSnapshot: null,
                        midiPitchBendSnapshot: null,
                    },
                },
                {
                    type: 'restoreClip',
                    payload: {
                        clipId: 'clip-b',
                        trackId: TRACK_ID,
                        clipSnapshot: createClipFixture('clip-b', 4, 8),
                        ripplePlan: null,
                        midiNotesSnapshot: null,
                        midiCcSnapshot: null,
                        midiPitchBendSnapshot: null,
                    },
                },
            ]);

            expect(result).toMatchObject({ status: 'committed' });
            expect(
                trackClips()
                    .map((clip) => clip.id)
                    .sort()
            ).toEqual(['clip-a', 'clip-b']);
            expect(undoStore.value?.past).toEqual([]);
        });
    });
});
