import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
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

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane, type TakeLane } from '../../../models/TakeLane';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

describe('drawClip take restore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('draw clip take restore integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const track = TrackDummy.create({ id: 'track-1', clips: [] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('restores a take that landed on the drawn clip when the draw is redone', async () => {
        await executeAppAction(
            {
                type: 'drawClip',
                payload: {
                    id: 'clip-drawn',
                    trackId: 'track-1',
                    startBeat: 0,
                    endBeat: 4,
                    name: 'Drawn',
                    type: 'audio',
                    ripple: false,
                },
            },
            { source: 'prompt' }
        );
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['clip-drawn']);

        // A take naming the drawn clip lands with no local undo entry.
        const take = createTake('clip-drawn', 'Projected take', 0, 4);
        const lane: TakeLane = { ...createTakeLane('track-1'), takes: [take] };
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await undo();
        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0);
        expect(takeLaneStore.value?.lanes).toEqual([]);

        await redo();

        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['clip-drawn']);
        expect(takeLaneStore.value?.lanes[0]?.takes.map((candidate) => candidate.id)).toEqual([take.id]);
    });
});
