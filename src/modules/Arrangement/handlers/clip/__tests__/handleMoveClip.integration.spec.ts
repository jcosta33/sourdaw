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

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

describe('handleMoveClip atomic integration', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('move clip atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const clip = ClipDummy.create({ id: 'clip-1', name: 'Verse Lead', trackId: 'track-1', startBeat: 2, endBeat: 10 });
        const source = TrackDummy.create({ id: 'track-1', name: 'Vocals', clips: [clip] });
        const destination = TrackDummy.create({ id: 'track-2', name: 'Comp Bus', kind: 'bus', clips: [] });
        trackStore.set({ tracks: [source, destination], selectedTrackId: source.id, ghostClips: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('commits atomically and round-trips exact track membership and geometry through undo and redo', async () => {
        const action = {
            type: 'moveClip' as const,
            payload: { clipId: 'clip-1', trackId: 'track-2', startBeat: 16 },
        };

        expect(await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true })).toMatchObject({
            status: 'committed',
        });
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-1')?.clips).toEqual([]);
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-2')?.clips[0]).toMatchObject({
            id: 'clip-1',
            trackId: 'track-2',
            startBeat: 16,
            endBeat: 24,
        });

        await undo();
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-2')?.clips).toEqual([]);
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-1')?.clips[0]).toMatchObject({
            id: 'clip-1',
            trackId: 'track-1',
            startBeat: 2,
            endBeat: 10,
        });

        await redo();
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-1')?.clips).toEqual([]);
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-2')?.clips[0]).toMatchObject({
            id: 'clip-1',
            trackId: 'track-2',
            startBeat: 16,
            endBeat: 24,
        });
    });
});
