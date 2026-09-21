import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { automationStore, type AutomationStoreState } from '#/modules/Automation/stores';
import { createAutomationLane, getAutomationHandlers, getAutomationValueAtBeat } from '#/modules/Automation/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { macroStore } from '../../stores/macroStore';
import { undoStore } from '../../stores/undo-store-facade';
import { setActionHistoryMetadataPort } from '../actionHistoryMetadataPort';
import { clearUndoHistory } from '../clearUndoHistory';
import { executeAppAction } from '../executeAppAction';
import { executeAppActionBatch } from '../executeAppActionBatch';
import { getInternalUndoSessionReplayContracts } from '../getInternalUndoSessionReplayContracts';
import { redo } from '../redo';
import { resetActionReplayAuthority } from '../resetActionReplayAuthority';
import { undo } from '../undo';

const SOURCE_LANE_ID = 'lane-source';
const FOLLOWER_LANE_ID = 'lane-follower';
const DANGLING_LANE_ID = 'lane-dangling';
const SELF_LINKED_LANE_ID = 'lane-self-linked';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

function projectSnapshot(): string {
    return JSON.stringify(getCrdtDoc('root'));
}

function storeSnapshot(): AutomationStoreState | null {
    return automationStore.value ? structuredClone(automationStore.value) : null;
}

function undoSnapshot(): unknown {
    return undoStore.value ? structuredClone(undoStore.value) : null;
}

async function refusalOf(action: AppAction): Promise<string | null> {
    try {
        await executeAppAction(action);
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

describe('linked automation point admission', () => {
    beforeEach(() => {
        setNotificationEventBus(createEventBus<NotificationEvents>());
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('linked automation point admission');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getAutomationHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });

        const source = { ...createAutomationLane('track-1', 'gain', 'Source gain', 0, 1), id: SOURCE_LANE_ID };
        const follower = {
            ...createAutomationLane('track-2', 'gain', 'Follower gain', 0, 1),
            id: FOLLOWER_LANE_ID,
            linkedLaneId: SOURCE_LANE_ID,
            linkScale: 2,
        };
        const dangling = {
            ...createAutomationLane('track-3', 'gain', 'Dangling gain', 0, 1),
            id: DANGLING_LANE_ID,
            linkedLaneId: 'missing-source',
        };
        const selfLinked = {
            ...createAutomationLane('track-4', 'gain', 'Self-linked gain', 0, 1),
            id: SELF_LINKED_LANE_ID,
            linkedLaneId: SELF_LINKED_LANE_ID,
        };
        automationStore.set({
            lanes: [
                { ...source, points: [{ id: 'source-point', beat: 0, value: 0.2, curve: 'linear', tension: 0 }] },
                {
                    ...follower,
                    points: [{ id: 'ignored-follower-point', beat: 4, value: 0.9, curve: 'linear', tension: 0 }],
                },
                { ...dangling, points: [] },
                { ...selfLinked, points: [] },
            ],
        });
        flushAutomergeStorageWrites();
        expect(getCrdtDoc<{ automation?: AutomationStoreState }>('root')?.automation).toEqual(automationStore.value);
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        automationStore.set({ lanes: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each([
        { label: 'native value', payload: { value: 0.7 } },
        { label: 'absolute decibels', payload: { valueDb: -6 } },
        { label: 'relative decibels', payload: { deltaDb: 3 } },
    ])('refuses a linked follower $label without changing project state', async ({ label, payload }) => {
        const documentBefore = projectSnapshot();
        const storeBefore = storeSnapshot();
        const undoBefore = undoSnapshot();
        const sourceSampleBefore = getAutomationValueAtBeat(SOURCE_LANE_ID, 4);
        const followerSampleBefore = getAutomationValueAtBeat(FOLLOWER_LANE_ID, 4);

        const refusal = await refusalOf({
            type: 'addAutomationPoint',
            payload: { laneId: FOLLOWER_LANE_ID, beat: 4, pointId: `refused-${label}`, ...payload },
        });

        expect(refusal).toContain('follows automation lane');
        expect(projectSnapshot()).toBe(documentBefore);
        expect(automationStore.value).toEqual(storeBefore);
        expect(undoStore.value).toEqual(undoBefore);
        expect(getAutomationValueAtBeat(SOURCE_LANE_ID, 4)).toBe(sourceSampleBefore);
        expect(getAutomationValueAtBeat(FOLLOWER_LANE_ID, 4)).toBe(followerSampleBefore);
    });

    it('requires the owning handler to validate persisted point replay arguments', () => {
        const contract = getInternalUndoSessionReplayContracts().find(
            (candidate) => candidate.actionType === 'restoreAutomationPointPresence'
        );
        const validPayload = {
            laneId: FOLLOWER_LANE_ID,
            owner: { trackId: 'track-2', parameterId: 'gain', linkedLaneId: SOURCE_LANE_ID },
            point: { id: 'ignored-follower-point', beat: 4, value: 0.9, curve: 'linear', tension: 0 },
            equalBeatIndex: 0,
            expectedEqualBeatPoints: [],
            expectedPresence: 'present',
            replacementPresence: 'absent',
        };

        expect(contract?.validateArguments(validPayload)).toBe(true);
        expect(
            contract?.validateArguments({ ...validPayload, point: { ...validPayload.point, curve: 'warp-drive' } })
        ).toBe(false);
        expect(contract?.validateArguments({ ...validPayload, extra: 'smuggled' })).toBe(false);
    });

    it('preserves a same-beat peer point through index-only redo', async () => {
        await executeAppAction({
            type: 'removeAutomationPoint',
            payload: { laneId: FOLLOWER_LANE_ID, pointIndex: 0 },
        });
        expect((await undo()).headConsumed).toBe(true);
        const state = automationStore.value!;
        const peerPoint = { id: 'same-beat-peer', beat: 4, value: 0.6, curve: 'linear' as const, tension: 0 };
        automationStore.set({
            lanes: state.lanes.map((lane) =>
                lane.id === FOLLOWER_LANE_ID ? { ...lane, points: [peerPoint, ...lane.points] } : lane
            ),
        });
        flushAutomergeStorageWrites();

        await redo();

        expect(automationStore.value?.lanes.find((lane) => lane.id === FOLLOWER_LANE_ID)?.points).toEqual([peerPoint]);
        expect(getCrdtDoc<{ automation?: AutomationStoreState }>('root')?.automation).toEqual(automationStore.value);
    });

    it('restores an identified point with its full shape and equal-beat order', async () => {
        const state = automationStore.value!;
        const before = { id: 'same-beat-before', beat: 4, value: 0.2, curve: 'linear' as const, tension: 0 };
        const target = {
            id: 'shaped-target',
            beat: 4,
            value: 0.9,
            curve: 'bezier' as const,
            tension: 0.3,
            stairSteps: 7,
            cp1: { x: 0.2, y: 0.4 },
            cp2: { x: 0.8, y: 0.6 },
        };
        const after = { id: 'same-beat-after', beat: 4, value: 0.7, curve: 'linear' as const, tension: 0 };
        automationStore.set({
            lanes: state.lanes.map((lane) =>
                lane.id === FOLLOWER_LANE_ID ? { ...lane, points: [before, target, after] } : lane
            ),
        });
        flushAutomergeStorageWrites();

        await executeAppAction({
            type: 'removeAutomationPoint',
            payload: { laneId: FOLLOWER_LANE_ID, pointIndex: 1, pointId: target.id },
        });
        expect((await undo()).headConsumed).toBe(true);

        expect(automationStore.value?.lanes.find((lane) => lane.id === FOLLOWER_LANE_ID)?.points).toEqual([
            before,
            target,
            after,
        ]);
        expect(getCrdtDoc<{ automation?: AutomationStoreState }>('root')?.automation).toEqual(automationStore.value);
    });

    it('refuses restoration when a new same-beat peer makes the captured rank stale', async () => {
        const state = automationStore.value!;
        const before = { id: 'same-beat-before', beat: 4, value: 0.2, curve: 'linear' as const, tension: 0 };
        const target = { id: 'same-beat-target', beat: 4, value: 0.9, curve: 'linear' as const, tension: 0 };
        const after = { id: 'same-beat-after', beat: 4, value: 0.7, curve: 'linear' as const, tension: 0 };
        automationStore.set({
            lanes: state.lanes.map((lane) =>
                lane.id === FOLLOWER_LANE_ID ? { ...lane, points: [before, target, after] } : lane
            ),
        });
        flushAutomergeStorageWrites();
        await executeAppAction({
            type: 'removeAutomationPoint',
            payload: { laneId: FOLLOWER_LANE_ID, pointIndex: 1, pointId: target.id },
        });
        const removedState = automationStore.value!;
        const peer = { id: 'new-same-beat-peer', beat: 4, value: 0.4, curve: 'linear' as const, tension: 0 };
        automationStore.set({
            lanes: removedState.lanes.map((lane) =>
                lane.id === FOLLOWER_LANE_ID ? { ...lane, points: [peer, ...lane.points] } : lane
            ),
        });
        flushAutomergeStorageWrites();
        const documentWithPeer = projectSnapshot();
        const storeWithPeer = storeSnapshot();

        expect((await undo()).headConsumed).toBe(false);
        expect(projectSnapshot()).toBe(documentWithPeer);
        expect(automationStore.value).toEqual(storeWithPeer);
    });

    it('replays an unambiguous legacy id-less follower point without changing unrelated points', async () => {
        const state = automationStore.value!;
        const legacyPoint = { beat: 4, value: 0.9, curve: 'linear' as const, tension: 0 };
        automationStore.set({
            lanes: state.lanes.map((lane) =>
                lane.id === FOLLOWER_LANE_ID ? { ...lane, points: [legacyPoint] } : lane
            ),
        });
        flushAutomergeStorageWrites();

        await executeAppAction({
            type: 'removeAutomationPoint',
            payload: { laneId: FOLLOWER_LANE_ID, pointIndex: 0 },
        });
        expect((await undo()).headConsumed).toBe(true);
        const restoredState = automationStore.value!;
        const peerPoint = { id: 'legacy-peer', beat: 6, value: 0.6, curve: 'linear' as const, tension: 0 };
        automationStore.set({
            lanes: restoredState.lanes.map((lane) =>
                lane.id === FOLLOWER_LANE_ID ? { ...lane, points: [...lane.points, peerPoint] } : lane
            ),
        });
        flushAutomergeStorageWrites();

        await redo();
        expect(automationStore.value?.lanes.find((lane) => lane.id === FOLLOWER_LANE_ID)?.points).toEqual([peerPoint]);
        expect((await undo()).headConsumed).toBe(true);
        expect(automationStore.value?.lanes.find((lane) => lane.id === FOLLOWER_LANE_ID)?.points).toEqual([
            legacyPoint,
            peerPoint,
        ]);
    });

    it('refuses id-less follower restoration when a same-beat point makes identity ambiguous', async () => {
        const state = automationStore.value!;
        const legacyPoint = { beat: 4, value: 0.9, curve: 'linear' as const, tension: 0 };
        automationStore.set({
            lanes: state.lanes.map((lane) =>
                lane.id === FOLLOWER_LANE_ID ? { ...lane, points: [legacyPoint] } : lane
            ),
        });
        flushAutomergeStorageWrites();
        await executeAppAction({
            type: 'removeAutomationPoint',
            payload: { laneId: FOLLOWER_LANE_ID, pointIndex: 0 },
        });
        const removedState = automationStore.value!;
        const ambiguousPoint = { beat: 4, value: 0.7, curve: 'linear' as const, tension: 0 };
        automationStore.set({
            lanes: removedState.lanes.map((lane) =>
                lane.id === FOLLOWER_LANE_ID ? { ...lane, points: [ambiguousPoint] } : lane
            ),
        });
        flushAutomergeStorageWrites();
        const ambiguousDocument = projectSnapshot();

        expect((await undo()).headConsumed).toBe(false);
        expect(projectSnapshot()).toBe(ambiguousDocument);
    });

    it.each([
        { label: 'dangling', laneId: DANGLING_LANE_ID },
        { label: 'self-linked', laneId: SELF_LINKED_LANE_ID },
    ])('refuses a $label follower before trying to resolve its source', async ({ label, laneId }) => {
        const documentBefore = projectSnapshot();
        const storeBefore = storeSnapshot();
        const undoBefore = undoSnapshot();

        const refusal = await refusalOf({
            type: 'addAutomationPoint',
            payload: { laneId, beat: 2, pointId: `refused-${label}`, value: 0.5 },
        });

        expect(refusal).toContain('follows automation lane');
        expect(projectSnapshot()).toBe(documentBefore);
        expect(automationStore.value).toEqual(storeBefore);
        expect(undoStore.value).toEqual(undoBefore);
        expect(getAutomationValueAtBeat(laneId, 2)).toBeNull();
    });

    it('refuses a linked follower in a singleton batch without changing project state', async () => {
        const documentBefore = projectSnapshot();
        const storeBefore = storeSnapshot();
        const undoBefore = undoSnapshot();
        const sourceSampleBefore = getAutomationValueAtBeat(SOURCE_LANE_ID, 2);
        const followerSampleBefore = getAutomationValueAtBeat(FOLLOWER_LANE_ID, 2);

        const result = await executeAppActionBatch([
            {
                type: 'addAutomationPoint',
                payload: { laneId: FOLLOWER_LANE_ID, beat: 2, pointId: 'refused-batch-point', value: 0.7 },
            },
        ]);

        expect(result).toMatchObject({
            status: 'conflicted',
            reason: expect.stringContaining('follows automation lane'),
            actions: [],
        });
        expect(projectSnapshot()).toBe(documentBefore);
        expect(automationStore.value).toEqual(storeBefore);
        expect(undoStore.value).toEqual(undoBefore);
        expect(getAutomationValueAtBeat(SOURCE_LANE_ID, 2)).toBe(sourceSampleBefore);
        expect(getAutomationValueAtBeat(FOLLOWER_LANE_ID, 2)).toBe(followerSampleBefore);
    });

    it('undoes and redoes removal of a pre-existing follower point without changing its link or sampled source', async () => {
        const documentBefore = projectSnapshot();
        const storeBefore = storeSnapshot();
        const sourceSampleBefore = getAutomationValueAtBeat(SOURCE_LANE_ID, 4);
        const followerSampleBefore = getAutomationValueAtBeat(FOLLOWER_LANE_ID, 4);

        await executeAppAction({
            type: 'removeAutomationPoint',
            payload: { laneId: FOLLOWER_LANE_ID, pointIndex: 0, pointId: 'ignored-follower-point' },
        });

        expect(automationStore.value?.lanes.find((lane) => lane.id === FOLLOWER_LANE_ID)?.points).toEqual([]);
        expect(getAutomationValueAtBeat(SOURCE_LANE_ID, 4)).toBe(sourceSampleBefore);
        expect(getAutomationValueAtBeat(FOLLOWER_LANE_ID, 4)).toBe(followerSampleBefore);

        expect((await undo()).headConsumed).toBe(true);
        expect(projectSnapshot()).toBe(documentBefore);
        expect(automationStore.value).toEqual(storeBefore);
        expect(getAutomationValueAtBeat(FOLLOWER_LANE_ID, 4)).toBe(followerSampleBefore);

        const restoredState = automationStore.value!;
        const peerPoint = { id: 'peer-after-undo', beat: 6, value: 0.6, curve: 'linear' as const, tension: 0 };
        automationStore.set({
            lanes: restoredState.lanes.map((lane) =>
                lane.id === FOLLOWER_LANE_ID ? { ...lane, points: [...lane.points, peerPoint] } : lane
            ),
        });
        flushAutomergeStorageWrites();
        const restoredWithPeerDocument = projectSnapshot();
        const restoredWithPeerStore = storeSnapshot();

        await redo();

        const followerAfterRedo = automationStore.value?.lanes.find((lane) => lane.id === FOLLOWER_LANE_ID);
        expect(followerAfterRedo?.points).toEqual([peerPoint]);
        expect(followerAfterRedo).toMatchObject({ linkedLaneId: SOURCE_LANE_ID, linkScale: 2 });
        expect(getCrdtDoc<{ automation?: AutomationStoreState }>('root')?.automation).toEqual(automationStore.value);
        expect(getAutomationValueAtBeat(SOURCE_LANE_ID, 4)).toBe(sourceSampleBefore);
        expect(getAutomationValueAtBeat(FOLLOWER_LANE_ID, 4)).toBe(followerSampleBefore);

        expect((await undo()).headConsumed).toBe(true);
        expect(projectSnapshot()).toBe(restoredWithPeerDocument);
        expect(automationStore.value).toEqual(restoredWithPeerStore);
    });

    it('refuses follower-point undo after the same point identity is replaced', async () => {
        await executeAppAction({
            type: 'removeAutomationPoint',
            payload: { laneId: FOLLOWER_LANE_ID, pointIndex: 0, pointId: 'ignored-follower-point' },
        });
        const state = automationStore.value!;
        automationStore.set({
            lanes: state.lanes.map((lane) => {
                if (lane.id !== FOLLOWER_LANE_ID) {
                    return lane;
                }
                return {
                    ...lane,
                    points: [{ id: 'ignored-follower-point', beat: 4, value: 0.6, curve: 'linear', tension: 0 }],
                };
            }),
        });
        flushAutomergeStorageWrites();
        const peerDocument = projectSnapshot();
        const peerStore = storeSnapshot();

        expect((await undo()).headConsumed).toBe(false);
        expect(projectSnapshot()).toBe(peerDocument);
        expect(automationStore.value).toEqual(peerStore);
    });

    it('keeps source-lane point writes effective for a follower through undo and redo', async () => {
        expect(getAutomationValueAtBeat(SOURCE_LANE_ID, 4)).toBeCloseTo(0.2);
        expect(getAutomationValueAtBeat(FOLLOWER_LANE_ID, 4)).toBeCloseTo(0.4);

        await executeAppAction({
            type: 'addAutomationPoint',
            payload: { laneId: SOURCE_LANE_ID, beat: 4, pointId: 'accepted-source-point', value: 0.8 },
        });

        expect(getAutomationValueAtBeat(SOURCE_LANE_ID, 4)).toBeCloseTo(0.8);
        expect(getAutomationValueAtBeat(FOLLOWER_LANE_ID, 4)).toBeCloseTo(1.6);
        expect(getCrdtDoc<{ automation?: AutomationStoreState }>('root')?.automation).toEqual(automationStore.value);
        expect(undoStore.value?.past).toHaveLength(1);

        expect((await undo()).headConsumed).toBe(true);
        expect(getAutomationValueAtBeat(SOURCE_LANE_ID, 4)).toBeCloseTo(0.2);
        expect(getAutomationValueAtBeat(FOLLOWER_LANE_ID, 4)).toBeCloseTo(0.4);
        expect(getCrdtDoc<{ automation?: AutomationStoreState }>('root')?.automation).toEqual(automationStore.value);

        await redo();

        expect(getAutomationValueAtBeat(SOURCE_LANE_ID, 4)).toBeCloseTo(0.8);
        expect(getAutomationValueAtBeat(FOLLOWER_LANE_ID, 4)).toBeCloseTo(1.6);
        expect(getCrdtDoc<{ automation?: AutomationStoreState }>('root')?.automation).toEqual(automationStore.value);
    });
});
