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
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultWorkspaceState, workspaceStore } from '#/modules/WorkspaceShell/stores';
import { projectAudioLoopPassSegments } from '#/utils/audioSourceTime';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip } from '../../../models/Track';
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

function canonicalSourceClip(): Clip {
    return ClipDummy.create({
        id: 'canonical',
        trackId: 'track-1',
        startBeat: 5,
        endBeat: 9,
        loopEnabled: true,
        loopLength: 4,
        loopOriginBeat: 3,
        audioOffsetBeats: 2,
        audioOffsetSeconds: 0.5,
        audioUnwrappedOffsetSeconds: 0,
        audioLoopStartSeconds: 0,
        audioLoopPassEntrySeconds: 0.25,
        audioLoopPassOriginBeat: 4,
    });
}

function clipById(clipId: string): Clip {
    const clip = trackStore.value?.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
    if (!clip) {
        throw new Error(`expected clip ${clipId}`);
    }
    return clip;
}

function sourceFrameSegments(clip: Clip): number[][] {
    return projectAudioLoopPassSegments({
        clip,
        loopLengthBeats: 4,
        iterationStartBeat: clip.startBeat,
        iterationEndBeat: clip.endBeat,
        stretchRatio: 1,
        tempoAtClipStart: 120,
        secondsAtBeat: (beat) => beat / 2,
    }).map((segment) => [
        segment.startOffsetBeats,
        segment.endOffsetBeats,
        Math.round(segment.sourceStartSeconds * 48_000),
    ]);
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
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
        const track = TrackDummy.create({ id: 'track-1', clips: [] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
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

    it('keeps source pass phase through a ripple draw, its inverse, and captured redo', async () => {
        const canonical = canonicalSourceClip();
        const legacy = ClipDummy.create({ id: 'legacy', trackId: 'track-1', startBeat: 10, endBeat: 14 });
        const unaffected = ClipDummy.create({ id: 'unaffected', trackId: 'track-1', startBeat: 0, endBeat: 1 });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-1', clips: [unaffected, canonical, legacy] })],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: true });
        flushAutomergeStorageWrites();
        const expectedFrames = [
            [0, 2, 24_000],
            [2, 3, 0],
            [3, 4, 12_000],
        ];
        expect(sourceFrameSegments(clipById('canonical'))).toEqual(expectedFrames);
        const assertAuthority = () => {
            flushAutomergeStorageWrites();
            expect(getCrdtDoc<{ tracks: NonNullable<typeof trackStore.value> }>('root')?.tracks.tracks).toEqual(
                trackStore.value?.tracks
            );
        };
        const assertShifted = () => {
            expect(clipById('canonical')).toMatchObject({
                startBeat: 7,
                endBeat: 11,
                loopOriginBeat: 5,
                audioLoopPassOriginBeat: 6,
                audioOffsetSeconds: 0.5,
                audioUnwrappedOffsetSeconds: 0,
                audioLoopStartSeconds: 0,
                audioLoopPassEntrySeconds: 0.25,
            });
            expect(sourceFrameSegments(clipById('canonical'))).toEqual(expectedFrames);
            expect(clipById('legacy')).toMatchObject({ startBeat: 12, endBeat: 16 });
            expect(clipById('legacy')).not.toHaveProperty('audioOffsetSeconds');
            expect(clipById('legacy')).not.toHaveProperty('audioLoopPassOriginBeat');
            expect(clipById('unaffected')).toEqual(unaffected);
            assertAuthority();
        };

        await executeAppAction({
            type: 'drawClip',
            payload: {
                id: 'clip-drawn',
                trackId: 'track-1',
                startBeat: 2,
                endBeat: 4,
                name: 'Drawn',
                type: 'audio',
                ripple: true,
            },
        });
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(undoHistoryStore.value?.past[0]).toMatchObject({
            action: { type: 'drawClip' },
            inverseAction: { type: 'discardDrawnClip' },
            redoAction: { type: 'restoreDrawnClip' },
        });
        assertShifted();

        await undo();
        expect(clipById('canonical')).toEqual(canonical);
        expect(clipById('legacy')).toEqual(legacy);
        expect(clipById('unaffected')).toEqual(unaffected);
        expect(trackStore.value?.tracks[0]?.clips.some((clip) => clip.id === 'clip-drawn')).toBe(false);
        assertAuthority();

        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
        await redo();
        assertShifted();
    });

    it('uses the clamped placement delta for canonical source time through nudge Undo and Redo', async () => {
        const canonical = canonicalSourceClip();
        const unaffected = ClipDummy.create({ id: 'unaffected', trackId: 'track-1', startBeat: 12, endBeat: 16 });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-1', clips: [canonical, unaffected] })],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        const expectedFrames = [
            [0, 2, 24_000],
            [2, 3, 0],
            [3, 4, 12_000],
        ];
        const assertClamped = () => {
            expect(clipById('canonical')).toMatchObject({
                startBeat: 0,
                endBeat: 4,
                loopOriginBeat: -2,
                audioLoopPassOriginBeat: -1,
                audioOffsetSeconds: 0.5,
                audioUnwrappedOffsetSeconds: 0,
                audioLoopStartSeconds: 0,
                audioLoopPassEntrySeconds: 0.25,
            });
            expect(sourceFrameSegments(clipById('canonical'))).toEqual(expectedFrames);
            expect(clipById('unaffected')).toEqual(unaffected);
            flushAutomergeStorageWrites();
            expect(getCrdtDoc<{ tracks: NonNullable<typeof trackStore.value> }>('root')?.tracks.tracks).toEqual(
                trackStore.value?.tracks
            );
        };

        await executeAppAction({ type: 'nudgeClip', payload: { clipId: 'canonical', beats: -10 } });
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        assertClamped();
        await undo();
        expect(clipById('canonical')).toEqual(canonical);
        expect(clipById('unaffected')).toEqual(unaffected);
        await redo();
        assertClamped();
    });
});
