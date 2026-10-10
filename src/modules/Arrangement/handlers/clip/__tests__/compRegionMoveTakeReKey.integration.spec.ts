import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore as undoStore } from '#/modules/Command/stores';
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
    getCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane, type Take, type TakeLane } from '../../../models/TakeLane';
import { takeLaneStore, type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { trackStore, type TrackStoreState } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { resolveClipsWithComping } from '../../../useCases/resolveComping';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

type Project = {
    tracks: TrackStoreState;
    takeLanes: TakeLaneStoreState;
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

let stopProjectionBridge: () => void;

/** One loop-recorded clip over [8,16): three passes, pass 2 comped. */
function arrangeLoopComp(trackId: string, clipId: string): { lane: TakeLane; compTake: Take } {
    const passLength = 8;
    const clip = ClipDummy.create({
        id: clipId,
        trackId,
        type: 'audio',
        startBeat: 8,
        endBeat: 16,
        audioBufferId: 'source-buffer',
    });
    const passes = [
        createTake(clipId, 'Pass 1', 8, 16),
        createTake(clipId, 'Pass 2', 8, 16, passLength),
        createTake(clipId, 'Pass 3', 8, 16, passLength * 2),
    ];
    const compTake = passes[1]!;
    trackStore.set({
        tracks: [TrackDummy.create({ id: trackId, kind: 'audio', clips: [clip] })],
        selectedTrackId: trackId,
        ghostClips: [],
    });
    takeLaneStore.set({
        lanes: [
            {
                ...createTakeLane(trackId),
                takes: passes,
                activeCompRegions: [{ startBeat: 8, endBeat: 16, takeId: compTake.id }],
            },
        ],
    });
    flushAutomergeStorageWrites();
    const lane = takeLaneStore.value?.lanes[0];
    if (!lane) {
        throw new Error('Expected the comp lane');
    }
    return { lane, compTake };
}

function expectAuthority(): void {
    flushAutomergeStorageWrites();
    const project = getCrdtDoc<Project>('root');
    if (!project) {
        throw new Error('Expected the project document');
    }
    if (!trackStore.value) {
        throw new Error('Expected the track store');
    }
    if (!takeLaneStore.value) {
        throw new Error('Expected the take lane store');
    }
    expect(project.tracks.tracks).toEqual(trackStore.value.tracks);
    expect(project.takeLanes.lanes).toEqual(takeLaneStore.value.lanes);
}

function lane(trackId: string): TakeLane {
    const current = takeLaneStore.value?.lanes.find((candidate) => candidate.trackId === trackId);
    if (!current) {
        throw new Error(`Expected the comp lane for ${trackId}`);
    }
    return current;
}

function clipsOf(trackId: string) {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
        throw new Error(`Expected the track fixture ${trackId}`);
    }
    return track.clips;
}

/** Resolved comp fragments as plain rows: timeline span, media origin, media offset. */
function resolvedFragments(trackId: string): number[][] {
    return resolveClipsWithComping(trackId, clipsOf(trackId)).map((clip) => [
        clip.startBeat,
        clip.endBeat,
        clip.sourceStartBeat,
        clip.audioOffsetBeats ?? 0,
    ]);
}

describe('Moving a comped clip takes its takes and comp regions with it', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('comp region move re-key integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores();
        sessionStorage.removeItem('sourdaw-undo-session');
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        stopProjectionBridge();
        configureAutomergeStoragePort(null);
        sessionStorage.removeItem('sourdaw-undo-session');
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('moveClip re-keys the moved clip takes and comp regions with it', async () => {
        const { lane: originalLane, compTake } = arrangeLoopComp('track-1', 'source');

        await executeAppAction({ type: 'moveClip', payload: { clipId: 'source', trackId: 'track-1', startBeat: 9 } });

        expect(undoStore.value?.past).toHaveLength(1);
        expect(clipsOf('track-1').map((clip) => [clip.startBeat, clip.endBeat])).toEqual([[9, 17]]);
        expect(lane('track-1').takes.map((take) => [take.startBeat, take.endBeat])).toEqual([
            [9, 17],
            [9, 17],
            [9, 17],
        ]);
        expect(lane('track-1').activeCompRegions).toEqual([{ startBeat: 9, endBeat: 17, takeId: compTake.id }]);
        // The comped audio is beat-identical to the pre-move comp: the fragment
        // enters the same pass-2 media (offset 8 beats deep), only one beat later.
        expect(resolvedFragments('track-1')).toEqual([[9, 17, 1, 8]]);
        expect(lane('track-1').takes.map((take) => take.sourceOffsetBeats ?? 0)).toEqual([0, 8, 16]);
        expectAuthority();
        expect(lane('track-1')).not.toEqual(originalLane);
    });

    it('moveClip undo restores the exact pre-move comp facets and redo re-travels them', async () => {
        const { lane: originalLane } = arrangeLoopComp('track-1', 'source');

        await executeAppAction({ type: 'moveClip', payload: { clipId: 'source', trackId: 'track-1', startBeat: 9 } });
        await undo();

        expect(clipsOf('track-1').map((clip) => [clip.startBeat, clip.endBeat])).toEqual([[8, 16]]);
        expect(lane('track-1')).toEqual(originalLane);
        expect(resolvedFragments('track-1')).toEqual([[8, 16, 0, 8]]);
        expectAuthority();

        await redo();
        expect(clipsOf('track-1').map((clip) => [clip.startBeat, clip.endBeat])).toEqual([[9, 17]]);
        expect(lane('track-1').activeCompRegions).toEqual([
            { startBeat: 9, endBeat: 17, takeId: originalLane.activeCompRegions[0]!.takeId },
        ]);
        expect(resolvedFragments('track-1')).toEqual([[9, 17, 1, 8]]);
        expectAuthority();
    });

    it('nudgeClip travels the comp and its inverse nudge restores it', async () => {
        const { lane: originalLane, compTake } = arrangeLoopComp('track-1', 'source');

        await executeAppAction({ type: 'nudgeClip', payload: { clipId: 'source', beats: 1 } });

        expect(undoStore.value?.past).toHaveLength(1);
        expect(lane('track-1').activeCompRegions).toEqual([{ startBeat: 9, endBeat: 17, takeId: compTake.id }]);
        expect(resolvedFragments('track-1')).toEqual([[9, 17, 1, 8]]);
        expectAuthority();

        await undo();
        expect(clipsOf('track-1').map((clip) => [clip.startBeat, clip.endBeat])).toEqual([[8, 16]]);
        expect(lane('track-1')).toEqual(originalLane);
        expect(resolvedFragments('track-1')).toEqual([[8, 16, 0, 8]]);
        expectAuthority();
    });

    it('a sibling comp on another clip of the same track rides verbatim', async () => {
        const arrange = arrangeLoopComp('track-1', 'source');
        const siblingClip = ClipDummy.create({
            id: 'sibling',
            trackId: 'track-1',
            type: 'audio',
            startBeat: 20,
            endBeat: 24,
            audioBufferId: 'sibling-buffer',
        });
        const siblingTake = createTake('sibling', 'Sibling pass', 20, 24, 4);
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 'track-1',
                    kind: 'audio',
                    clips: [...clipsOf('track-1'), siblingClip],
                }),
            ],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        takeLaneStore.set({
            lanes: [
                {
                    ...lane('track-1'),
                    takes: [...lane('track-1').takes, siblingTake],
                    activeCompRegions: [
                        ...lane('track-1').activeCompRegions,
                        { startBeat: 20, endBeat: 24, takeId: siblingTake.id },
                    ],
                },
            ],
        });
        flushAutomergeStorageWrites();
        const siblingLaneBefore = structuredClone({
            takes: lane('track-1').takes.filter((take) => take.clipId === 'sibling'),
            regions: lane('track-1').activeCompRegions.filter((region) => region.takeId === siblingTake.id),
        });

        await executeAppAction({ type: 'moveClip', payload: { clipId: 'source', trackId: 'track-1', startBeat: 9 } });

        expect({
            takes: lane('track-1').takes.filter((take) => take.clipId === 'sibling'),
            regions: lane('track-1').activeCompRegions.filter((region) => region.takeId === siblingTake.id),
        }).toEqual(siblingLaneBefore);
        expect(lane('track-1').activeCompRegions.map((region) => [region.startBeat, region.endBeat])).toEqual([
            [9, 17],
            [20, 24],
        ]);
        expect(resolvedFragments('track-1')).toEqual([
            [9, 17, 1, 8],
            [20, 24, 16, 4],
        ]);
        expectAuthority();
        expect(arrange.compTake.selected).toBe(false);
    });
});
