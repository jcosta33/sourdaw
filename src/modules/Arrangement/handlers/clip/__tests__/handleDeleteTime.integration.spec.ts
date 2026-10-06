import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
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
    mutateCrdtDoc,
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
import { deleteTimeRange } from '../../../useCases/clipEditing/deleteTimeRange';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { resolveClipsWithComping } from '../../../useCases/resolveComping';
import { setTimeOperationDependencies } from '../../../useCases/timeOperations/timeOperationDependencies';
import { validateTakeLaneTransitionPlan } from '../../../useCases/timeOperations/validateTakeLaneTransitionPlan';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

type Project = { tracks: TrackStoreState; takeLanes: TakeLaneStoreState };

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

let stopProjectionBridge: () => void;

function lane(): TakeLane {
    const current = takeLaneStore.value?.lanes[0];
    if (!current) {
        throw new Error('Expected the comp lane');
    }
    return current;
}

function clips() {
    return trackStore.value?.tracks[0]?.clips ?? [];
}

function arrangeComp(startBeat: number, endBeat: number): Take {
    const clip = ClipDummy.create({ id: 'source', trackId: 'track-1', type: 'audio', startBeat, endBeat });
    const take = createTake(clip.id, 'Original', startBeat, endBeat);
    trackStore.set({
        tracks: [TrackDummy.create({ id: 'track-1', kind: 'audio', clips: [clip] })],
        selectedTrackId: 'track-1',
        ghostClips: [],
    });
    takeLaneStore.set({
        lanes: [
            {
                ...createTakeLane('track-1'),
                takes: [take],
                activeCompRegions: [{ startBeat, endBeat, takeId: take.id }],
            },
        ],
    });
    flushAutomergeStorageWrites();
    return take;
}

function expectAuthority(): void {
    flushAutomergeStorageWrites();
    const project = getCrdtDoc<Project>('root');
    expect(project?.tracks.tracks[0]?.clips).toEqual(clips());
    expect(project?.takeLanes.lanes).toEqual(takeLaneStore.value?.lanes);
}

function coverage(): number[][] {
    return resolveClipsWithComping('track-1', clips()).map((clip) => [clip.startBeat, clip.endBeat]);
}

async function removeTime(route: 'global' | 'selected', startBeat: number, endBeat: number): Promise<void> {
    if (route === 'global') {
        await executeAppAction({ type: 'deleteTime', payload: { startBeat, endBeat } });
    } else {
        // This is the selected-range UI entry; its callbacks replay through Command undo/redo.
        deleteTimeRange(startBeat, endBeat, ['track-1']);
        flushAutomergeStorageWrites();
    }
    expect(undoStore.value?.past).toHaveLength(1);
}

async function peerComp(take: Take, startBeat: number, endBeat: number): Promise<void> {
    const history = structuredClone(undoStore.value);
    // Inbound document edits have no local undo entry, and the projection bridge
    // must expose the new take before the real comp handler captures its patch.
    mutateCrdtDoc<Project>({
        id: 'root',
        changeFn: (project) => {
            project.takeLanes.lanes[0]!.takes.push(take);
        },
    });
    expect(lane().takes).toContainEqual(take);
    await executeAppAction(
        { type: 'setCompRegion', payload: { trackId: 'track-1', takeId: take.id, startBeat, endBeat } },
        { skipUndo: true }
    );
    expectAuthority();
    expect(undoStore.value).toEqual(history);
}

describe('Delete Time take ownership through Command and CRDT', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('delete time comp integration');
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
        // The fixture carries no automation, MIDI, or tempo-map data; those owners idle.
        const idle = {
            status: 'ready' as const,
            hasChanges: false,
            replayPlan: { version: 1 as const, notes: [] },
            inversePlan: null,
            apply: () => true,
            revert: () => true,
        };
        setTimeOperationDependencies({
            prepareAutomationTimeOperation: () => idle,
            prepareAutomationTimeStateRestore: () => idle,
            prepareMidiGlobalTimeTransaction: () => idle,
            prepareMidiTimeStateRestore: () => idle,
            prepareTimelineMapTimeOperation: () => idle,
            prepareTimelineMapStateRestore: () => idle,
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        stopProjectionBridge();
        configureAutomergeStoragePort(null);
        setTimeOperationDependencies(null);
        sessionStorage.removeItem('sourdaw-undo-session');
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('still rejects a transition with a real overlap smaller than one fractional rounding step', () => {
        const take = arrangeComp(0.3, 4.3);
        const overlapping = [
            { startBeat: 0.3, endBeat: 0.4, takeId: take.id },
            { startBeat: 0.3999999999999999, endBeat: 2.4, takeId: take.id },
        ];
        expect(
            validateTakeLaneTransitionPlan({
                version: 1,
                appliedEffect: 'restore',
                removedClipIds: [],
                retiredLanes: [],
                reKeyedLanes: [
                    {
                        laneId: lane().id,
                        trackId: 'track-1',
                        takesBefore: [take],
                        takesAfter: [take],
                        regionsBefore: overlapping,
                        regionsAfter: overlapping,
                    },
                ],
            })
        ).toBeNull();
        expectAuthority();
    });

    it('global undo removes peer facets on the removed fragment and preserves surviving peer choices', async () => {
        const route = 'global';
        const original = arrangeComp(0, 10);
        await removeTime(route, 2, 6);
        const right = clips().find((clip) => clip.id !== 'source');
        if (!right) {
            throw new Error('Expected the minted right fragment');
        }
        const orphan = createTake(right.id, 'Peer right fragment', right.startBeat, right.endBeat);
        await peerComp(orphan, right.startBeat + 1, right.endBeat - 1);
        const survivor = { ...createTake('source', 'Peer surviving clip', 0, 2), selected: true };
        await peerComp(survivor, 0.5, 1.5);
        mutateCrdtDoc<Project>({
            id: 'root',
            changeFn: (project) => {
                project.takeLanes.lanes[0]!.takes.find((take) => take.id === original.id)!.selected = true;
            },
        });

        await undo();

        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(1);
        expect(clips().map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([['source', 0, 10]]);
        expect(lane().takes).toEqual([{ ...original, selected: true }, survivor]);
        expect(lane().activeCompRegions).toContainEqual({ startBeat: 0.5, endBeat: 1.5, takeId: survivor.id });
        expect(lane().activeCompRegions.every((region) => region.takeId !== orphan.id)).toBe(true);
        expect(coverage()).toEqual([
            [0, 0.5],
            [0.5, 1.5],
            [1.5, 2],
            [2, 10],
        ]);
        expectAuthority();

        const afterUndo = createTake('source', 'Peer after undo', 0, 2);
        await peerComp(afterUndo, 1.6, 1.8);
        await redo();
        expect(lane().takes).toContainEqual(survivor);
        expect(lane().takes).toContainEqual(afterUndo);
        expect(lane().activeCompRegions).toContainEqual({ startBeat: 1.6, endBeat: 1.8, takeId: afterUndo.id });
        expect(lane().takes.find((take) => take.id === original.id)?.selected).toBe(true);
        expect(lane().takes.some((take) => take.id === orphan.id)).toBe(false);
        expectAuthority();
    });

    it('global keeps exact fractional fragment edges through undo and redo', async () => {
        const route = 'global';
        const original = arrangeComp(0.3, 4.3);

        await removeTime(route, 0.4, 2.3);

        const afterClips = structuredClone(clips());
        const afterLane = structuredClone(lane());
        const edges = afterClips.map((clip) => [clip.startBeat, clip.endBeat]);
        expect(edges[0]).toEqual([0.3, 0.4]);
        expect(edges[1]?.[0]).toBe(0.4);
        expect(lane().takes.map((take) => [take.startBeat, take.endBeat])).toEqual(edges);
        expect(lane().activeCompRegions.map((region) => [region.startBeat, region.endBeat])).toEqual(edges);
        expect(lane().activeCompRegions[0]!.endBeat).toBeLessThanOrEqual(lane().activeCompRegions[1]!.startBeat);
        expect(coverage()).toEqual(edges);
        expectAuthority();

        await undo();
        expect(clips().map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual([['source', 0.3, 4.3]]);
        expect(lane().takes).toEqual([original]);
        expect(lane().activeCompRegions).toEqual([{ startBeat: 0.3, endBeat: 4.3, takeId: original.id }]);
        expect(coverage()).toEqual([[0.3, 4.3]]);
        expectAuthority();

        await redo();
        expect(clips()).toEqual(afterClips);
        expect(lane()).toEqual(afterLane);
        expect(coverage()).toEqual(edges);
        expectAuthority();
    });

    it('selected keeps exact fractional fragment edges through its UI entry', async () => {
        arrangeComp(0.3, 4.3);
        await removeTime('selected', 0.4, 2.3);
        const edges = clips().map((clip) => [clip.startBeat, clip.endBeat]);
        expect(edges).toEqual([
            [0.3, 0.4],
            [2.3, 4.3],
        ]);
        expect(lane().takes.map((take) => [take.startBeat, take.endBeat])).toEqual(edges);
        expect(lane().activeCompRegions.map((region) => [region.startBeat, region.endBeat])).toEqual(edges);
        expect(coverage()).toEqual(edges);
        expectAuthority();
    });
});
