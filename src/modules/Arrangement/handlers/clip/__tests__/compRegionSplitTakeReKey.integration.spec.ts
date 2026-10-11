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

function arrangeLoopComp(): { lane: TakeLane; compTake: Take } {
    const passLength = 8;
    const clip = ClipDummy.create({
        id: 'source',
        trackId: 'track-1',
        type: 'audio',
        startBeat: 8,
        endBeat: 16,
        audioBufferId: 'source-buffer',
    });
    const passes = [
        createTake('source', 'Pass 1', 8, 16),
        createTake('source', 'Pass 2', 8, 16, passLength),
        createTake('source', 'Pass 3', 8, 16, passLength * 2),
    ];
    const compTake = passes[1]!;
    trackStore.set({
        tracks: [TrackDummy.create({ id: 'track-1', kind: 'audio', clips: [clip] })],
        selectedTrackId: 'track-1',
        ghostClips: [],
    });
    takeLaneStore.set({
        lanes: [
            {
                ...createTakeLane('track-1'),
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

function lane(): TakeLane {
    const current = takeLaneStore.value?.lanes[0];
    if (!current) {
        throw new Error('Expected the comp lane');
    }
    return current;
}

function clips() {
    const track = trackStore.value?.tracks[0];
    if (!track) {
        throw new Error('Expected the arrangement track fixture');
    }
    return track.clips;
}

/** Resolved comp fragments as plain rows: timeline span, media origin, media offset. */
function resolvedFragments(): number[][] {
    return resolveClipsWithComping('track-1', clips()).map((clip) => [
        clip.startBeat,
        clip.endBeat,
        clip.sourceStartBeat,
        clip.audioOffsetBeats ?? 0,
    ]);
}

describe('Splitting a comped clip re-keys takes and comp regions onto both fragments', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('comp region split re-key integration');
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

    it('split at 14 keeps the comp sounding pass 2 across both fragments', async () => {
        const { lane: originalLane, compTake } = arrangeLoopComp();

        await executeAppAction({ type: 'splitClip', payload: { clipId: 'source', beat: 14 } });

        expect(undoStore.value?.past).toHaveLength(1);
        const rightClip = clips().find((clip) => clip.id !== 'source');
        if (!rightClip) {
            throw new Error('Expected the minted right fragment');
        }
        expect(clips().map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([
            ['source', 8, 14],
            [rightClip.id, 14, 16],
        ]);
        // Every pass take follows its clip: the left half keeps the take id
        // (the split convention), the right half mints the deterministic one.
        const mintedTakeId = `${compTake.id}:time-delete-right:14:14`;
        expect(lane().takes.map((take) => [take.id, take.clipId, take.startBeat, take.endBeat])).toEqual(
            originalLane.takes.flatMap((take) => [
                [take.id, 'source', 8, 14],
                [`${take.id}:time-delete-right:14:14`, rightClip.id, 14, 16],
            ])
        );
        expect(lane().activeCompRegions).toEqual([
            { startBeat: 8, endBeat: 14, takeId: compTake.id },
            { startBeat: 14, endBeat: 16, takeId: mintedTakeId },
        ]);
        // No audio changed: both fragments enter pass 2's media exactly where
        // the unsplit comp did — beats 14-16 keep sounding pass 2.
        expect(resolvedFragments()).toEqual([
            [8, 14, 0, 8],
            [14, 16, 6, 14],
        ]);
        expectAuthority();
    });

    it('split undo restores the whole comp exactly and redo re-fragments with stable take ids', async () => {
        const { lane: originalLane, compTake } = arrangeLoopComp();
        const mintedTakeId = `${compTake.id}:time-delete-right:14:14`;

        await executeAppAction({ type: 'splitClip', payload: { clipId: 'source', beat: 14 } });
        await undo();

        expect(clips().map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([['source', 8, 16]]);
        expect(lane()).toEqual(originalLane);
        expect(resolvedFragments()).toEqual([[8, 16, 0, 8]]);
        expectAuthority();

        await redo();
        const rightClip = clips().find((clip) => clip.id !== 'source');
        if (!rightClip) {
            throw new Error('Expected the re-minted right fragment');
        }
        expect(clips().map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([
            ['source', 8, 14],
            [rightClip.id, 14, 16],
        ]);
        expect(lane().takes.map((take) => take.id)).toContain(mintedTakeId);
        expect(lane().activeCompRegions).toEqual([
            { startBeat: 8, endBeat: 14, takeId: compTake.id },
            { startBeat: 14, endBeat: 16, takeId: mintedTakeId },
        ]);
        expect(resolvedFragments()).toEqual([
            [8, 14, 0, 8],
            [14, 16, 6, 14],
        ]);
        expectAuthority();
    });

    it('a take wholly left of the split rides verbatim while the comped take fragments', async () => {
        const arrange = arrangeLoopComp();
        const leftTake = createTake('source', 'Left comp', 8, 12);
        takeLaneStore.set({
            lanes: [
                {
                    ...lane(),
                    takes: [...lane().takes, leftTake],
                    activeCompRegions: [
                        { startBeat: 8, endBeat: 12, takeId: leftTake.id },
                        ...lane().activeCompRegions.map((region) =>
                            region.startBeat === 8 ? { ...region, startBeat: 12 } : region
                        ),
                    ],
                },
            ],
        });
        flushAutomergeStorageWrites();
        const compTake = arrange.compTake;

        await executeAppAction({ type: 'splitClip', payload: { clipId: 'source', beat: 14 } });

        const rightClip = clips().find((clip) => clip.id !== 'source');
        if (!rightClip) {
            throw new Error('Expected the minted right fragment');
        }
        // The left take never crosses the split: same id, same span, still
        // naming the (left) fragment clip id it always named.
        expect(lane().takes.find((take) => take.id === leftTake.id)).toEqual(leftTake);
        const mintedTakeId = `${compTake.id}:time-delete-right:14:14`;
        expect(lane().activeCompRegions).toEqual([
            { startBeat: 8, endBeat: 12, takeId: leftTake.id },
            { startBeat: 12, endBeat: 14, takeId: compTake.id },
            { startBeat: 14, endBeat: 16, takeId: mintedTakeId },
        ]);
        expect(resolvedFragments()).toEqual([
            [8, 12, 8, 0],
            [12, 14, 0, 12],
            [14, 16, 6, 14],
        ]);
        expectAuthority();
    });
});
