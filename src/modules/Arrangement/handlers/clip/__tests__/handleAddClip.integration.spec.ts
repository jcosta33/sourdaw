import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
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
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

type MidiState = NonNullable<typeof midiStore.value>;
type RootProjectDocument = { tracks?: unknown; midi?: unknown };

let notifications: NotifyPayload[] = [];
let unsubscribeFromNotifications: () => void = () => undefined;

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function replaceMidiNotes(notesByClipId: MidiState['notesByClipId']): void {
    const transaction = runWithAutomergeStorageTransaction(undefined, () => {
        midiStore.set({ ...midiStore.value!, notesByClipId });
    });
    if (transaction.status !== 'returned') {
        throw transaction.error;
    }
    transaction.commit();
}

function authoritativeProjectSlots(): RootProjectDocument {
    const document = getCrdtDoc<RootProjectDocument>('root');
    if (!document) {
        throw new Error('Expected root CRDT document');
    }
    return structuredClone({ tracks: document.tracks, midi: document.midi });
}

describe('handleAddClip atomic integration', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('add clip atomic integration');
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
        const track = TrackDummy.create({ id: 'track-keys', name: 'Keys', kind: 'midi', clips: [] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        unsubscribeFromNotifications();
        Container.clear();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('creates a blank MIDI clip and round-trips the same identity through undo and redo', async () => {
        const result = await executeAppActionBatch(
            [
                {
                    type: 'addClip',
                    payload: {
                        trackId: 'track-keys',
                        startBeat: 8,
                        endBeat: 16,
                        name: 'Verse',
                        type: 'midi',
                    },
                },
            ],
            { source: 'prompt', requireCompensation: true }
        );

        expect(result).toMatchObject({ status: 'committed' });
        const created = trackStore.value!.tracks[0]!.clips[0]!;
        expect(created).toMatchObject({
            trackId: 'track-keys',
            startBeat: 8,
            endBeat: 16,
            name: 'Verse',
            type: 'midi',
        });
        expect(midiStore.value!.notesByClipId).not.toHaveProperty(created.id);

        await undo();
        expect(trackStore.value!.tracks[0]!.clips).toEqual([]);

        await redo();
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: created.id, name: 'Verse', type: 'midi' }]);
    });

    it('keeps the created clip and undo entry when its MIDI state changed externally', async () => {
        await executeAppActionBatch(
            [
                {
                    type: 'addClip',
                    payload: {
                        trackId: 'track-keys',
                        startBeat: 0,
                        endBeat: 4,
                        name: 'Editable',
                        type: 'midi',
                    },
                },
            ],
            { source: 'prompt', requireCompensation: true }
        );
        const created = trackStore.value!.tracks[0]!.clips[0]!;
        replaceMidiNotes({
            ...midiStore.value!.notesByClipId,
            [created.id]: [{ id: 'external-note', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
        });
        const trackProjectionBeforeRejectedUndo = structuredClone(trackStore.value);
        const midiProjectionBeforeRejectedUndo = structuredClone(midiStore.value);
        const historyBeforeRejectedUndo = structuredClone(undoStore.value);
        const authoritativeBeforeRejectedUndo = authoritativeProjectSlots();
        expect(authoritativeBeforeRejectedUndo.midi).toBeDefined();

        expect(notifications).toEqual([]);
        await undo();

        expect(trackStore.value).toEqual(trackProjectionBeforeRejectedUndo);
        expect(midiStore.value).toEqual(midiProjectionBeforeRejectedUndo);
        expect(undoStore.value).toEqual(historyBeforeRejectedUndo);
        const authoritativeAfterRejectedUndo = authoritativeProjectSlots();
        expect(authoritativeAfterRejectedUndo).toEqual(authoritativeBeforeRejectedUndo);
        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: created.id, name: 'Editable' }]);
        expect(midiStore.value!.notesByClipId[created.id]).toMatchObject([{ id: 'external-note' }]);
        expect(notifications).toEqual([
            {
                message: 'Cannot undo "Add clip "Editable"": project state has changed',
                level: 'warning',
            },
        ]);

        replaceMidiNotes({});
        await undo();

        expect(trackStore.value!.tracks[0]!.clips).toEqual([]);
    });

    it('treats an externally initialized empty MIDI bucket as a stale edit', async () => {
        await executeAppActionBatch(
            [
                {
                    type: 'addClip',
                    payload: {
                        trackId: 'track-keys',
                        startBeat: 0,
                        endBeat: 4,
                        name: 'Initialized',
                        type: 'midi',
                    },
                },
            ],
            { source: 'prompt', requireCompensation: true }
        );
        const created = trackStore.value!.tracks[0]!.clips[0]!;
        replaceMidiNotes({
            [created.id]: [],
        });

        await undo();

        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: created.id, name: 'Initialized' }]);
        expect(midiStore.value!.notesByClipId).toHaveProperty(created.id, []);

        replaceMidiNotes({});
        await undo();

        expect(trackStore.value!.tracks[0]!.clips).toEqual([]);
    });
});
