import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
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

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

describe('handleSetClipStretchRatio atomic integration', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('clip stretch ratio atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const clip = ClipDummy.create({ id: 'clip-1', endBeat: 4 });
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

    it('commits through a compensable atomic batch, repeats as no-op, and undo restores absence', async () => {
        const action = { type: 'setClipStretchRatio' as const, payload: { clipId: 'clip-1', ratio: 1.5 } };
        const result = await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true });

        expect(result.status).toBe('committed');
        expect(trackStore.value?.tracks[0]?.clips[0]).toMatchObject({ endBeat: 4, stretchRatio: 1.5 });

        const repeated = await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true });
        expect(repeated.status).toBe('no-op');

        await undo();

        const restored = trackStore.value?.tracks[0]?.clips[0];
        expect(restored?.endBeat).toBe(4);
        expect(restored && Object.hasOwn(restored, 'stretchRatio')).toBe(false);
    });

    it('round-trips repitch start/end geometry and optional stretch fields exactly', async () => {
        const clip = ClipDummy.create({
            id: 'clip-1',
            startBeat: 2,
            endBeat: 10,
            stretchMode: 'repitch',
            stretchRatio: 2,
        });
        const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });

        const action = { type: 'setClipStretchRatio' as const, payload: { clipId: 'clip-1', ratio: 4 } };
        const result = await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true });

        expect(result.status).toBe('committed');
        expect(trackStore.value?.tracks[0]?.clips[0]).toMatchObject({
            startBeat: 2,
            endBeat: 6,
            stretchMode: 'repitch',
            stretchRatio: 4,
        });

        await undo();

        expect(trackStore.value?.tracks[0]?.clips[0]).toMatchObject({
            startBeat: 2,
            endBeat: 10,
            stretchMode: 'repitch',
            stretchRatio: 2,
        });
    });
});
