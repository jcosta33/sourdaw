import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, macroStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    registerProductionCommandHandlers,
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
import { createTake, createTakeLane } from '../../../models/TakeLane';

const UNDO_SESSION_KEY = 'sourdaw-undo-session';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

/** The production boot sequence: register every handler map, then hydrate the undo
 *  stacks from the session mirror. Re-running it is exactly what a reload does. */
function registerAndHydrateProductionHandlers(): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
}

function clipIds(): string[] {
    return (trackStore.value?.tracks[0]?.clips ?? []).map((clip) => clip.id);
}

function takeIdsInLiveLanes(): string[] {
    return (takeLaneStore.value?.lanes ?? []).flatMap((lane) => lane.takes.map((take) => take.id));
}

async function removeClipThroughHandler(clipId: string): Promise<void> {
    await executeAppAction({ type: 'removeClip', payload: { clipId } }, { source: 'prompt' });
    flushAutomergeStorageWrites();
}

/** A take naming the restored clip, projected into the lane with no local undo
 *  entry — the same shape a collaborator's or an unrecorded write has. */
function projectTakeOntoLiveLane(clipId: string): string {
    const lane = takeLaneStore.value?.lanes[0];
    if (!lane) {
        throw new Error('expected the restored take lane');
    }
    const take = createTake(clipId, 'Projected take', 0, 4);
    takeLaneStore.set({ lanes: [{ ...lane, takes: [...lane.takes, take] }] });
    flushAutomergeStorageWrites();
    return take.id;
}

describe('removeClip redo take restore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('remove clip redo take restore integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        registerAndHydrateProductionHandlers();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const clip = ClipDummy.create({ id: 'clip-source', startBeat: 0, endBeat: 4 });
        const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        takeLaneStore.set({
            lanes: [{ ...createTakeLane('track-1'), takes: [createTake('clip-source', 'First', 0, 4)] }],
        });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('puts back a take projected after the removal when the redo is undone', async () => {
        const firstTakeId = takeIdsInLiveLanes()[0]!;
        await removeClipThroughHandler('clip-source');
        expect(takeIdsInLiveLanes()).toEqual([]);

        await undo();
        expect(clipIds()).toEqual(['clip-source']);
        expect(takeIdsInLiveLanes()).toEqual([firstTakeId]);

        // The take lands after the capture the first removal recorded, so only a
        // capture refreshed on the redo leg can name it.
        const projectedTakeId = projectTakeOntoLiveLane('clip-source');

        await redo();
        expect(clipIds()).toEqual([]);
        expect(takeIdsInLiveLanes()).toEqual([]);

        await undo();

        expect(clipIds()).toEqual(['clip-source']);
        expect(takeIdsInLiveLanes()).toEqual([firstTakeId, projectedTakeId]);
    });
});
