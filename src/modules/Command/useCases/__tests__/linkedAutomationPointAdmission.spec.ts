import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { macroStore } from '../../stores/macroStore';
import { undoStore } from '../../stores/undo-store-facade';
import { setActionHistoryMetadataPort } from '../actionHistoryMetadataPort';
import { clearUndoHistory } from '../clearUndoHistory';
import { executeAppAction } from '../executeAppAction';
import { executeAppActionBatch } from '../executeAppActionBatch';
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
