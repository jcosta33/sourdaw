import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
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

import { type AutomationLane, type AutomationPoint } from '../../../models/Automation';
import { automationStore, type AutomationStoreState } from '../../../stores/automationStore';
import { getAutomationHandlers } from '../../../useCases/getAutomationHandlers';

type Root = { automation: AutomationStoreState };
const a: AutomationPoint[] = [{ id: 'origin', beat: 0, value: 0.1, curve: 'linear', tension: 0 }];
const b: AutomationPoint[] = [{ id: 'middle', beat: 2, value: 0.7, curve: 'step', tension: 0 }];
const c: AutomationPoint[] = [
    { id: 'end', beat: 5, value: 0.3, curve: 'bezier', tension: 0.2, cp1: { x: 0.2, y: 0.9 }, cp2: { x: 0.7, y: 0.1 } },
];

function lane(id: string): AutomationLane {
    return {
        id,
        trackId: 'track',
        parameterId: id,
        parameterName: id,
        points: structuredClone(a),
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
        color: '#a1b2c3',
    };
}

function material() {
    flushAutomergeStorageWrites();
    const root = getCrdtDoc<Root>('root');
    if (!root) {
        throw new Error('Expected automation batch authority');
    }
    const raw = Automerge.toJS(root);
    expect(raw.automation).toEqual(structuredClone(automationStore.value));
    return raw;
}

function restore(
    laneId: string,
    points: AutomationPoint[],
    expectedPoints: AutomationPoint[]
): Extract<AppAction, { type: 'restoreAutomationLanePoints' }> {
    return { type: 'restoreAutomationLanePoints', payload: { laneId, points, expectedPoints } };
}

describe('guarded automation point restores through real atomic batches', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('automation restore batch');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        clearHandlerRegistry();
        registerHandlerMap(getAutomationHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        clearActionHistory();
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        automationStore.set({ lanes: [lane('first'), lane('second')] });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        automationStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('checks successive guards against the actual same-lane A to B to C prefix', async () => {
        const before = material();

        const result = await executeAppActionBatch([restore('first', b, a), restore('first', c, b)]);

        expect(result.status).toBe('committed');
        expect(material().automation).toEqual({
            lanes: [{ ...before.automation.lanes[0], points: c }, before.automation.lanes[1]],
        });
    });

    it('rolls back the earlier distinct-lane write when a later expected snapshot conflicts', async () => {
        const before = material();
        const heads = Automerge.getHeads(getCrdtDoc('root')!);

        const result = await executeAppActionBatch([restore('first', b, a), restore('second', c, b)]);

        expect(result.status).toBe('conflicted');
        expect(material()).toEqual(before);
        expect(Automerge.getHeads(getCrdtDoc('root')!)).toEqual(heads);
    });

    it.each(['points', 'expectedPoints'] as const)(
        'refuses a malformed later %s without committing sibling changes',
        async (field) => {
            const before = material();
            const heads = Automerge.getHeads(getCrdtDoc('root')!);
            const malformed = restore('second', c, a);
            malformed.payload[field] = [{ id: 'invalid', beat: 1, value: 0.4, curve: 'not-a-curve', tension: 0 }];

            const result = await executeAppActionBatch([restore('first', b, a), malformed]);

            expect(result.status).toBe('conflicted');
            expect(material()).toEqual(before);
            expect(Automerge.getHeads(getCrdtDoc('root')!)).toEqual(heads);
        }
    );

    it.each([
        {
            type: 'reverseAutomation',
            forward: [
                { id: 'right', beat: 1.25, value: 0.625, curve: 'linear', tension: 0 },
                { id: 'left', beat: 5.5, value: 0.125, curve: 'linear', tension: 0 },
            ],
        },
        {
            type: 'invertAutomation',
            forward: [
                { id: 'left', beat: 1.25, value: 0.875, curve: 'linear', tension: 0 },
                { id: 'right', beat: 5.5, value: 0.375, curve: 'linear', tension: 0 },
            ],
        },
    ] as const)('replays a normal $type command through exact project state and history', async ({ type, forward }) => {
        const bus = createEventBus<{
            'ui.notify': NotifyPayload;
            'ui.confirm': ConfirmPayload;
            'ui.prompt': PromptPayload;
        }>();
        const notifications: NotifyPayload[] = [];
        bus.on('ui.notify', (payload) => {
            notifications.push(payload);
        });
        setNotificationEventBus(bus);
        const points: AutomationPoint[] = [
            { id: 'left', beat: 1.25, value: 0.125, curve: 'linear', tension: 0 },
            { id: 'right', beat: 5.5, value: 0.625, curve: 'linear', tension: 0 },
        ];
        automationStore.set({ lanes: [{ ...lane('first'), points }, lane('second')] });
        const before = material().automation;
        const expected = { lanes: [{ ...before.lanes[0], points: forward }, before.lanes[1]] };
        const action = { type, payload: { laneId: 'first' } } satisfies AppAction;

        await executeAppAction(action);

        expect(material().automation).toStrictEqual(expected);
        expect(automationStore.value).toStrictEqual(expected);
        const entry = undoHistoryStore.value?.past.at(-1);
        if (!entry || entry.kind !== 'action') {
            throw new Error('Expected the real transform history entry');
        }
        expect(entry).toMatchObject({
            action,
            inverseAction: {
                type: 'restoreAutomationLanePoints',
                payload: { laneId: 'first', points, expectedPoints: forward },
            },
        });
        expect(undoHistoryStore.value?.past).toEqual([entry]);
        expect(undoHistoryStore.value?.future).toEqual([]);

        expect(await undo({ stepOverConflicts: false })).toEqual({ headConsumed: true });

        expect(material().automation).toStrictEqual(before);
        expect(automationStore.value).toStrictEqual(before);
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(undoHistoryStore.value?.future).toEqual([entry]);

        await redo({ stepOverConflicts: false });

        expect(material().automation).toStrictEqual(expected);
        expect(automationStore.value).toStrictEqual(expected);
        expect(undoHistoryStore.value?.past).toEqual([entry]);
        expect(undoHistoryStore.value?.future).toEqual([]);
        expect(notifications).toEqual([]);
    });
});
