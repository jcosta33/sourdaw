import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, undo } from '#/modules/Command/useCases';

import { createAutomationLane } from '../../../models/Automation';
import { automationStore } from '../../../stores/automationStore';
import { getAutomationHandlers } from '../../../useCases/getAutomationHandlers';
import { handleSetAutomationLaneEnabled } from '../handleSetAutomationLaneEnabled';

const LANE_ID = 'lane-1';

function seedLane(enabled: boolean): void {
    automationStore.set({
        lanes: [
            {
                ...createAutomationLane('track-1', 'gain', 'Gain'),
                id: LANE_ID,
                enabled,
            },
        ],
    });
}

describe('handleSetAutomationLaneEnabled', () => {
    beforeEach(() => {
        seedLane(true);
    });

    it('changes the lane and describes an inverse that restores the prior value', () => {
        const action = {
            type: 'setAutomationLaneEnabled' as const,
            payload: { laneId: LANE_ID, enabled: false },
        };

        const description = handleSetAutomationLaneEnabled.describe(action);
        void handleSetAutomationLaneEnabled.execute(action);

        expect(automationStore.value?.lanes[0]?.enabled).toBe(false);
        expect(description.inverseAction).toEqual({
            type: 'setAutomationLaneEnabled',
            payload: { laneId: LANE_ID, enabled: true },
        });

        if (description.inverseAction?.type !== 'setAutomationLaneEnabled') {
            throw new Error('Expected an automation-lane enablement inverse');
        }
        void handleSetAutomationLaneEnabled.execute(description.inverseAction);
        expect(automationStore.value?.lanes[0]?.enabled).toBe(true);
    });

    it('treats missing lanes and unchanged values as no-ops', () => {
        expect(
            handleSetAutomationLaneEnabled.isNoop?.({
                type: 'setAutomationLaneEnabled',
                payload: { laneId: LANE_ID, enabled: true },
            })
        ).toBe(true);
        expect(
            handleSetAutomationLaneEnabled.isNoop?.({
                type: 'setAutomationLaneEnabled',
                payload: { laneId: 'missing-lane', enabled: false },
            })
        ).toBe(true);
    });
});

describe('setAutomationLaneEnabled through action dispatch', () => {
    let document: Record<string, unknown>;
    let mutationCount: number;

    beforeEach(() => {
        document = {};
        mutationCount = 0;
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                changeFn(document);
                mutationCount += 1;
            },
        });
        clearHandlerRegistry();
        registerHandlerMap(getAutomationHandlers());
        clearUndoHistory();
        seedLane(true);
        flushAutomergeStorageWrites();
        mutationCount = 0;
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
    });

    it('commits through the registered action and restores the prior state on undo', async () => {
        await executeAppAction({
            type: 'setAutomationLaneEnabled',
            payload: { laneId: LANE_ID, enabled: false },
        });

        expect(automationStore.value?.lanes[0]?.enabled).toBe(false);
        expect(mutationCount).toBe(1);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]?.label).toBe('Disable automation: Gain');

        await undo();

        expect(automationStore.value?.lanes[0]?.enabled).toBe(true);
        expect(mutationCount).toBe(2);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);
    });

    it.each([
        ['unchanged value', LANE_ID, true, false],
        ['missing lane', 'missing-lane', false, false],
        ['missing store state', LANE_ID, false, true],
    ])('records no write or undo entry for %s', async (_label, laneId, enabled, clearState) => {
        if (clearState) {
            automationStore.set(null);
            flushAutomergeStorageWrites();
            mutationCount = 0;
        }
        const beforeState = automationStore.value;

        await executeAppAction({
            type: 'setAutomationLaneEnabled',
            payload: { laneId, enabled },
        });

        expect(automationStore.value).toBe(beforeState);
        expect(mutationCount).toBe(0);
        expect(undoStore.value?.past).toHaveLength(0);
    });
});
