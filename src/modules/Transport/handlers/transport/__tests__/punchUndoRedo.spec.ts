import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, executeAppActionBatch, redo, undo } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { defaultTransportState, transportStore } from '../../../stores/transportStore';
import { getTransportHandlers } from '../../../useCases/getTransportHandlers';
import { setPunchIn } from '../../../useCases/transportControls/setPunchIn';
import { setPunchOut } from '../../../useCases/transportControls/setPunchOut';

type PunchAction = Extract<AppAction, { type: 'setPunchIn' | 'setPunchOut' }>;

type PunchRegion = {
    punchInBeat: number;
    punchOutBeat: number;
};

type PunchUndoCase = {
    label: string;
    action: PunchAction;
    before: PunchRegion;
    after: PunchRegion;
};

const punch_undo_cases = [
    {
        label: 'non-crossing setPunchIn',
        action: { type: 'setPunchIn', payload: { beat: 6 } },
        before: { punchInBeat: 4, punchOutBeat: 12 },
        after: { punchInBeat: 6, punchOutBeat: 12 },
    },
    {
        label: 'crossing setPunchIn',
        action: { type: 'setPunchIn', payload: { beat: 20 } },
        before: { punchInBeat: 4, punchOutBeat: 12 },
        after: { punchInBeat: 20, punchOutBeat: 21 },
    },
    {
        label: 'non-crossing setPunchOut',
        action: { type: 'setPunchOut', payload: { beat: 10 } },
        before: { punchInBeat: 4, punchOutBeat: 12 },
        after: { punchInBeat: 4, punchOutBeat: 10 },
    },
    {
        label: 'crossing setPunchOut',
        action: { type: 'setPunchOut', payload: { beat: 2 } },
        before: { punchInBeat: 4, punchOutBeat: 12 },
        after: { punchInBeat: 1, punchOutBeat: 2 },
    },
] satisfies PunchUndoCase[];

function get_punch_region(): PunchRegion {
    const state = transportStore.value;
    if (!state) {
        throw new Error('Expected Transport state');
    }

    return { punchInBeat: state.punchInBeat, punchOutBeat: state.punchOutBeat };
}

function describe_punch_action(action: PunchAction) {
    const handlers = getTransportHandlers();
    return action.type === 'setPunchIn' ? handlers.setPunchIn.describe(action) : handlers.setPunchOut.describe(action);
}

describe('Transport punch action undo/redo', () => {
    beforeEach(() => {
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        registerHandlerMap(getTransportHandlers());
        clearUndoHistory();
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
    });

    it.each(punch_undo_cases)(
        '$label restores exact endpoint pairs and stack positions',
        async ({ action, before, after }) => {
            transportStore.set({ ...defaultTransportState, ...before });

            const description = describe_punch_action(action);
            expect(description.inverseAction).toEqual({
                type: 'restorePunchRegion',
                payload: { expected: after, replacement: before },
            });
            expect(description.redoAction).toEqual({
                type: 'restorePunchRegion',
                payload: { expected: before, replacement: after },
            });

            await executeAppAction(action);

            expect(get_punch_region()).toEqual(after);
            expect(undoStore.value?.past).toHaveLength(1);
            expect(undoStore.value?.future).toHaveLength(0);

            await undo();

            expect(get_punch_region()).toEqual(before);
            expect(undoStore.value?.past).toHaveLength(0);
            expect(undoStore.value?.future).toHaveLength(1);

            await redo();

            expect(get_punch_region()).toEqual(after);
            expect(undoStore.value?.past).toHaveLength(1);
            expect(undoStore.value?.future).toHaveLength(0);
        }
    );

    it('advances stale undo history when a collaborator later achieves its replacement', async () => {
        const before = { punchInBeat: 4, punchOutBeat: 12 };
        const after = { punchInBeat: 20, punchOutBeat: 21 };
        transportStore.set({ ...defaultTransportState, ...before });

        await executeAppAction({ type: 'setPunchIn', payload: { beat: after.punchInBeat } });
        setPunchOut(40);

        await undo();

        expect(get_punch_region()).toEqual({ punchInBeat: 20, punchOutBeat: 40 });
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);

        setPunchIn(before.punchInBeat);
        setPunchOut(before.punchOutBeat);
        await undo();

        expect(get_punch_region()).toEqual(before);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);
    });

    it('advances stale redo history when a collaborator later achieves its replacement', async () => {
        const before = { punchInBeat: 4, punchOutBeat: 12 };
        const after = { punchInBeat: 1, punchOutBeat: 2 };
        transportStore.set({ ...defaultTransportState, ...before });

        await executeAppAction({ type: 'setPunchOut', payload: { beat: 2 } });
        await undo();
        setPunchIn(6);

        await redo();

        expect(get_punch_region()).toEqual({ punchInBeat: 6, punchOutBeat: 12 });
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);

        setPunchOut(after.punchOutBeat);
        await redo();

        expect(get_punch_region()).toEqual(after);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('undoes and redoes the legacy manual punch toggle through explicit guarded state', async () => {
        transportStore.set({ ...defaultTransportState, punchInEnabled: false });

        await executeAppAction({ type: 'togglePunch', payload: undefined });
        expect(transportStore.value?.punchInEnabled).toBe(true);

        await undo();
        expect(transportStore.value?.punchInEnabled).toBe(false);
        expect(undoStore.value?.future).toHaveLength(1);

        await redo();
        expect(transportStore.value?.punchInEnabled).toBe(true);
        expect(undoStore.value?.past).toHaveLength(1);
    });

    it('rejects a legacy toggle mixed with another punch-enabled action before either can write', async () => {
        transportStore.set({ ...defaultTransportState, punchInEnabled: false });

        const result = await executeAppActionBatch([
            { type: 'setPunchEnabled', payload: { enabled: true } },
            { type: 'togglePunch', payload: undefined },
        ]);

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Action must execute as a singleton batch: togglePunch',
            actions: [],
        });
        expect(transportStore.value?.punchInEnabled).toBe(false);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('undoes and redoes a singleton legacy toggle batch from its exact preflight state', async () => {
        transportStore.set({ ...defaultTransportState, punchInEnabled: false });

        await expect(executeAppActionBatch([{ type: 'togglePunch', payload: undefined }])).resolves.toMatchObject({
            status: 'committed',
        });
        expect(transportStore.value?.punchInEnabled).toBe(true);
        expect(undoStore.value?.past).toHaveLength(1);

        await undo();
        expect(transportStore.value?.punchInEnabled).toBe(false);
        expect(undoStore.value?.future).toHaveLength(1);

        await redo();
        expect(transportStore.value?.punchInEnabled).toBe(true);
        expect(undoStore.value?.past).toHaveLength(1);
    });

    it('undoes and redoes explicit punch enablement without changing endpoints', async () => {
        transportStore.set({
            ...defaultTransportState,
            punchInEnabled: false,
            punchInBeat: 4,
            punchOutBeat: 12,
        });

        expect(
            getTransportHandlers().setPunchEnabled.describe({
                type: 'setPunchEnabled',
                payload: { enabled: true },
            })
        ).toEqual({
            label: 'Enable Punch In/Out',
            inverseAction: {
                type: 'setPunchEnabled',
                payload: { enabled: false, expectedEnabled: true },
            },
            redoAction: {
                type: 'setPunchEnabled',
                payload: { enabled: true, expectedEnabled: false },
            },
        });

        await executeAppAction({ type: 'setPunchEnabled', payload: { enabled: true } });
        expect(transportStore.value).toMatchObject({
            punchInEnabled: true,
            punchInBeat: 4,
            punchOutBeat: 12,
        });

        await undo();
        expect(transportStore.value).toMatchObject({
            punchInEnabled: false,
            punchInBeat: 4,
            punchOutBeat: 12,
        });

        await redo();
        expect(transportStore.value).toMatchObject({
            punchInEnabled: true,
            punchInBeat: 4,
            punchOutBeat: 12,
        });
    });

    it('retains undo and redo entries while transport is busy, then retries safely', async () => {
        transportStore.set({ ...defaultTransportState, punchInEnabled: false });
        await executeAppAction({ type: 'setPunchEnabled', payload: { enabled: true } });

        transportStore.set({ ...transportStore.value!, isPlaying: true });
        await undo();
        expect(transportStore.value?.punchInEnabled).toBe(true);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);

        transportStore.set({ ...transportStore.value!, isPlaying: false });
        await undo();
        expect(transportStore.value?.punchInEnabled).toBe(false);
        expect(undoStore.value?.future).toHaveLength(1);

        transportStore.set({ ...transportStore.value!, isRecording: true });
        await redo();
        expect(transportStore.value?.punchInEnabled).toBe(false);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);

        transportStore.set({ ...transportStore.value!, isRecording: false });
        await redo();
        expect(transportStore.value?.punchInEnabled).toBe(true);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('advances history when guarded undo and redo replacements are already achieved', async () => {
        transportStore.set({ ...defaultTransportState, punchInEnabled: false });
        await executeAppAction({ type: 'setPunchEnabled', payload: { enabled: true } });

        transportStore.set({ ...transportStore.value!, punchInEnabled: false });
        await undo();
        expect(transportStore.value?.punchInEnabled).toBe(false);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);

        transportStore.set({ ...transportStore.value!, punchInEnabled: true });
        await redo();
        expect(transportStore.value?.punchInEnabled).toBe(true);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
    });
});
