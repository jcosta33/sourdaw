import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('handleSetClipGain atomic integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('set clip gain atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const clip = ClipDummy.create({ id: 'clip-1', gain: 0.5 });
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

    it('commits through a compensable atomic batch and undo restores the previous gain', async () => {
        const result = await executeAppActionBatch(
            [{ type: 'setClipGain', payload: { clipId: 'clip-1', gain: 1.25 } }],
            {
                source: 'prompt',
                requireCompensation: true,
            }
        );

        expect(result.status).toBe('committed');
        expect(trackStore.value?.tracks[0]?.clips[0]?.gain).toBe(1.25);

        await undo();

        expect(trackStore.value?.tracks[0]?.clips[0]?.gain).toBe(0.5);
    });

    it('commits an out-of-range gain atomically, guarding the inverse against the clamped write', async () => {
        const result = await executeAppActionBatch([{ type: 'setClipGain', payload: { clipId: 'clip-1', gain: 7 } }], {
            source: 'prompt',
            requireCompensation: true,
        });

        expect(result.status).toBe('committed');
        expect(trackStore.value?.tracks[0]?.clips[0]?.gain).toBe(2);

        await undo();

        expect(trackStore.value?.tracks[0]?.clips[0]?.gain).toBe(0.5);
    });
});
