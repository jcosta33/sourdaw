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

describe('handleSetClipStretchMode atomic integration', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('clip stretch mode atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const clip = ClipDummy.create({ id: 'clip-1', startBeat: 2, endBeat: 10, stretchRatio: 1.5 });
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

    it('commits atomically, repeats as a no-op, and undo restores absent mode exactly', async () => {
        const action = {
            type: 'setClipStretchMode' as const,
            payload: { clipId: 'clip-1', mode: 'timestretch' as const },
        };
        const result = await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true });

        expect(result.status).toBe('committed');
        expect(trackStore.value?.tracks[0]?.clips[0]).toMatchObject({
            startBeat: 2,
            endBeat: 10,
            stretchMode: 'timestretch',
            stretchRatio: 1.5,
        });
        expect(await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true })).toMatchObject({
            status: 'no-op',
        });

        await undo();

        const restored = trackStore.value?.tracks[0]?.clips[0];
        expect(restored).toMatchObject({ startBeat: 2, endBeat: 10, stretchRatio: 1.5 });
        expect(restored && Object.hasOwn(restored, 'stretchMode')).toBe(false);
    });
});
