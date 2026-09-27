import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
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
import { defaultWorkspaceState, workspaceStore } from '#/modules/WorkspaceShell/stores';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function clipById(trackId: string, clipId: string) {
    return trackStore.value?.tracks.find((track) => track.id === trackId)?.clips.find((clip) => clip.id === clipId);
}

function clipsOn(trackId: string) {
    return trackStore.value?.tracks.find((track) => track.id === trackId)?.clips ?? [];
}

describe('handleMoveClips ripple over a legacy misplaced clip', () => {
    let notifications: NotifyPayload[] = [];
    let unsubscribeFromNotifications: () => void = () => undefined;

    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('move clips ripple legacy clip');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
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
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: true });
        automationStore.set({ lanes: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        // A project saved before the placement rule: an audio clip parked on a
        // MIDI track, with a MIDI follower the ripple must keep consistent with.
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    name: 'Host',
                    kind: 'midi',
                    clips: [
                        ClipDummy.create({
                            id: 'clip-1',
                            type: 'audio',
                            trackId: 'track-1',
                            startBeat: 2,
                            endBeat: 10,
                        }),
                        ClipDummy.create({
                            id: 'clip-2',
                            type: 'midi',
                            trackId: 'track-1',
                            startBeat: 12,
                            endBeat: 16,
                        }),
                    ],
                }),
                TrackDummy.create({ id: 'track-2', name: 'Other', kind: 'midi', clips: [] }),
            ],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        unsubscribeFromNotifications();
        Container.clear();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        workspaceStore.set(defaultWorkspaceState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('lands a same-host ripple move with its neighbors shifted consistently', async () => {
        // Retiming on its own host changes no placement, so the move must go
        // through — and the follower's shift must describe a move that actually
        // happened, or the timeline and its inverse diverge.
        const action = {
            type: 'moveClips' as const,
            payload: {
                moves: [{ clipId: 'clip-1', trackId: 'track-1', startBeat: 20 }],
                ripple: true,
            },
        };
        expect(await executeAppActionBatch([action], { source: 'prompt' })).toMatchObject({
            status: 'committed',
        });

        expect(clipById('track-1', 'clip-1')).toMatchObject({ trackId: 'track-1', startBeat: 20, endBeat: 28 });
        expect(clipById('track-1', 'clip-2')).toMatchObject({ startBeat: 4, endBeat: 8 });
        expect(clipsOn('track-2')).toEqual([]);

        await undo();

        expect(clipById('track-1', 'clip-1')).toMatchObject({ trackId: 'track-1', startBeat: 2, endBeat: 10 });
        expect(clipById('track-1', 'clip-2')).toMatchObject({ startBeat: 12, endBeat: 16 });
    });

    it('claims a no-op leg origin in the inverse of a multi-clip ripple gesture', async () => {
        // Dragging clip-1 by its own duration (2 -> 10) ripples clip-2 forward
        // by that same duration (12 -> 20) — exactly clip-2's own target in this
        // gesture (12 + 8). That leg is a no-op, not a refusal: it must still be
        // recorded as landed, or the committed entry loses its second mover.
        const action = {
            type: 'moveClips' as const,
            payload: {
                moves: [
                    { clipId: 'clip-1', trackId: 'track-1', startBeat: 10 },
                    { clipId: 'clip-2', trackId: 'track-1', startBeat: 20 },
                ],
                ripple: true,
            },
        };
        expect(await executeAppActionBatch([action], { source: 'prompt' })).toMatchObject({
            status: 'committed',
        });

        expect(clipById('track-1', 'clip-1')).toMatchObject({ trackId: 'track-1', startBeat: 10, endBeat: 18 });
        // clip-2 sits exactly where clip-1's ripple shift left it — its own leg
        // moved it nowhere further.
        expect(clipById('track-1', 'clip-2')).toMatchObject({ startBeat: 20, endBeat: 24 });
        expect(clipsOn('track-2')).toEqual([]);

        expect(undoHistoryStore.value?.past.at(-1)).toMatchObject({
            kind: 'action',
            inverseAction: {
                type: 'restoreClipMoves',
                payload: {
                    movedClips: [
                        { clipId: 'clip-1', trackId: 'track-1', startBeat: 2 },
                        { clipId: 'clip-2', trackId: 'track-1', startBeat: 12 },
                    ],
                    neighborShifts: [{ clipId: 'clip-2', origStartBeat: 12, origEndBeat: 16 }],
                },
            },
        });

        await undo();

        expect(clipById('track-1', 'clip-1')).toMatchObject({ trackId: 'track-1', startBeat: 2, endBeat: 10 });
        expect(clipById('track-1', 'clip-2')).toMatchObject({ startBeat: 12, endBeat: 16 });
    });

    it('stops a whole same-host ripple plan when the move is refused, neighbors included', async () => {
        // A locked clip cannot move, so its ripple plan must not run: shifting
        // the follower around a refused move would strand the clip at its
        // source, open a hole where it should have landed, and record an
        // inverse describing shifts over a move that never happened.
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    name: 'Host',
                    kind: 'midi',
                    clips: [
                        ClipDummy.create({
                            id: 'clip-1',
                            type: 'audio',
                            trackId: 'track-1',
                            startBeat: 2,
                            endBeat: 10,
                            locked: true,
                        }),
                        ClipDummy.create({
                            id: 'clip-2',
                            type: 'midi',
                            trackId: 'track-1',
                            startBeat: 12,
                            endBeat: 16,
                        }),
                    ],
                }),
                TrackDummy.create({ id: 'track-2', name: 'Other', kind: 'midi', clips: [] }),
            ],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });

        const action = {
            type: 'moveClips' as const,
            payload: {
                moves: [{ clipId: 'clip-1', trackId: 'track-1', startBeat: 20 }],
                ripple: true,
            },
        };
        // A batch whose handler writes nothing surfaces as conflicted.
        expect(await executeAppActionBatch([action], { source: 'prompt' })).toMatchObject({
            status: 'conflicted',
        });

        expect(clipById('track-1', 'clip-1')).toMatchObject({ startBeat: 2, endBeat: 10 });
        expect(clipById('track-1', 'clip-2')).toMatchObject({ startBeat: 12, endBeat: 16 });
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(notifications).toEqual([]);
    });

    it('refuses a whole cross-host ripple move onto an incompatible host, neighbors included', async () => {
        // The audio clip moving to the second MIDI track is refused by the
        // placement rule: the whole gesture commits nothing and every clip
        // stays where it was.
        const action = {
            type: 'moveClips' as const,
            payload: {
                moves: [{ clipId: 'clip-1', trackId: 'track-2', startBeat: 20 }],
                ripple: true,
            },
        };
        // A batch whose handler writes nothing surfaces as conflicted.
        expect(await executeAppActionBatch([action], { source: 'prompt' })).toMatchObject({
            status: 'conflicted',
        });

        expect(clipById('track-1', 'clip-1')).toMatchObject({ trackId: 'track-1', startBeat: 2, endBeat: 10 });
        expect(clipById('track-1', 'clip-2')).toMatchObject({ startBeat: 12, endBeat: 16 });
        expect(clipsOn('track-2')).toEqual([]);
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(notifications).toEqual([]);
    });
});
