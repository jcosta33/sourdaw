import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
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
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { takeLaneStore } from '../../../stores/takeLaneStore';
import { setCompRegion } from '../../../useCases/comping/setCompRegion';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

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

let notifications: NotifyPayload[] = [];
let unsubscribeFromNotifications: () => void = () => undefined;

const lane = {
    id: 'lane-1',
    trackId: 'track-1',
    takes: [
        { id: 'take-a', clipId: 'clip-a', name: 'A', startBeat: 0, endBeat: 8, selected: true },
        { id: 'take-b', clipId: 'clip-b', name: 'B', startBeat: 0, endBeat: 8, selected: false },
        { id: 'take-c', clipId: 'clip-c', name: 'C', startBeat: 0, endBeat: 8, selected: false },
    ],
    activeCompRegions: [{ startBeat: 0, endBeat: 8, takeId: 'take-a' }],
};

const otherLane = {
    id: 'lane-2',
    trackId: 'track-2',
    automationLaneId: 'automation-2',
    takes: [{ id: 'take-d', clipId: 'clip-d', name: 'D', startBeat: 0, endBeat: 8, selected: true }],
    activeCompRegions: [{ startBeat: 0, endBeat: 8, takeId: 'take-d' }],
};

function activeRegions(laneId = 'lane-1') {
    return takeLaneStore.value?.lanes.find((candidate) => candidate.id === laneId)?.activeCompRegions;
}

async function applyBToTwoThroughFour(): Promise<void> {
    setCompRegion('track-1', { startBeat: 2, endBeat: 4, takeId: 'take-b' });
    await vi.waitFor(() => {
        expect(undoStore.value?.past).toEqual([{ label: 'Set comp region' }]);
    });
}

describe('setCompRegion command integration', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('set comp region integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        const notificationEventBus = createEventBus<NotificationEvents>();
        notifications = [];
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationEventBus);
        takeLaneStore.set({ lanes: [structuredClone(lane), structuredClone(otherLane)] });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        unsubscribeFromNotifications();
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        removeCrdtDoc('root');
        configureAutomergeStoragePort(null);
        Container.clear();
    });

    it('replaces only the requested interval in projected and CRDT state', async () => {
        await applyBToTwoThroughFour();

        const expected = [
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-b' },
            { startBeat: 4, endBeat: 8, takeId: 'take-a' },
        ];
        await vi.waitFor(() => {
            expect(activeRegions()).toEqual(expected);
        });
        flushAutomergeStorageWrites();
        expect(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]?.activeCompRegions
        ).toEqual(expected);
        expect(takeLaneStore.value?.lanes[1]).toEqual(otherLane);
    });

    it('does not write or create history when the requested selection is already exact', async () => {
        takeLaneStore.set({
            lanes: [
                {
                    ...structuredClone(lane),
                    activeCompRegions: [
                        { startBeat: 0, endBeat: 2, takeId: 'take-a' },
                        { startBeat: 2, endBeat: 4, takeId: 'take-b' },
                        { startBeat: 4, endBeat: 8, takeId: 'take-a' },
                    ],
                },
                structuredClone(otherLane),
            ],
        });
        flushAutomergeStorageWrites();
        const before = JSON.stringify(getCrdtDoc('root'));

        await executeAppAction({
            type: 'setCompRegion',
            payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
        });
        flushAutomergeStorageWrites();

        expect(JSON.stringify(getCrdtDoc('root'))).toBe(before);
        expect(undoStore.value).toEqual({ past: [], future: [] });
    });

    it('undoes and redoes only the requested interval over later unrelated edits', async () => {
        await applyBToTwoThroughFour();
        const current = takeLaneStore.value!;
        takeLaneStore.set({
            lanes: current.lanes.map((candidate) => {
                if (candidate.id === 'lane-1') {
                    return {
                        ...candidate,
                        takes: candidate.takes.map((take) =>
                            take.id === 'take-a' ? { ...take, name: 'A renamed later' } : take
                        ),
                        activeCompRegions: [
                            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
                            { startBeat: 2, endBeat: 4, takeId: 'take-b' },
                            { startBeat: 4, endBeat: 5, takeId: 'take-a' },
                            { startBeat: 5, endBeat: 6, takeId: 'take-c' },
                            { startBeat: 6, endBeat: 8, takeId: 'take-a' },
                        ],
                    };
                }
                return {
                    ...candidate,
                    automationLaneId: 'automation-renamed-later',
                    activeCompRegions: [{ startBeat: 1, endBeat: 7, takeId: 'take-d' }],
                };
            }),
        });
        flushAutomergeStorageWrites();

        expect(await undo()).toEqual({ headConsumed: true });
        expect(activeRegions()).toEqual([
            { startBeat: 0, endBeat: 5, takeId: 'take-a' },
            { startBeat: 5, endBeat: 6, takeId: 'take-c' },
            { startBeat: 6, endBeat: 8, takeId: 'take-a' },
        ]);
        expect(takeLaneStore.value?.lanes[0]?.takes[0]?.name).toBe('A renamed later');
        expect(takeLaneStore.value?.lanes[1]).toMatchObject({
            automationLaneId: 'automation-renamed-later',
            activeCompRegions: [{ startBeat: 1, endBeat: 7, takeId: 'take-d' }],
        });
        flushAutomergeStorageWrites();
        expect(
            getCrdtDoc<{
                takeLanes: { lanes: Array<{ id: string; activeCompRegions: typeof lane.activeCompRegions }> };
            }>('root')?.takeLanes.lanes.find((candidate) => candidate.id === 'lane-1')?.activeCompRegions
        ).toEqual(activeRegions());

        await redo();
        expect(undoStore.value).toMatchObject({ past: [{ label: 'Set comp region' }], future: [] });
        expect(activeRegions()).toEqual([
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-b' },
            { startBeat: 4, endBeat: 5, takeId: 'take-a' },
            { startBeat: 5, endBeat: 6, takeId: 'take-c' },
            { startBeat: 6, endBeat: 8, takeId: 'take-a' },
        ]);
        expect(takeLaneStore.value?.lanes[0]?.takes[0]?.name).toBe('A renamed later');
    });

    it('refuses undo when the selected take changed inside the requested interval', async () => {
        await applyBToTwoThroughFour();
        const current = takeLaneStore.value!;
        takeLaneStore.set({
            lanes: current.lanes.map((candidate) =>
                candidate.id === 'lane-1'
                    ? {
                          ...candidate,
                          activeCompRegions: [
                              { startBeat: 0, endBeat: 2, takeId: 'take-a' },
                              { startBeat: 2, endBeat: 4, takeId: 'take-c' },
                              { startBeat: 4, endBeat: 8, takeId: 'take-a' },
                          ],
                      }
                    : candidate
            ),
        });
        flushAutomergeStorageWrites();

        expect(await undo({ stepOverConflicts: false })).toEqual({ headConsumed: false });
        expect(activeRegions()).toEqual([
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-c' },
            { startBeat: 4, endBeat: 8, takeId: 'take-a' },
        ]);
        expect(undoStore.value?.past).toEqual([{ label: 'Set comp region' }]);
        flushAutomergeStorageWrites();
        expect(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]?.activeCompRegions
        ).toEqual(activeRegions());
    });

    it('coalesces only at joins inside the requested closed interval', async () => {
        takeLaneStore.set({
            lanes: [
                {
                    ...structuredClone(lane),
                    activeCompRegions: [
                        { startBeat: 0, endBeat: 1, takeId: 'take-a' },
                        { startBeat: 1, endBeat: 8, takeId: 'take-a' },
                    ],
                },
                structuredClone(otherLane),
            ],
        });
        flushAutomergeStorageWrites();

        await applyBToTwoThroughFour();
        expect(activeRegions()).toEqual([
            { startBeat: 0, endBeat: 1, takeId: 'take-a' },
            { startBeat: 1, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-b' },
            { startBeat: 4, endBeat: 8, takeId: 'take-a' },
        ]);

        expect(await undo()).toEqual({ headConsumed: true });
        expect(activeRegions()).toEqual([
            { startBeat: 0, endBeat: 1, takeId: 'take-a' },
            { startBeat: 1, endBeat: 8, takeId: 'take-a' },
        ]);
    });

    it('refuses when the captured interval changes while the command waits for a snapshot transaction', async () => {
        let allowSelectionChange!: () => void;
        let releaseTransaction!: () => void;
        let markTransactionStarted!: () => void;
        let markSelectionChanged!: () => void;
        const selectionChangeAllowed = new Promise<void>((resolve) => {
            allowSelectionChange = resolve;
        });
        const transactionRelease = new Promise<void>((resolve) => {
            releaseTransaction = resolve;
        });
        const transactionStarted = new Promise<void>((resolve) => {
            markTransactionStarted = resolve;
        });
        const selectionChanged = new Promise<void>((resolve) => {
            markSelectionChanged = resolve;
        });
        const transaction = transactSnapshot(async (snapshotTransaction) => {
            mutateCrdtDoc<{ commandAdmissionHold?: boolean }>({
                id: 'root',
                snapshotTransaction,
                changeFn: (document) => {
                    document.commandAdmissionHold = true;
                },
            });
            markTransactionStarted();
            await selectionChangeAllowed;
            const current = takeLaneStore.value!;
            const storageTransaction = runWithAutomergeStorageTransaction(snapshotTransaction, () => {
                takeLaneStore.set({
                    lanes: current.lanes.map((candidate) =>
                        candidate.id === 'lane-1'
                            ? {
                                  ...candidate,
                                  activeCompRegions: [
                                      { startBeat: 0, endBeat: 2, takeId: 'take-a' },
                                      { startBeat: 2, endBeat: 4, takeId: 'take-c' },
                                      { startBeat: 4, endBeat: 8, takeId: 'take-a' },
                                  ],
                              }
                            : candidate
                    ),
                });
            });
            storageTransaction.commit();
            markSelectionChanged();
            await transactionRelease;
        });
        await transactionStarted;

        setCompRegion('track-1', { startBeat: 2, endBeat: 4, takeId: 'take-b' });
        allowSelectionChange();
        await selectionChanged;
        expect(activeRegions()).toEqual([
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-c' },
            { startBeat: 4, endBeat: 8, takeId: 'take-a' },
        ]);
        releaseTransaction();
        await transaction;

        await vi.waitFor(() => {
            expect(notifications).toEqual([
                {
                    message: "Set comp region was refused because the project can't be changed right now.",
                    level: 'warning',
                },
            ]);
        });
        expect(activeRegions()).toEqual([
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-c' },
            { startBeat: 4, endBeat: 8, takeId: 'take-a' },
        ]);
        expect(undoStore.value).toEqual({ past: [], future: [] });
    });
});
