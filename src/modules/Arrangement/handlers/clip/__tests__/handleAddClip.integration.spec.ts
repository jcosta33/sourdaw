import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
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
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

describe('handleAddClip atomic integration', () => {
    beforeEach(() => {
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('add clip atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const track = TrackDummy.create({ id: 'track-keys', name: 'Keys', kind: 'midi', clips: [] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
    });

    afterEach(() => {
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
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
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: {
                ...midiStore.value!.notesByClipId,
                [created.id]: [{ id: 'external-note', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            },
        });

        await undo();

        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: created.id, name: 'Editable' }]);
        expect(midiStore.value!.notesByClipId[created.id]).toMatchObject([{ id: 'external-note' }]);

        midiStore.set({
            ...midiStore.value!,
            notesByClipId: {},
        });
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
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: {
                ...midiStore.value!.notesByClipId,
                [created.id]: [],
            },
        });

        await undo();

        expect(trackStore.value!.tracks[0]!.clips).toMatchObject([{ id: created.id, name: 'Initialized' }]);
        expect(midiStore.value!.notesByClipId).toHaveProperty(created.id, []);

        midiStore.set({
            ...midiStore.value!,
            notesByClipId: {},
        });
        await undo();

        expect(trackStore.value!.tracks[0]!.clips).toEqual([]);
    });
});
