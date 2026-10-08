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
import { resetActionReplayAuthority } from '../resetActionReplayAuthority';

const SOURCE_LANE_ID = 'lane-source';
const FOLLOWER_LANE_ID = 'lane-follower';

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

// Every transform must actually move the follower's local points so a silent
// write cannot pass for a refusal: three points leave thin something to drop,
// place quantize off its one-beat grid, and leave reverse an order to change.
const FOLLOWER_POINTS = [
    { id: 'follower-point-1', beat: 0.5, value: 0.3, curve: 'linear' as const, tension: 0 },
    { id: 'follower-point-2', beat: 2.5, value: 0.5, curve: 'linear' as const, tension: 0 },
    { id: 'follower-point-3', beat: 4.5, value: 0.7, curve: 'linear' as const, tension: 0 },
];

const followerTransformActions: AppAction[] = [
    { type: 'scaleAutomation', payload: { laneId: FOLLOWER_LANE_ID, factor: 2 } },
    { type: 'stretchAutomation', payload: { laneId: FOLLOWER_LANE_ID, factor: 2 } },
    { type: 'invertAutomation', payload: { laneId: FOLLOWER_LANE_ID } },
    { type: 'reverseAutomation', payload: { laneId: FOLLOWER_LANE_ID } },
    { type: 'thinAutomation', payload: { laneId: FOLLOWER_LANE_ID, tolerance: 0.01 } },
    { type: 'quantizeAutomation', payload: { laneId: FOLLOWER_LANE_ID, gridSize: 1 } },
];

describe('linked automation transform admission', () => {
    beforeEach(() => {
        setNotificationEventBus(createEventBus<NotificationEvents>());
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('linked automation transform admission');
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
        automationStore.set({
            lanes: [
                {
                    ...source,
                    points: [
                        { id: 'source-point-1', beat: 0, value: 0.2, curve: 'linear', tension: 0 },
                        { id: 'source-point-2', beat: 8, value: 0.8, curve: 'linear', tension: 0 },
                    ],
                },
                { ...follower, points: FOLLOWER_POINTS.map((point) => ({ ...point, value: point.value })) },
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

    it.each(followerTransformActions)(
        'refuses $type on a linked follower without changing project state',
        async (action) => {
            const documentBefore = projectSnapshot();
            const storeBefore = storeSnapshot();
            const undoBefore = undoSnapshot();
            const followerPointsBefore = structuredClone(FOLLOWER_POINTS);
            const sourceSampleBefore = getAutomationValueAtBeat(SOURCE_LANE_ID, 4);
            const followerSampleBefore = getAutomationValueAtBeat(FOLLOWER_LANE_ID, 4);

            const refusal = await refusalOf(action);

            expect(refusal).toContain('follows automation lane');
            expect(projectSnapshot()).toBe(documentBefore);
            expect(automationStore.value).toEqual(storeBefore);
            expect(undoStore.value).toEqual(undoBefore);
            expect(automationStore.value?.lanes.find((lane) => lane.id === FOLLOWER_LANE_ID)?.points).toEqual(
                followerPointsBefore
            );
            expect(getAutomationValueAtBeat(SOURCE_LANE_ID, 4)).toBe(sourceSampleBefore);
            expect(getAutomationValueAtBeat(FOLLOWER_LANE_ID, 4)).toBe(followerSampleBefore);
        }
    );

    it('still transforms the source lane itself while a linked sibling is present', async () => {
        const sourceSampleBefore = getAutomationValueAtBeat(SOURCE_LANE_ID, 4);
        const followerSampleBefore = getAutomationValueAtBeat(FOLLOWER_LANE_ID, 4);

        await executeAppAction({
            type: 'scaleAutomation',
            payload: { laneId: SOURCE_LANE_ID, factor: 2 },
        });

        expect(undoStore.value?.past).toHaveLength(1);
        expect(getAutomationValueAtBeat(SOURCE_LANE_ID, 4)).not.toBe(sourceSampleBefore);
        expect(getAutomationValueAtBeat(FOLLOWER_LANE_ID, 4)).not.toBe(followerSampleBefore);
        expect(getCrdtDoc<{ automation?: AutomationStoreState }>('root')?.automation).toEqual(automationStore.value);
    });
});
