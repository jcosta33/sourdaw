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

async function drawClip(): Promise<void> {
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
}

function projectTakeOntoDrawnClip(): { takeId: string } {
    const take = createTake('clip-drawn', 'Projected take', 0, 4);
    const lane: TakeLane = { ...createTakeLane('track-1'), takes: [take] };
    takeLaneStore.set({ lanes: [lane] });
    flushAutomergeStorageWrites();
    return { takeId: take.id };
}

describe('drawClip take restore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('draw clip take restore integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        registerAndHydrateProductionHandlers();
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
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('restores a take that landed on the drawn clip when the draw is redone', async () => {
        await drawClip();
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['clip-drawn']);

        const { takeId } = projectTakeOntoDrawnClip();

        await undo();
        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0);
        expect(takeLaneStore.value?.lanes).toEqual([]);

        await redo();

        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['clip-drawn']);
        expect(takeLaneStore.value?.lanes[0]?.takes.map((candidate) => candidate.id)).toEqual([takeId]);
    });

    it('restores the take when the draw is redone after a session restore', async () => {
        await drawClip();
        const { takeId } = projectTakeOntoDrawnClip();

        // Flush the session mirror, then hydrate the undo stacks from it the way a
        // reload does — which parses the inverse and the redo into independent
        // objects, so a capture shared by reference between them is gone.
        await vi.waitFor(() => {
            expect(sessionStorage.getItem(UNDO_SESSION_KEY)).not.toBeNull();
        });
        registerAndHydrateProductionHandlers();
        expect(undoHistoryStore.value?.past.at(-1)?.kind).toBe('action');

        await undo();
        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(0);
        expect(takeLaneStore.value?.lanes).toEqual([]);

        await redo();

        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['clip-drawn']);
        expect(takeLaneStore.value?.lanes[0]?.takes.map((candidate) => candidate.id)).toEqual([takeId]);
    });
});
