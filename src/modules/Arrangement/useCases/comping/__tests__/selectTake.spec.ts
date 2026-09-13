import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
    executeUserAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    captureDurableDocumentWitness,
    createCrdtDoc,
    getCrdtDoc,
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

function rawTakeLanes(): { lanes: TakeLane[] } {
    const value = getCrdtDoc<{ takeLanes?: { lanes: TakeLane[] } }>('root')?.takeLanes;
    if (!value) {
        throw new Error('Expected raw take-lane authority');
    }
    return value;
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
function editOtherLane(
    other: TakeLane,
    edit: { takeName: string; compStartBeat: number; compEndBeat: number; addedTakeName: string }
): TakeLane {
    const addedTake = createTake(`clip-${edit.addedTakeName}`, edit.addedTakeName, 8, 12);
    takeLaneStore.set({
        lanes: takeLaneStore.value!.lanes.map((lane) =>
            lane.trackId === other.trackId
                ? {
                      ...lane,
                      takes: [...lane.takes.map((take) => ({ ...take, name: edit.takeName })), addedTake],
                      activeCompRegions: [
                          { startBeat: edit.compStartBeat, endBeat: edit.compEndBeat, takeId: take0IdOf(lane) },
                      ],
                  }
                : lane
        ),
    });
    return getLane(other.trackId);
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
        expect(rawTakeLanes().lanes.find((lane) => lane.trackId === 'track-1')?.takes).toEqual(
            getLane('track-1').takes
        );

        const beforeUndoOtherLane = editOtherLane(other, {
            takeName: 'Renamed before undo',
            compStartBeat: 1,
            compEndBeat: 3,
            addedTakeName: 'Added before undo',
        });
        flushAutomergeStorageWrites();
        const beforeUndoRaw = structuredClone(rawTakeLanes());

        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect(selectedTakeIdOf('track-1')).toBe(takeA);
        expect(getLane('track-2')).toEqual(beforeUndoOtherLane);
        expect(rawTakeLanes().lanes.find((lane) => lane.trackId === 'track-2')).toEqual(beforeUndoOtherLane);
        expect(rawTakeLanes().lanes.find((lane) => lane.trackId === 'track-2')).toEqual(
            beforeUndoRaw.lanes.find((lane) => lane.trackId === 'track-2')
        );

        const beforeRedoOtherLane = editOtherLane(getLane('track-2'), {
            takeName: 'Renamed again before redo',
            compStartBeat: 2,
            compEndBeat: 4,
            addedTakeName: 'Added before redo',
        });
        flushAutomergeStorageWrites();
        const beforeRedoRaw = structuredClone(rawTakeLanes());

        await redo();
        expect(selectedTakeIdOf('track-1')).toBe(takeB);
        expect(getLane('track-2')).toEqual(beforeRedoOtherLane);
        expect(rawTakeLanes().lanes.find((lane) => lane.trackId === 'track-2')).toEqual(beforeRedoOtherLane);
        expect(rawTakeLanes().lanes.find((lane) => lane.trackId === 'track-2')).toEqual(
            beforeRedoRaw.lanes.find((lane) => lane.trackId === 'track-2')
        );
        expect(rawTakeLanes().lanes).toEqual(takeLaneStore.value?.lanes);
    });

    it('restores an initially empty selection and redoes the selected take with history movement', async () => {
        const takeA = createTake('clip-a', 'A', 0, 4);
        const takeB = createTake('clip-b', 'B', 4, 8);
        takeLaneStore.set({
            lanes: [{ ...createTakeLane('track-1'), takes: [takeA, takeB] }],
        });

        await selectTake('track-1', takeA.id);
        expect(selectedTakeIdOf('track-1')).toBe(takeA.id);
        expect(undoHistoryStore.value).toMatchObject({ past: [expect.any(Object)], future: [] });

        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect(selectedTakeIdOf('track-1')).toBeNull();
        expect(rawTakeLanes().lanes).toEqual(takeLaneStore.value?.lanes);
        expect(undoHistoryStore.value).toMatchObject({ past: [], future: [expect.any(Object)] });

        await redo();
        expect(selectedTakeIdOf('track-1')).toBe(takeA.id);
        expect(rawTakeLanes().lanes).toEqual(takeLaneStore.value?.lanes);
        expect(undoHistoryStore.value).toMatchObject({ past: [expect.any(Object)], future: [] });
    });

    it('undoes and redoes a grouped pair of selections from the sequentially captured predecessor', async () => {
        const { other, takeA, takeB } = seedTakeLanes();
        const takeC = createTake('clip-c', 'C', 8, 12);
        takeLaneStore.set({
            lanes: [{ ...getLane('track-1'), takes: [...getLane('track-1').takes, takeC] }, structuredClone(other)],
        });
        flushAutomergeStorageWrites();

        await expect(
            executeAppActionBatch(
                [
                    { type: 'selectTake', payload: { trackId: 'track-1', takeId: takeB } },
                    { type: 'selectTake', payload: { trackId: 'track-1', takeId: takeC.id } },
                ],
                { groupId: 'grouped-sequential-take-capture' }
            )
        ).resolves.toMatchObject({ status: 'committed' });
        expect(selectedTakeIdOf('track-1')).toBe(takeC.id);
        expect(getLane('track-2')).toEqual(other);
        flushAutomergeStorageWrites();
        expect(rawTakeLanes().lanes).toEqual(takeLaneStore.value?.lanes);

        await expect(undo({ stepOverConflicts: false })).resolves.toEqual({ headConsumed: true });
        expect(selectedTakeIdOf('track-1')).toBe(takeA);
        expect(getLane('track-2')).toEqual(other);
        flushAutomergeStorageWrites();
        expect(rawTakeLanes().lanes).toEqual(takeLaneStore.value?.lanes);
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(undoHistoryStore.value?.future).toHaveLength(2);

        await redo();
        expect(selectedTakeIdOf('track-1')).toBe(takeC.id);
        expect(getLane('track-2')).toEqual(other);
        flushAutomergeStorageWrites();
        expect(rawTakeLanes().lanes).toEqual(takeLaneStore.value?.lanes);
        expect(undoHistoryStore.value?.past).toHaveLength(2);
        expect(undoHistoryStore.value?.future).toEqual([]);
    });

    it('undoes and redoes grouped selections from an initially empty selection', async () => {
        const takeA = createTake('clip-a', 'A', 0, 4);
        const takeB = createTake('clip-b', 'B', 4, 8);
        const takeC = createTake('clip-c', 'C', 8, 12);
        takeLaneStore.set({ lanes: [{ ...createTakeLane('track-1'), takes: [takeA, takeB, takeC] }] });
        flushAutomergeStorageWrites();

        await expect(
            executeAppActionBatch(
                [
                    { type: 'selectTake', payload: { trackId: 'track-1', takeId: takeB.id } },
                    { type: 'selectTake', payload: { trackId: 'track-1', takeId: takeC.id } },
                ],
                { groupId: 'grouped-empty-take-capture' }
            )
        ).resolves.toMatchObject({ status: 'committed' });
        expect(selectedTakeIdOf('track-1')).toBe(takeC.id);

        await expect(undo({ stepOverConflicts: false })).resolves.toEqual({ headConsumed: true });
        expect(selectedTakeIdOf('track-1')).toBeNull();
        flushAutomergeStorageWrites();
        expect(rawTakeLanes().lanes).toEqual(takeLaneStore.value?.lanes);

        await redo();
        expect(selectedTakeIdOf('track-1')).toBe(takeC.id);
        flushAutomergeStorageWrites();
        expect(rawTakeLanes().lanes).toEqual(takeLaneStore.value?.lanes);
    });

    it('does not misclassify a later sibling that returns the batch to its initial take as a noop', async () => {
        const { takeA, takeB } = seedTakeLanes();

        await expect(
            executeAppActionBatch(
                [
                    { type: 'selectTake', payload: { trackId: 'track-1', takeId: takeB } },
                    { type: 'selectTake', payload: { trackId: 'track-1', takeId: takeA } },
                ],
                { groupId: 'grouped-return-to-initial-take' }
            )
        ).resolves.toMatchObject({ status: 'committed', actions: [{}, {}] });
        expect(selectedTakeIdOf('track-1')).toBe(takeA);
        expect(undoHistoryStore.value?.past).toHaveLength(2);

        await expect(undo({ stepOverConflicts: false })).resolves.toEqual({ headConsumed: true });
        expect(selectedTakeIdOf('track-1')).toBe(takeA);
        expect(undoHistoryStore.value?.future).toHaveLength(2);

        await redo();
        expect(selectedTakeIdOf('track-1')).toBe(takeA);
        expect(undoHistoryStore.value?.past).toHaveLength(2);
        expect(undoHistoryStore.value?.future).toEqual([]);
    });

    it('rejects an invalid selection prefix without writing project state or history', async () => {
        const { takeA, takeB } = seedTakeLanes();
        const takeC = createTake('clip-c', 'C', 8, 12);
        const lane = getLane('track-1');
        takeLaneStore.set({ lanes: [{ ...lane, takes: [...lane.takes, takeC] }, getLane('track-2')] });
        flushAutomergeStorageWrites();
        const before = structuredClone(takeLaneStore.value!.lanes);

        await expect(
            executeAppActionBatch(
                [
                    { type: 'selectTake', payload: { trackId: lane.trackId, takeId: takeB } },
                    {
                        type: 'selectTake',
                        payload: {
                            trackId: lane.trackId,
                            takeId: takeC.id,
                            expectedLaneId: lane.id,
                            expectedSelectedTakeId: takeA,
                        },
                    },
                ],
                { groupId: 'invalid-selection-prefix' }
            )
        ).resolves.toEqual({
            status: 'conflicted',
            reason: 'Action conflicts with current project state: selectTake',
            actions: [],
        });
        expect(takeLaneStore.value?.lanes).toEqual(before);
        flushAutomergeStorageWrites();
        expect(rawTakeLanes().lanes).toEqual(before);
        expect(undoHistoryStore.value).toEqual({ past: [], future: [] });
    });

    it('refuses undo after same-track lane owner replacement without state or history movement', async () => {
        const { target, takeB } = seedTakeLanes();
        await selectTake(target.trackId, takeB);
        const replacement = { ...getLane(target.trackId), id: 'replacement-lane' };
        takeLaneStore.set({
            lanes: takeLaneStore.value!.lanes.map((lane) => (lane.id === target.id ? replacement : lane)),
        });
        flushAutomergeStorageWrites();
        const beforeRaw = structuredClone(rawTakeLanes());
        const beforeProjection = structuredClone(takeLaneStore.value);
        const beforeWitness = captureDurableDocumentWitness();

        await expect(undo()).resolves.toEqual({ headConsumed: false });

        expect(rawTakeLanes()).toEqual(beforeRaw);
        expect(takeLaneStore.value).toEqual(beforeProjection);
        expect(captureDurableDocumentWitness()).toBe(beforeWitness);
        expect(undoHistoryStore.value).toMatchObject({ past: [expect.any(Object)], future: [] });
    });

    it('refuses redo after same-track lane owner replacement without state or history movement', async () => {
        const { target, takeA, takeB } = seedTakeLanes();
        await selectTake(target.trackId, takeB);
        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect(selectedTakeIdOf(target.trackId)).toBe(takeA);
        const replacement = { ...getLane(target.trackId), id: 'replacement-lane' };
        takeLaneStore.set({
            lanes: takeLaneStore.value!.lanes.map((lane) => (lane.id === target.id ? replacement : lane)),
        });
        flushAutomergeStorageWrites();
        const beforeRaw = structuredClone(rawTakeLanes());
        const beforeProjection = structuredClone(takeLaneStore.value);
        const beforeWitness = captureDurableDocumentWitness();

        await redo();

        expect(rawTakeLanes()).toEqual(beforeRaw);
        expect(takeLaneStore.value).toEqual(beforeProjection);
        expect(captureDurableDocumentWitness()).toBe(beforeWitness);
        expect(undoHistoryStore.value).toMatchObject({ past: [], future: [expect.any(Object)] });
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
                expectedLaneId: getLane('track-1').id,
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
