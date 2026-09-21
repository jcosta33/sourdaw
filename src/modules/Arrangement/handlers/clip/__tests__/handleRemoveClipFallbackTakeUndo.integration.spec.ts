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

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane, type Take, type TakeLane } from '../../../models/TakeLane';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

// Force `handleRemoveClip.execute` onto the direct `removeClip` fallback, the
// route that runs when no ripple plan exists, while every other collaborator
// stays real.
vi.mock('../../../useCases/rippleDelete/planRippleDelete', () => ({
    planRippleDelete: vi.fn(() => null),
}));

vi.mock('../../../useCases/rippleDelete/rippleDeleteClips', () => ({
    rippleDeleteClips: vi.fn(() => null),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

function laneForClip(clipId: string): { lane: TakeLane; take: Take } {
    const take = createTake(clipId, 'Recorded take', 0, 4);
    const lane: TakeLane = {
        ...createTakeLane('track-1'),
        takes: [take],
        activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: take.id }],
    };
    return { lane, take };
}

describe('removeClip take retirement (direct removeClip fallback route)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('remove clip fallback take undo integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const clip = ClipDummy.create({ id: 'clip-1', startBeat: 0, endBeat: 4 });
        const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
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

    it('retires the removed clip take on the direct removeClip route', async () => {
        const { lane } = laneForClip('clip-1');
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-1' } }, { source: 'prompt' });

        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0);
        expect(takeLaneStore.value?.lanes).toEqual([]);
    });

    it('restores the clip and its retired take when the direct removeClip is undone', async () => {
        const { lane, take } = laneForClip('clip-1');
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-1' } }, { source: 'prompt' });
        await undo();

        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['clip-1']);
        const restoredLane = takeLaneStore.value?.lanes[0];
        expect(restoredLane?.id).toBe(lane.id);
        expect(restoredLane?.takes.map((candidate) => candidate.id)).toEqual([take.id]);
        expect(restoredLane?.activeCompRegions).toEqual([{ startBeat: 0, endBeat: 4, takeId: take.id }]);
    });

    it('re-retires the take when the direct removeClip is redone', async () => {
        const { lane } = laneForClip('clip-1');
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-1' } }, { source: 'prompt' });
        await undo();
        await redo();

        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0);
        expect(takeLaneStore.value?.lanes).toEqual([]);
    });
});
