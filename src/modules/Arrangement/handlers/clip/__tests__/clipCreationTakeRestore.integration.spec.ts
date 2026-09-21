import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, macroStore, undoHistoryStore } from '#/modules/Command/stores';
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
import { createTake, createTakeLane, type TakeLane } from '../../../models/TakeLane';

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

/** A take naming the clip, projected into the lane with no local undo entry —
 *  the same shape a collaborator's or an unrecorded write has. */
function projectTakeOntoClip(clipId: string): string {
    const take = createTake(clipId, `Projected take on ${clipId}`, 0, 4);
    const lane: TakeLane = { ...createTakeLane('track-1'), takes: [take] };
    takeLaneStore.set({ lanes: [lane] });
    flushAutomergeStorageWrites();
    return take.id;
}

async function createClip(action: Parameters<typeof executeAppAction>[0]): Promise<void> {
    await executeAppAction(action, { source: 'prompt' });
    flushAutomergeStorageWrites();
}

/** The mirror flush is a microtask behind the stacks' own write; wait for the
 *  shape the reload has to read rather than for any mirror at all. */
async function waitForMirrorStacks(past: number, future: number): Promise<void> {
    await vi.waitFor(() => {
        const raw = sessionStorage.getItem(UNDO_SESSION_KEY);
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw ?? '{}') as { past?: unknown[]; future?: unknown[] };
        expect(parsed.past).toHaveLength(past);
        expect(parsed.future).toHaveLength(future);
    });
}

describe('clip-creation take restore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('clip creation take restore integration');
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

    it('puts back a take on an added clip when the add is redone', async () => {
        await createClip({
            type: 'addClip',
            payload: {
                id: 'clip-added',
                trackId: 'track-1',
                startBeat: 8,
                endBeat: 12,
                name: 'Added',
                type: 'audio',
            },
        });
        expect(clipIds()).toEqual(['clip-source', 'clip-added']);
        const takeId = projectTakeOntoClip('clip-added');

        await undo();
        expect(clipIds()).toEqual(['clip-source']);
        expect(takeIdsInLiveLanes()).toEqual([]);

        await redo();

        expect(clipIds()).toEqual(['clip-source', 'clip-added']);
        expect(takeIdsInLiveLanes()).toEqual([takeId]);
    });

    it('puts back a take on a duplicated clip when the duplicate is redone', async () => {
        await createClip({ type: 'duplicateClip', payload: { clipId: 'clip-source', targetClipId: 'clip-copy' } });
        expect(clipIds()).toEqual(['clip-source', 'clip-copy']);
        const takeId = projectTakeOntoClip('clip-copy');

        await undo();
        expect(clipIds()).toEqual(['clip-source']);
        expect(takeIdsInLiveLanes()).toEqual([]);

        await redo();

        expect(clipIds()).toEqual(['clip-source', 'clip-copy']);
        expect(takeIdsInLiveLanes()).toEqual([takeId]);
    });

    it('puts back a take on a clip duplicated to a destination when that duplicate is redone', async () => {
        await createClip({
            type: 'duplicateClipAt',
            payload: {
                clipId: 'clip-source',
                destinationTrackId: 'track-1',
                startBeat: 8,
                targetClipId: 'clip-copy-at',
            },
        });
        expect(clipIds()).toEqual(['clip-source', 'clip-copy-at']);
        const takeId = projectTakeOntoClip('clip-copy-at');

        await undo();
        expect(clipIds()).toEqual(['clip-source']);
        expect(takeIdsInLiveLanes()).toEqual([]);

        await redo();

        expect(clipIds()).toEqual(['clip-source', 'clip-copy-at']);
        expect(takeIdsInLiveLanes()).toEqual([takeId]);
    });

    it('puts back a take on a clip duplicated to the next bar when that duplicate is redone', async () => {
        await createClip({
            type: 'duplicateClipToNextBar',
            payload: { clipId: 'clip-source', targetClipId: 'clip-copy-next-bar' },
        });
        expect(clipIds()).toEqual(['clip-source', 'clip-copy-next-bar']);
        const takeId = projectTakeOntoClip('clip-copy-next-bar');

        await undo();
        expect(clipIds()).toEqual(['clip-source']);
        expect(takeIdsInLiveLanes()).toEqual([]);

        await redo();

        expect(clipIds()).toEqual(['clip-source', 'clip-copy-next-bar']);
        expect(takeIdsInLiveLanes()).toEqual([takeId]);
    });

    it('puts the take back after a session restore between the undo and the redo', async () => {
        await createClip({
            type: 'addClip',
            payload: {
                id: 'clip-added',
                trackId: 'track-1',
                startBeat: 8,
                endBeat: 12,
                name: 'Added',
                type: 'audio',
            },
        });
        const takeId = projectTakeOntoClip('clip-added');

        await undo();
        expect(clipIds()).toEqual(['clip-source']);

        // Flush the session mirror, then hydrate the undo stacks from it the way a
        // reload does: the discard's capture has to survive the round trip, because
        // the redo reads it off the entry rather than from a shared object.
        await waitForMirrorStacks(0, 1);
        registerAndHydrateProductionHandlers();
        expect(undoHistoryStore.value?.future.at(0)?.kind).toBe('action');

        await redo();

        expect(clipIds()).toEqual(['clip-source', 'clip-added']);
        expect(takeIdsInLiveLanes()).toEqual([takeId]);
    });
});
