import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeUserAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { createTake, createTakeLane, type TakeLane } from '../../../models/TakeLane';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { selectTake } from '../selectTake';

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

let notifications: NotifyPayload[] = [];
let unsubscribeFromNotifications: () => void = () => undefined;

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

// Two lanes, each with its own takes; the target lane starts with its first
// take selected. This is the #4072 shape: a selection on one lane, then later
// edits to a DIFFERENT take lane, then undo.
function seedTakeLanes(): { target: TakeLane; other: TakeLane; takeA: string; takeB: string } {
    const takeA = createTake('clip-a', 'A', 0, 4);
    const takeB = createTake('clip-b', 'B', 4, 8);
    const otherTake = createTake('clip-other', 'Other', 0, 4);
    const target: TakeLane = {
        ...createTakeLane('track-1'),
        takes: [{ ...takeA, selected: true }, takeB],
    };
    const other: TakeLane = { ...createTakeLane('track-2'), takes: [otherTake] };
    takeLaneStore.set({ lanes: [target, other] });
    return { target, other, takeA: takeA.id, takeB: takeB.id };
}

function getLane(trackId: string): TakeLane {
    const lane = takeLaneStore.value?.lanes.find((candidate) => candidate.trackId === trackId);
    if (!lane) {
        throw new Error(`Expected a take lane for ${trackId}`);
    }
    return lane;
}

function selectedTakeIdOf(trackId: string): string | null {
    return getLane(trackId).takes.find((take) => take.selected)?.id ?? null;
}

function take0IdOf(lane: TakeLane): string {
    const takeId = lane.takes[0]?.id;
    if (!takeId) {
        throw new Error('Expected the other lane fixture to keep at least one take');
    }
    return takeId;
}

/** Applies a later edit to the OTHER lane: renames its take and replaces its
 *  comp regions — the interleaved state the old whole-store snapshot replay
 *  erased. Written straight to the store, mirroring how lane mutations land
 *  without routing through this action's own undo entry. */
function editOtherLane(other: TakeLane): void {
    takeLaneStore.set({
        lanes: takeLaneStore.value!.lanes.map((lane) =>
            lane.trackId === other.trackId
                ? {
                      ...lane,
                      takes: lane.takes.map((take) => ({ ...take, name: 'Renamed after selection' })),
                      activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: take0IdOf(lane) }],
                  }
                : lane
        ),
    });
}

describe('selectTake undo preservation (#4072)', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('selectTake undo preservation');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        const notificationEventBus = createEventBus<NotificationEvents>();
        notifications = [];
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationEventBus);
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        unsubscribeFromNotifications();
        Container.clear();
        takeLaneStore.set({ lanes: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('undoes and redoes only the target lane selection, preserving later edits to another lane', async () => {
        const { other, takeA, takeB } = seedTakeLanes();

        await selectTake('track-1', takeB);
        expect(selectedTakeIdOf('track-1')).toBe(takeB);
        expect(selectedTakeIdOf('track-2')).toBeNull();

        editOtherLane(other);

        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect(selectedTakeIdOf('track-1')).toBe(takeA);
        expect(getLane('track-2').takes[0]!.name).toBe('Renamed after selection');
        expect(getLane('track-2').activeCompRegions).toEqual([
            { startBeat: 0, endBeat: 4, takeId: take0IdOf(getLane('track-2')) },
        ]);

        await redo();
        expect(selectedTakeIdOf('track-1')).toBe(takeB);
        expect(getLane('track-2').takes[0]!.name).toBe('Renamed after selection');
        expect(getLane('track-2').activeCompRegions).toHaveLength(1);
    });

    it('records one undo entry labeled Select take with a self-inverse', async () => {
        seedTakeLanes();

        await selectTake('track-1', getLane('track-1').takes[1]!.id);

        expect(undoHistoryStore.value?.past).toHaveLength(1);
        const entry = undoHistoryStore.value?.past[0];
        expect(entry).toMatchObject({ label: 'Select take', kind: 'action' });
        if (entry?.kind !== 'action') {
            throw new Error('Expected an action undo entry');
        }
        expect(entry.inverseAction).toEqual({
            type: 'selectTake',
            payload: {
                trackId: 'track-1',
                takeId: getLane('track-1').takes[0]!.id,
                expectedSelectedTakeId: getLane('track-1').takes[1]!.id,
            },
        });
    });

    it('pushes no history entry when the requested take is already selected', async () => {
        seedTakeLanes();
        const alreadySelected = getLane('track-1').takes[0]!.id;

        await selectTake('track-1', alreadySelected);

        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(selectedTakeIdOf('track-1')).toBe(alreadySelected);
    });

    it('refuses undo with nothing written when the lane vanished', async () => {
        const { takeB } = seedTakeLanes();
        await selectTake('track-1', takeB);
        takeLaneStore.set({ lanes: takeLaneStore.value!.lanes.filter((lane) => lane.trackId !== 'track-1') });

        await expect(undo()).resolves.toEqual({ headConsumed: false });

        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(notifications).toEqual([
            { message: 'Cannot undo "Select take": project state has changed', level: 'warning' },
        ]);
    });

    it('refuses undo with nothing written when the selected take vanished', async () => {
        const { takeB } = seedTakeLanes();
        await selectTake('track-1', takeB);
        takeLaneStore.set({
            lanes: takeLaneStore.value!.lanes.map((lane) =>
                lane.trackId === 'track-1' ? { ...lane, takes: lane.takes.filter((take) => take.id !== takeB) } : lane
            ),
        });

        await expect(undo()).resolves.toEqual({ headConsumed: false });

        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(getLane('track-1').takes).toHaveLength(1);
    });

    it('refuses undo with nothing written when the selection diverged', async () => {
        const { takeA, takeB } = seedTakeLanes();
        await selectTake('track-1', takeB);
        // A later selection edit on the same lane the inverse knows nothing
        // about: the guard must refuse rather than overwrite it.
        takeLaneStore.set({
            lanes: takeLaneStore.value!.lanes.map((lane) =>
                lane.trackId === 'track-1'
                    ? { ...lane, takes: lane.takes.map((take) => ({ ...take, selected: take.id === takeA })) }
                    : lane
            ),
        });

        await expect(undo()).resolves.toEqual({ headConsumed: false });

        expect(selectedTakeIdOf('track-1')).toBe(takeA);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
    });

    it('surfaces dispatch conflicts to the user as a notification instead of throwing', async () => {
        seedTakeLanes();
        // No lane exists for this track: execute refuses; executeUserAppAction
        // converts the conflict into a warning and resolves.
        await expect(
            executeUserAppAction({ type: 'selectTake', payload: { trackId: 'missing', takeId: 'a' } })
        ).resolves.toBeUndefined();
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(notifications).toHaveLength(1);
        expect(notifications[0]!.level).toBe('warning');
    });
});
