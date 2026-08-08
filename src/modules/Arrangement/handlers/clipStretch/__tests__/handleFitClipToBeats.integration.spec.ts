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

describe('handleFitClipToBeats atomic integration', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('fit clip to beats atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const clip = ClipDummy.create({
            id: 'clip-1',
            name: 'Verse Lead',
            startBeat: 2,
            endBeat: 10,
            stretchRatio: 1.5,
            stretchMode: 'off',
        });
        const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('commits atomically and round-trips the exact stretch state through undo and redo', async () => {
        const action = {
            type: 'fitClipToBeats' as const,
            payload: { clipId: 'clip-1', targetBeats: 4 },
        };

        expect(await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true })).toMatchObject({
            status: 'committed',
        });
        expect(trackStore.value?.tracks[0]?.clips[0]).toMatchObject({
            startBeat: 2,
            endBeat: 6,
            stretchMode: 'repitch',
            stretchRatio: 3,
        });

        await undo();
        expect(trackStore.value?.tracks[0]?.clips[0]).toMatchObject({
            startBeat: 2,
            endBeat: 10,
            stretchMode: 'off',
            stretchRatio: 1.5,
        });

        await redo();
        expect(trackStore.value?.tracks[0]?.clips[0]).toMatchObject({
            startBeat: 2,
            endBeat: 6,
            stretchMode: 'repitch',
            stretchRatio: 3,
        });
    });
});
