import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    AutomergeStorageWriteConflictError,
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandBatchPreflightPort,
    commandProjectRevisionPort,
    compileVersionedCommandBatchEnvelope,
    configureCommandBatchIdempotency,
    executeAppAction,
    executeAppActionBatch,
    executeVersionedCommandBatchEnvelope,
    getExecutableAppActionEffect,
    getExecutableAppActionToolSchemas,
    getExecutableCommandRegistrations,
    getVersionedCommandArgumentsDigest,
    issueCommandApprovalBinding,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    parseVersionedCommandEnvelope,
    redo,
    resetActionReplayAuthority,
    resetCommandBatchIdempotency,
    serializeVersionedCommandEnvelope,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
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

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { setArrangementEventBus } from '../../../useCases/arrangementEventBus';
import { addTake } from '../../../useCases/comping/addTake';
import { compRegionInterval } from '../../../useCases/comping/compRegionInterval';
import { removeCompRegion } from '../../../useCases/comping/removeCompRegion';
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

function holdSnapshotRegionEdit(nextRegions: typeof lane.activeCompRegions) {
    let applyEdit!: () => void;
    let releaseTransaction!: () => void;
    let markTransactionStarted!: () => void;
    let markEditApplied!: () => void;
    const editAllowed = new Promise<void>((resolve) => {
        applyEdit = resolve;
    });
    const transactionRelease = new Promise<void>((resolve) => {
        releaseTransaction = resolve;
    });
    const transactionStarted = new Promise<void>((resolve) => {
        markTransactionStarted = resolve;
    });
    const editApplied = new Promise<void>((resolve) => {
        markEditApplied = resolve;
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
        await editAllowed;
        const current = takeLaneStore.value!;
        const storageTransaction = runWithAutomergeStorageTransaction(snapshotTransaction, () => {
            takeLaneStore.set({
                lanes: current.lanes.map((candidate) => {
                    if (candidate.id === 'lane-1') {
                        return { ...candidate, activeCompRegions: structuredClone(nextRegions) };
                    }
                    return candidate;
                }),
            });
        });
        storageTransaction.commit();
        markEditApplied();
        await transactionRelease;
    });
    return { applyEdit, editApplied, releaseTransaction, transaction, transactionStarted };
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
        commandBatchPreflightPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
        resetCommandBatchIdempotency();
        localStorage.removeItem('sourdaw:command-batch-idempotency:v1');
        vi.unstubAllGlobals();
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

    it('serializes a hidden guarded interval with exact target, effect, and time scope', () => {
        const baseRevision = captureProjectRevision();
        const command = migrateLegacyAppActionToVersionedCommandEnvelope({
            action: {
                type: 'setCompRegion',
                payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
            },
            normalizedProjectRevision: baseRevision,
        });
        const parsedCommand = parseVersionedCommandEnvelope(serializeVersionedCommandEnvelope(command));

        expect(parsedCommand).toMatchObject({ status: 'valid' });
        expect(command.arguments).toMatchObject({
            trackId: 'track-1',
            laneId: 'lane-1',
            takeId: 'take-b',
            startBeat: 2,
            endBeat: 4,
            expected: [{ startBeat: 2, endBeat: 4, takeId: 'take-a' }],
            replacement: [{ startBeat: 2, endBeat: 4, takeId: 'take-b' }],
        });
        expect(command.time).toEqual(
            expect.arrayContaining([
                { argument: 'startBeat', domain: 'musical', unit: 'beats', value: 2 },
                { argument: 'endBeat', domain: 'musical', unit: 'beats', value: 4 },
            ])
        );
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision,
            batchId: 'batch-serialized-comp',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Serialize guarded comp interval',
            projectId: 'project-serialized-comp',
            runId: 'run-serialized-comp',
        });
        expect(parseVersionedCommandBatchEnvelope(batch.serialized, batch.authority)).toMatchObject({
            status: 'valid',
            envelope: {
                scope: {
                    targetIds: ['track-1'],
                    targetRanges: [{ startBeat: 2, endBeat: 4 }],
                },
            },
        });
        const registration = getExecutableCommandRegistrations().find(
            (candidate) => candidate.actionType === 'setCompRegion'
        );
        expect(registration).toMatchObject({
            discoverability: 'hidden',
            mutationIdempotent: false,
            mutationIdentityRules: [{ arguments: [{ argument: 'trackId' }] }],
            providerSchema: {
                required: ['trackId', 'takeId', 'startBeat', 'endBeat'],
            },
        });
        expect(Object.keys(registration?.providerSchema.properties ?? {}).sort()).toEqual([
            'endBeat',
            'startBeat',
            'takeId',
            'trackId',
        ]);
        expect(getExecutableAppActionEffect('setCompRegion')).toEqual({
            dimensions: ['arrangement'],
            scope: 'target',
        });
        expect(getExecutableAppActionToolSchemas().some((schema) => schema.function.name === 'setCompRegion')).toBe(
            false
        );
    });

    it('refuses serialized comp commands with missing or malformed owner witnesses', () => {
        const command = migrateLegacyAppActionToVersionedCommandEnvelope({
            action: {
                type: 'setCompRegion',
                payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
            },
            normalizedProjectRevision: captureProjectRevision(),
        });
        const withoutWitness = structuredClone(command);
        const missingArguments = withoutWitness.arguments as Record<string, unknown>;
        delete missingArguments.expected;
        withoutWitness.argumentsDigest = getVersionedCommandArgumentsDigest({
            operation: withoutWitness.operation,
            arguments: missingArguments,
        });
        const malformedWitness = structuredClone(command);
        const malformedArguments = malformedWitness.arguments as Record<string, unknown>;
        malformedArguments.expected = [{ startBeat: 4, endBeat: 2, takeId: 'take-a' }];
        malformedWitness.argumentsDigest = getVersionedCommandArgumentsDigest({
            operation: malformedWitness.operation,
            arguments: malformedArguments,
        });

        expect(parseVersionedCommandEnvelope(serializeVersionedCommandEnvelope(withoutWitness))).toEqual({
            status: 'invalid',
            reason: 'Command operation is not deterministic at the serialized boundary',
        });
        expect(parseVersionedCommandEnvelope(serializeVersionedCommandEnvelope(malformedWitness))).toEqual({
            status: 'invalid',
            reason: 'Command operation is not deterministic at the serialized boundary',
        });
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
            lanes: current.lanes.map((candidate) => {
                if (candidate.id === 'lane-1') {
                    return {
                        ...candidate,
                        activeCompRegions: [
                            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
                            { startBeat: 2, endBeat: 4, takeId: 'take-c' },
                            { startBeat: 4, endBeat: 8, takeId: 'take-a' },
                        ],
                    };
                }
                return candidate;
            }),
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
                    lanes: current.lanes.map((candidate) => {
                        if (candidate.id === 'lane-1') {
                            return {
                                ...candidate,
                                activeCompRegions: [
                                    { startBeat: 0, endBeat: 2, takeId: 'take-a' },
                                    { startBeat: 2, endBeat: 4, takeId: 'take-c' },
                                    { startBeat: 4, endBeat: 8, takeId: 'take-a' },
                                ],
                            };
                        }
                        return candidate;
                    }),
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

    it('refuses a batch when the admitted interval changes while it waits for a snapshot transaction', async () => {
        const expected = [
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-c' },
            { startBeat: 4, endBeat: 8, takeId: 'take-a' },
        ];
        const held = holdSnapshotRegionEdit(expected);
        await held.transactionStarted;

        const execution = executeAppActionBatch(
            [
                {
                    type: 'setCompRegion',
                    payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
                },
            ],
            { groupId: 'held-comp-selection' }
        );
        held.applyEdit();
        await held.editApplied;
        held.releaseTransaction();
        await held.transaction;

        await expect(execution).resolves.toEqual({
            status: 'conflicted',
            reason: 'Action conflicts with current project state: setCompRegion',
            actions: [],
        });
        expect(activeRegions()).toEqual(expected);
        flushAutomergeStorageWrites();
        expect(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]?.activeCompRegions
        ).toEqual(expected);
        expect(undoStore.value).toEqual({ past: [], future: [] });
    });

    it('preserves a compatible outside edit while an admitted batch waits', async () => {
        const outsideEdit = [
            { startBeat: 0, endBeat: 5, takeId: 'take-a' },
            { startBeat: 5, endBeat: 6, takeId: 'take-c' },
            { startBeat: 6, endBeat: 8, takeId: 'take-a' },
        ];
        const held = holdSnapshotRegionEdit(outsideEdit);
        await held.transactionStarted;

        const execution = executeAppActionBatch(
            [
                {
                    type: 'setCompRegion',
                    payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
                },
            ],
            { groupId: 'compatible-outside-edit' }
        );
        held.applyEdit();
        await held.editApplied;
        held.releaseTransaction();
        await held.transaction;

        await expect(execution).resolves.toMatchObject({ status: 'committed' });
        const expected = [
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-b' },
            { startBeat: 4, endBeat: 5, takeId: 'take-a' },
            { startBeat: 5, endBeat: 6, takeId: 'take-c' },
            { startBeat: 6, endBeat: 8, takeId: 'take-a' },
        ];
        expect(activeRegions()).toEqual(expected);
        flushAutomergeStorageWrites();
        expect(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]?.activeCompRegions
        ).toEqual(expected);
        expect(undoStore.value?.past).toEqual([{ label: 'Set comp region' }]);
    });

    it('preserves an outside edit committed after the handler returns but before its storage commit', async () => {
        const outsideEdit = [
            { startBeat: 0, endBeat: 5, takeId: 'take-a' },
            { startBeat: 5, endBeat: 6, takeId: 'take-c' },
            { startBeat: 6, endBeat: 8, takeId: 'take-a' },
        ];

        const result = await executeAppActionBatch(
            [
                {
                    type: 'setCompRegion',
                    payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
                },
            ],
            {
                groupId: 'late-outside-comp-selection',
                onProjectCommitPrepared: () => {
                    mutateCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>({
                        id: 'root',
                        changeFn: (document) => {
                            const currentLane = document.takeLanes.lanes.find((candidate) => candidate.id === 'lane-1');
                            if (!currentLane) {
                                throw new Error('Expected the comp lane before the late edit');
                            }
                            currentLane.activeCompRegions = structuredClone(outsideEdit);
                        },
                    });
                    expect(
                        getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]
                            ?.activeCompRegions
                    ).toEqual(outsideEdit);
                },
            }
        );

        expect(result).toMatchObject({ status: 'committed' });
        const expected = [
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-b' },
            { startBeat: 4, endBeat: 5, takeId: 'take-a' },
            { startBeat: 5, endBeat: 6, takeId: 'take-c' },
            { startBeat: 6, endBeat: 8, takeId: 'take-a' },
        ];
        expect(activeRegions()).toEqual(expected);
        expect(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]?.activeCompRegions
        ).toEqual(expected);
        expect(undoStore.value?.past).toEqual([{ label: 'Set comp region' }]);
    });

    it('preserves a compatible outside edit in a single action commit window', async () => {
        const outsideEdit = [
            { startBeat: 0, endBeat: 5, takeId: 'take-a' },
            { startBeat: 5, endBeat: 6, takeId: 'take-c' },
            { startBeat: 6, endBeat: 8, takeId: 'take-a' },
        ];
        let scheduled = false;
        const unsubscribe = takeLaneStore.subscribe((state) => {
            if (scheduled || state?.lanes[0]?.activeCompRegions[1]?.takeId !== 'take-b') {
                return;
            }
            scheduled = true;
            queueMicrotask(() => {
                mutateCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>({
                    id: 'root',
                    changeFn: (document) => {
                        document.takeLanes.lanes[0]!.activeCompRegions = structuredClone(outsideEdit);
                    },
                });
            });
        });

        try {
            await executeAppAction({
                type: 'setCompRegion',
                payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
            });
        } finally {
            unsubscribe();
        }

        const expected = [
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-b' },
            { startBeat: 4, endBeat: 5, takeId: 'take-a' },
            { startBeat: 5, endBeat: 6, takeId: 'take-c' },
            { startBeat: 6, endBeat: 8, takeId: 'take-a' },
        ];
        expect(scheduled).toBe(true);
        expect(activeRegions()).toEqual(expected);
        expect(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]?.activeCompRegions
        ).toEqual(expected);
        expect(undoStore.value?.past).toEqual([{ label: 'Set comp region' }]);
    });

    it('translates a single-action storage refusal and exposes authoritative selection', async () => {
        const conflicting = [
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-c' },
            { startBeat: 4, endBeat: 8, takeId: 'take-a' },
        ];
        let scheduled = false;
        const unsubscribe = takeLaneStore.subscribe((state) => {
            if (scheduled || state?.lanes[0]?.activeCompRegions[1]?.takeId !== 'take-b') {
                return;
            }
            scheduled = true;
            queueMicrotask(() => {
                mutateCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>({
                    id: 'root',
                    changeFn: (document) => {
                        document.takeLanes.lanes[0]!.activeCompRegions = structuredClone(conflicting);
                    },
                });
            });
        });

        try {
            await expect(
                executeAppAction({
                    type: 'setCompRegion',
                    payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
                })
            ).rejects.toMatchObject({ name: 'AppActionConflictError' });
        } finally {
            unsubscribe();
        }

        expect(scheduled).toBe(true);
        expect(activeRegions()).toEqual(conflicting);
        expect(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]?.activeCompRegions
        ).toEqual(conflicting);
        expect(undoStore.value).toEqual({ past: [], future: [] });
        expect(() => flushAutomergeStorageWrites()).not.toThrow();
        expect(activeRegions()).toEqual(conflicting);

        mutateCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>({
            id: 'root',
            changeFn: (document) => {
                document.takeLanes.lanes[0]!.activeCompRegions = structuredClone(lane.activeCompRegions);
            },
        });
        takeLaneStore.hydrate();
        await expect(
            executeAppAction({
                type: 'setCompRegion',
                payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
            })
        ).resolves.toBeUndefined();
        const recoveredRegions = [
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-b' },
            { startBeat: 4, endBeat: 8, takeId: 'take-a' },
        ];
        expect(activeRegions()).toEqual(recoveredRegions);
        expect(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]?.activeCompRegions
        ).toEqual(recoveredRegions);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        expect(undoStore.value?.past).toEqual([{ label: 'Set comp region' }]);
    });

    it('refuses when the full requested interval changes after the handler returns', async () => {
        takeLaneStore.set({
            lanes: [
                {
                    ...structuredClone(lane),
                    activeCompRegions: [
                        { startBeat: 0, endBeat: 2, takeId: 'take-a' },
                        { startBeat: 2, endBeat: 3, takeId: 'take-b' },
                        { startBeat: 3, endBeat: 8, takeId: 'take-a' },
                    ],
                },
                structuredClone(otherLane),
            ],
        });
        flushAutomergeStorageWrites();
        const conflicting = [
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 3, takeId: 'take-c' },
            { startBeat: 3, endBeat: 8, takeId: 'take-a' },
        ];

        const result = await executeAppActionBatch(
            [
                {
                    type: 'setCompRegion',
                    payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
                },
            ],
            {
                groupId: 'late-inside-comp-selection',
                onProjectCommitPrepared: () => {
                    mutateCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>({
                        id: 'root',
                        changeFn: (document) => {
                            const currentLane = document.takeLanes.lanes.find((candidate) => candidate.id === 'lane-1');
                            if (!currentLane) {
                                throw new Error('Expected the comp lane before the late edit');
                            }
                            currentLane.activeCompRegions = structuredClone(conflicting);
                        },
                    });
                },
            }
        );

        expect(result).toMatchObject({
            status: 'conflicted',
            reason: 'Take lane write conflicts with current authoritative state',
        });
        expect(activeRegions()).toEqual(conflicting);
        expect(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]?.activeCompRegions
        ).toEqual(conflicting);
        expect(undoStore.value).toEqual({ past: [], future: [] });
        expect(() => flushAutomergeStorageWrites()).not.toThrow();
        expect(activeRegions()).toEqual(conflicting);
    });

    it('executes the direct restore interval action and refuses a stale inverse without writing history', async () => {
        await applyBToTwoThroughFour();
        const restore = {
            type: 'restoreCompRegionInterval' as const,
            payload: {
                laneId: 'lane-1',
                trackId: 'track-1',
                startBeat: 2,
                endBeat: 4,
                expected: [{ startBeat: 2, endBeat: 4, takeId: 'take-b' }],
                replacement: [{ startBeat: 2, endBeat: 4, takeId: 'take-a' }],
            },
        };

        await executeAppAction(restore);
        expect(activeRegions()).toEqual([{ startBeat: 0, endBeat: 8, takeId: 'take-a' }]);
        expect(undoStore.value?.past).toEqual([{ label: 'Set comp region' }]);

        await expect(executeAppAction(restore)).rejects.toMatchObject({ name: 'AppActionConflictError' });
        expect(activeRegions()).toEqual([{ startBeat: 0, endBeat: 8, takeId: 'take-a' }]);
        expect(undoStore.value?.past).toEqual([{ label: 'Set comp region' }]);
    });

    it('captures a listener-authored nested write as its own delta after consuming the interval intent', async () => {
        let wroteNestedRename = false;
        const unsubscribe = takeLaneStore.subscribe((state) => {
            const currentLane = state?.lanes.find((candidate) => candidate.id === 'lane-1');
            if (wroteNestedRename || currentLane?.activeCompRegions[1]?.takeId !== 'take-b') {
                return;
            }
            wroteNestedRename = true;
            takeLaneStore.set({
                lanes: state!.lanes.map((candidate) => {
                    if (candidate.id !== 'lane-2') {
                        return candidate;
                    }
                    return {
                        ...candidate,
                        takes: candidate.takes.map((take) =>
                            take.id === 'take-d' ? { ...take, name: 'D renamed by listener' } : take
                        ),
                    };
                }),
            });
        });

        try {
            await applyBToTwoThroughFour();
        } finally {
            unsubscribe();
        }

        expect(wroteNestedRename).toBe(true);
        expect(takeLaneStore.value?.lanes[1]?.takes[0]?.name).toBe('D renamed by listener');
        expect(getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[1]?.takes[0]?.name).toBe(
            'D renamed by listener'
        );
        expect(activeRegions()).toEqual([
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-b' },
            { startBeat: 4, endBeat: 8, takeId: 'take-a' },
        ]);
    });

    it('retains owner-local field intent across hydration between two writes', () => {
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            const first = takeLaneStore.value!;
            takeLaneStore.set({
                lanes: first.lanes.map((candidate) => {
                    if (candidate.id !== 'lane-1') {
                        return candidate;
                    }
                    return {
                        ...candidate,
                        takes: candidate.takes.map((take) =>
                            take.id === 'take-a' ? { ...take, name: 'A local first' } : take
                        ),
                    };
                }),
            });
            mutateCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>({
                id: 'root',
                changeFn: (document) => {
                    const remoteLane = document.takeLanes.lanes.find((candidate) => candidate.id === 'lane-2');
                    if (!remoteLane) {
                        throw new Error('Expected the unrelated lane before hydration');
                    }
                    remoteLane.takes[0]!.name = 'D authoritative';
                },
            });
            takeLaneStore.hydrate();
            expect(takeLaneStore.value?.lanes[0]?.takes[0]?.name).toBe('A local first');
            expect(takeLaneStore.value?.lanes[1]?.takes[0]?.name).toBe('D authoritative');

            const second = takeLaneStore.value!;
            takeLaneStore.set({
                lanes: second.lanes.map((candidate) => {
                    if (candidate.id !== 'lane-1') {
                        return candidate;
                    }
                    return {
                        ...candidate,
                        takes: candidate.takes.map((take) =>
                            take.id === 'take-a' ? { ...take, name: 'A local final' } : take
                        ),
                    };
                }),
            });
        });

        transaction.commit();

        expect(takeLaneStore.value?.lanes[0]?.takes[0]?.name).toBe('A local final');
        expect(takeLaneStore.value?.lanes[1]?.takes[0]?.name).toBe('D authoritative');
        expect(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes.map(
                (candidate) => candidate.takes[0]?.name
            )
        ).toEqual(['A local final', 'D authoritative']);
    });

    it('commits two disjoint comp selections as one batch', async () => {
        await expect(
            executeAppActionBatch(
                [
                    {
                        type: 'setCompRegion',
                        payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
                    },
                    {
                        type: 'setCompRegion',
                        payload: { trackId: 'track-1', startBeat: 5, endBeat: 6, takeId: 'take-c' },
                    },
                ],
                { groupId: 'disjoint-comp-selections' }
            )
        ).resolves.toMatchObject({ status: 'committed' });

        const expected = [
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-b' },
            { startBeat: 4, endBeat: 5, takeId: 'take-a' },
            { startBeat: 5, endBeat: 6, takeId: 'take-c' },
            { startBeat: 6, endBeat: 8, takeId: 'take-a' },
        ];
        expect(activeRegions()).toEqual(expected);
        flushAutomergeStorageWrites();
        expect(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]?.activeCompRegions
        ).toEqual(expected);
        expect(undoStore.value?.past).toEqual([{ label: 'Set comp region' }, { label: 'Set comp region' }]);
    });

    it('materializes overlapping forward comp siblings against their ordered prefix', async () => {
        const result = await executeAppActionBatch(
            [
                {
                    type: 'setCompRegion',
                    payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
                },
                {
                    type: 'setCompRegion',
                    payload: { trackId: 'track-1', startBeat: 3, endBeat: 5, takeId: 'take-c' },
                },
            ],
            { groupId: 'overlapping-comp-selections' }
        );

        expect(result).toMatchObject({ status: 'committed' });
        const expected = [
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 3, takeId: 'take-b' },
            { startBeat: 3, endBeat: 5, takeId: 'take-c' },
            { startBeat: 5, endBeat: 8, takeId: 'take-a' },
        ];
        expect(activeRegions()).toEqual(expected);
        flushAutomergeStorageWrites();
        expect(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]?.activeCompRegions
        ).toEqual(expected);
    });

    it('keeps an earlier overlapping sibling when the later selection is already exact', async () => {
        const result = await executeAppActionBatch(
            [
                {
                    type: 'setCompRegion',
                    payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
                },
                {
                    type: 'setCompRegion',
                    payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
                },
            ],
            { groupId: 'repeated-overlapping-comp-selection' }
        );

        expect(result).toMatchObject({
            status: 'committed',
            actions: [{ action: { type: 'setCompRegion' } }],
        });
        expect(activeRegions()).toEqual([
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-b' },
            { startBeat: 4, endBeat: 8, takeId: 'take-a' },
        ]);
        expect(undoStore.value?.past).toEqual([{ label: 'Set comp region' }]);
    });

    it('rejects a supplied comp envelope when its captured prefix is omitted', async () => {
        const firstAction = {
            type: 'setCompRegion' as const,
            payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
        };
        const secondAction = {
            type: 'setCompRegion' as const,
            payload: { trackId: 'track-1', startBeat: 3, endBeat: 5, takeId: 'take-c' },
        };
        const actions = [firstAction, secondAction];
        const supplied = migrateLegacyAppActionToVersionedCommandEnvelope({
            action: secondAction,
            expectedEffect: 'Set the second comp interval',
            materializationContext: { actions, actionIndex: 1 },
            options: { groupId: 'captured-comp-prefix' },
        });

        const result = await executeAppActionBatch([secondAction], {
            commandEnvelopes: [supplied],
            groupId: 'captured-comp-prefix',
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Command envelope does not match action setCompRegion',
            actions: [],
        });
        expect(activeRegions()).toEqual(lane.activeCompRegions);
        expect(undoStore.value).toEqual({ past: [], future: [] });
    });

    it('undoes and redoes overlapping comp actions grouped from sequential singles', async () => {
        const options = { groupId: 'sequential-overlapping-comp', groupLabel: 'Overlapping comp' };
        await executeAppAction(
            {
                type: 'setCompRegion',
                payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
            },
            options
        );
        await executeAppAction(
            {
                type: 'setCompRegion',
                payload: { trackId: 'track-1', startBeat: 3, endBeat: 5, takeId: 'take-c' },
            },
            options
        );
        const expected = [
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 3, takeId: 'take-b' },
            { startBeat: 3, endBeat: 5, takeId: 'take-c' },
            { startBeat: 5, endBeat: 8, takeId: 'take-a' },
        ];
        expect(activeRegions()).toEqual(expected);

        await undo();
        expect(activeRegions()).toEqual(lane.activeCompRegions);
        expect(undoStore.value?.past).toEqual([]);

        await redo();
        expect(activeRegions()).toEqual(expected);
        expect(undoStore.value?.past).toEqual([{ label: 'Set comp region' }, { label: 'Set comp region' }]);
    });

    it('preserves an outside edit while overlapping siblings await sequential execution', async () => {
        const outsideEdit = [
            { startBeat: 0, endBeat: 6, takeId: 'take-a' },
            { startBeat: 6, endBeat: 7, takeId: 'take-c' },
            { startBeat: 7, endBeat: 8, takeId: 'take-a' },
        ];
        let scheduled = false;
        const unsubscribe = takeLaneStore.subscribe((state) => {
            if (scheduled || state?.lanes[0]?.activeCompRegions[1]?.takeId !== 'take-b') {
                return;
            }
            scheduled = true;
            queueMicrotask(() => {
                mutateCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>({
                    id: 'root',
                    changeFn: (document) => {
                        document.takeLanes.lanes[0]!.activeCompRegions = structuredClone(outsideEdit);
                    },
                });
            });
        });

        const result = await executeAppActionBatch(
            [
                {
                    type: 'setCompRegion',
                    payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
                },
                {
                    type: 'setCompRegion',
                    payload: { trackId: 'track-1', startBeat: 3, endBeat: 5, takeId: 'take-c' },
                },
            ],
            { groupId: 'awaited-sibling-comp-selections' }
        ).finally(unsubscribe);

        expect(result).toMatchObject({ status: 'committed' });
        expect(scheduled).toBe(true);
        const expected = [
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 3, takeId: 'take-b' },
            { startBeat: 3, endBeat: 5, takeId: 'take-c' },
            { startBeat: 5, endBeat: 6, takeId: 'take-a' },
            { startBeat: 6, endBeat: 7, takeId: 'take-c' },
            { startBeat: 7, endBeat: 8, takeId: 'take-a' },
        ];
        expect(activeRegions()).toEqual(expected);
        expect(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]?.activeCompRegions
        ).toEqual(expected);
    });

    it('does not resurrect a lane when a later action in the same batch removes its track', async () => {
        setArrangementEventBus(createEventBus());
        trackStore.set({ tracks: [TrackDummy.create({ id: 'track-1' })], selectedTrackId: 'track-1', ghostClips: [] });
        flushAutomergeStorageWrites();

        const result = await executeAppActionBatch(
            [
                {
                    type: 'setCompRegion',
                    payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
                },
                { type: 'removeTrack', payload: { trackId: 'track-1' } },
            ],
            { groupId: 'comp-then-remove-track' }
        );

        expect(result).toMatchObject({ status: expect.stringMatching(/^committed/) });
        expect(trackStore.value?.tracks).toEqual([]);
        expect(takeLaneStore.value?.lanes.map((candidate) => candidate.id)).toEqual(['lane-2']);
        expect(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes.map(
                (candidate) => candidate.id
            )
        ).toEqual(['lane-2']);
    });

    it('refuses overlapping siblings atomically when their admitted interval changes', async () => {
        const insideEdit = [
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-c' },
            { startBeat: 4, endBeat: 8, takeId: 'take-a' },
        ];
        const held = holdSnapshotRegionEdit(insideEdit);
        await held.transactionStarted;

        const execution = executeAppActionBatch(
            [
                {
                    type: 'setCompRegion',
                    payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
                },
                {
                    type: 'setCompRegion',
                    payload: { trackId: 'track-1', startBeat: 3, endBeat: 5, takeId: 'take-c' },
                },
            ],
            { groupId: 'atomic-comp-refusal' }
        );
        held.applyEdit();
        await held.editApplied;
        held.releaseTransaction();
        await held.transaction;

        await expect(execution).resolves.toEqual({
            status: 'conflicted',
            reason: 'Action conflicts with current project state: setCompRegion',
            actions: [],
        });
        expect(activeRegions()).toEqual(insideEdit);
        flushAutomergeStorageWrites();
        expect(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]?.activeCompRegions
        ).toEqual(insideEdit);
        expect(undoStore.value).toEqual({ past: [], future: [] });
    });

    it('replays a populated clear and replacement in one take-lane owner', () => {
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            takeLaneStore.clear();
            takeLaneStore.set({ lanes: [structuredClone(otherLane)] });
        });

        transaction.commit();

        expect(takeLaneStore.value).toEqual({ lanes: [otherLane] });
        expect(getCrdtDoc<{ takeLanes?: { lanes: (typeof lane)[] } }>('root')?.takeLanes).toEqual({
            lanes: [otherLane],
        });
    });

    it('writes a replacement in a separate transaction after clearing the take-lane slot', () => {
        const clearTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            takeLaneStore.clear();
        });

        expect(clearTransaction.status).toBe('returned');
        clearTransaction.commit();
        expect(getCrdtDoc<{ takeLanes?: { lanes: (typeof lane)[] } }>('root')?.takeLanes).toBeUndefined();
        expect(takeLaneStore.value).toBeNull();

        const replacement = { lanes: [structuredClone(otherLane)] };
        const replacementTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            takeLaneStore.set(replacement);
        });

        expect(replacementTransaction.status).toBe('returned');
        let commitError: unknown;
        try {
            replacementTransaction.commit();
        } catch (error) {
            commitError = error;
        }

        expect(commitError).toBeUndefined();
        expect(getCrdtDoc<{ takeLanes?: { lanes: (typeof otherLane)[] } }>('root')?.takeLanes).toEqual(replacement);
        expect(takeLaneStore.value).toEqual(replacement);
    });

    it.each([
        ['a populated slot', { lanes: [structuredClone(lane)] }],
        ['a present empty slot', { lanes: [] }],
    ])('refuses a captured absent replacement when a peer creates %s', (_description, peerAuthority) => {
        const clearTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            takeLaneStore.clear();
        });

        expect(clearTransaction.status).toBe('returned');
        clearTransaction.commit();
        expect(getCrdtDoc<{ takeLanes?: { lanes: (typeof lane)[] } }>('root')?.takeLanes).toBeUndefined();
        expect(takeLaneStore.value).toBeNull();

        const replacementTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            takeLaneStore.set({ lanes: [structuredClone(otherLane)] });
        });

        expect(replacementTransaction.status).toBe('returned');
        mutateCrdtDoc<{ takeLanes?: { lanes: (typeof lane)[] } }>({
            id: 'root',
            changeFn: (document) => {
                document.takeLanes = structuredClone(peerAuthority);
            },
        });
        let commitError: unknown;
        try {
            replacementTransaction.commit();
        } catch (error) {
            commitError = error;
        } finally {
            replacementTransaction.abort();
        }

        expect(commitError).toBeInstanceOf(AutomergeStorageWriteConflictError);
        expect(getCrdtDoc<{ takeLanes?: { lanes: (typeof lane)[] } }>('root')?.takeLanes).toEqual(peerAuthority);
        expect(takeLaneStore.value).toEqual(peerAuthority);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('writes the first take lane over an absent document slot', () => {
        mutateCrdtDoc<{ takeLanes?: { lanes: (typeof lane)[] } }>({
            id: 'root',
            changeFn: (document) => {
                delete document.takeLanes;
            },
        });
        takeLaneStore.hydrate();
        expect(takeLaneStore.value).toEqual({ lanes: [] });

        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            takeLaneStore.set({ lanes: [structuredClone(otherLane)] });
        });
        transaction.commit();

        expect(getCrdtDoc<{ takeLanes?: { lanes: (typeof lane)[] } }>('root')?.takeLanes).toEqual({
            lanes: [otherLane],
        });
    });

    it('persists the next real edit after an unscoped take-lane conflict is refused', () => {
        const frames: FrameRequestCallback[] = [];
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn((callback: FrameRequestCallback) => {
                frames.push(callback);
                return frames.length;
            })
        );
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        removeCompRegion('track-1', 0);
        expect(frames).toHaveLength(1);
        mutateCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>({
            id: 'root',
            changeFn: (document) => {
                document.takeLanes.lanes[0]!.activeCompRegions = [{ startBeat: 0, endBeat: 8, takeId: 'take-b' }];
            },
        });

        frames[0]?.(0);
        const pendingAfterRefusal = countPendingAutomergeStorageWrites();
        const visibleAfterRefusal = structuredClone(activeRegions());
        addTake('track-1', 'clip-recovered', 'Recovered take', 0, 8);
        const successorFrame = frames[1];
        successorFrame?.(0);
        const rawAfterSuccessor = structuredClone(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]
        );
        const projectedAfterSuccessor = structuredClone(takeLaneStore.value?.lanes[0]);
        if (pendingAfterRefusal !== 0 || !successorFrame) {
            configureAutomergeStoragePort(null);
            flushAutomergeStorageWrites();
        }

        expect(pendingAfterRefusal).toBe(0);
        expect(visibleAfterRefusal).toEqual([{ startBeat: 0, endBeat: 8, takeId: 'take-b' }]);
        expect(successorFrame).toBeTypeOf('function');
        expect(rawAfterSuccessor?.takes).toContainEqual(expect.objectContaining({ name: 'Recovered take' }));
        expect(projectedAfterSuccessor?.takes).toContainEqual(expect.objectContaining({ name: 'Recovered take' }));
    });

    it('preserves an already-pending take when a scoped comp write is refused', () => {
        const frames: FrameRequestCallback[] = [];
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn((callback: FrameRequestCallback) => {
                frames.push(callback);
                return frames.length;
            })
        );
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        const patch = compRegionInterval.capturePatch({
            trackId: 'track-1',
            startBeat: 2,
            endBeat: 4,
            takeId: 'take-b',
        });
        expect(patch).not.toBeNull();
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            expect(compRegionInterval.applyPatch(patch!)).toBe('written');
        });
        expect(transaction.status).toBe('returned');
        addTake('track-1', 'clip-successor', 'Successor take', 0, 8);
        const successorFrame = frames[1];
        const peerRegions = [
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-c' },
            { startBeat: 4, endBeat: 8, takeId: 'take-a' },
        ];
        mutateCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>({
            id: 'root',
            changeFn: (document) => {
                document.takeLanes.lanes[0]!.activeCompRegions = structuredClone(peerRegions);
            },
        });

        let refusal: unknown;
        try {
            transaction.commit();
        } catch (error) {
            refusal = error;
        } finally {
            transaction.abort();
        }
        const pendingAfterRefusal = countPendingAutomergeStorageWrites();
        const projectedAfterRefusal = structuredClone(takeLaneStore.value?.lanes[0]);
        successorFrame?.(0);
        const rawAfterSuccessor = structuredClone(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]
        );
        const projectedAfterSuccessor = structuredClone(takeLaneStore.value?.lanes[0]);
        const pendingAfterSuccessor = countPendingAutomergeStorageWrites();
        if (pendingAfterRefusal !== 1 || pendingAfterSuccessor !== 0 || !successorFrame) {
            configureAutomergeStoragePort(null);
            flushAutomergeStorageWrites();
        }

        expect(refusal).toBeInstanceOf(AutomergeStorageWriteConflictError);
        expect(successorFrame).toBeTypeOf('function');
        expect(pendingAfterRefusal).toBe(1);
        expect(projectedAfterRefusal?.activeCompRegions).toEqual(peerRegions);
        expect(projectedAfterRefusal?.takes).toContainEqual(expect.objectContaining({ name: 'Successor take' }));
        expect(pendingAfterSuccessor).toBe(0);
        expect(rawAfterSuccessor?.activeCompRegions).toEqual(peerRegions);
        expect(rawAfterSuccessor?.takes).toContainEqual(expect.objectContaining({ name: 'Successor take' }));
        expect(projectedAfterSuccessor).toEqual(rawAfterSuccessor);
    });

    it('refuses a conflicting already-pending comp write against peer authority', () => {
        const frames: FrameRequestCallback[] = [];
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn((callback: FrameRequestCallback) => {
                frames.push(callback);
                return frames.length;
            })
        );
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        const scopedPatch = compRegionInterval.capturePatch({
            trackId: 'track-1',
            startBeat: 2,
            endBeat: 4,
            takeId: 'take-b',
        });
        expect(scopedPatch).not.toBeNull();
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            expect(compRegionInterval.applyPatch(scopedPatch!)).toBe('written');
        });
        expect(transaction.status).toBe('returned');
        const successorPatch = compRegionInterval.capturePatch({
            trackId: 'track-1',
            startBeat: 3,
            endBeat: 5,
            takeId: 'take-c',
        });
        expect(successorPatch).not.toBeNull();
        expect(compRegionInterval.applyPatch(successorPatch!)).toBe('written');
        const successorFrame = frames[1];
        const peerRegions = [
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-c' },
            { startBeat: 4, endBeat: 8, takeId: 'take-a' },
        ];
        mutateCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>({
            id: 'root',
            changeFn: (document) => {
                document.takeLanes.lanes[0]!.activeCompRegions = structuredClone(peerRegions);
            },
        });

        expect(() => transaction.commit()).toThrow(AutomergeStorageWriteConflictError);
        transaction.abort();
        const projectedAfterRefusal = structuredClone(activeRegions());
        successorFrame?.(0);
        const rawAfterSuccessor = structuredClone(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]?.activeCompRegions
        );
        const pendingAfterSuccessor = countPendingAutomergeStorageWrites();
        if (pendingAfterSuccessor !== 0 || !successorFrame) {
            configureAutomergeStoragePort(null);
            flushAutomergeStorageWrites();
        }

        expect(successorFrame).toBeTypeOf('function');
        expect(projectedAfterRefusal).toEqual(peerRegions);
        expect(pendingAfterSuccessor).toBe(0);
        expect(rawAfterSuccessor).toEqual(peerRegions);
        expect(activeRegions()).toEqual(peerRegions);
    });

    it('discards prepared recovery and permits an exact envelope retry after a commit-window conflict', async () => {
        vi.stubGlobal('navigator', {
            ...navigator,
            locks: {
                request: (_name: string, _options: LockOptions, task: () => unknown) => Promise.resolve(task()),
            },
        });
        configureCommandBatchIdempotency({ canExecute: () => true });
        const baseRevision = captureProjectRevision();
        commandProjectRevisionPort.setProvider(() => baseRevision);
        commandBatchPreflightPort.setProvider(({ targetIds }) => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-comp-recovery',
            projectInvariantsValid: true,
            targetFingerprints: Object.fromEntries(targetIds.map((targetId) => [targetId, `present:${targetId}`])),
        }));
        const command = migrateLegacyAppActionToVersionedCommandEnvelope({
            action: {
                type: 'setCompRegion',
                payload: { trackId: 'track-1', startBeat: 2, endBeat: 4, takeId: 'take-b' },
            },
            normalizedProjectRevision: baseRevision,
        });
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision,
            batchId: 'batch-comp-recovery',
            commands: [serializeVersionedCommandEnvelope(command)],
            idempotencyKey: 'comp-recovery-exact-retry',
            intent: 'Set the comp interval',
            mode: 'commit',
            projectId: 'project-comp-recovery',
            runId: 'run-comp-recovery',
        });
        const promote = vi.fn();
        const discard = vi.fn();
        const prepared = vi.fn(() => ({ promote, discard }));
        const conflicting = [
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-c' },
            { startBeat: 4, endBeat: 8, takeId: 'take-a' },
        ];

        const result = await executeVersionedCommandBatchEnvelope({
            approvalBinding: issueCommandApprovalBinding({
                authority: batch.authority,
                serialized: batch.serialized,
                validate: () => ({ status: 'valid' }),
            }),
            authority: batch.authority,
            serialized: batch.serialized,
            onProjectCommitPrepared: () => {
                mutateCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>({
                    id: 'root',
                    changeFn: (document) => {
                        document.takeLanes.lanes[0]!.activeCompRegions = structuredClone(conflicting);
                    },
                });
            },
            options: { onProjectCommitCheckpoint: prepared },
        });

        expect(result).toMatchObject({
            status: 'conflicted',
            reason: 'Take lane write conflicts with current authoritative state',
        });
        expect(activeRegions()).toEqual(conflicting);
        expect(
            getCrdtDoc<{
                commandBatchIdempotency?: { records: { state: string }[] };
                takeLanes: { lanes: (typeof lane)[] };
            }>('root')?.commandBatchIdempotency?.records ?? []
        ).toEqual([]);
        const durableReceipts = JSON.parse(
            localStorage.getItem('sourdaw:command-batch-idempotency:v1') ?? '[]'
        ) as Array<{ serializedReceipt?: string; state?: string }>;
        expect(durableReceipts).toHaveLength(1);
        expect(durableReceipts[0]?.state).toBe('complete');
        expect(JSON.parse(durableReceipts[0]?.serializedReceipt ?? '{}')).toMatchObject({
            outcome: 'verification-failed',
        });
        expect(prepared).toHaveBeenCalledOnce();
        expect(promote).not.toHaveBeenCalled();
        expect(discard).toHaveBeenCalledOnce();
        expect(undoStore.value).toEqual({ past: [], future: [] });
        expect(() => flushAutomergeStorageWrites()).not.toThrow();
        expect(activeRegions()).toEqual(conflicting);

        const exactReplay = await executeVersionedCommandBatchEnvelope({
            approvalBinding: issueCommandApprovalBinding({
                authority: batch.authority,
                serialized: batch.serialized,
                validate: () => ({ status: 'valid' }),
            }),
            authority: batch.authority,
            serialized: batch.serialized,
        });
        expect(exactReplay).toMatchObject({ status: 'idempotent-replay', actions: [] });
        expect('receipt' in result && 'receipt' in exactReplay ? exactReplay.receipt : null).toEqual(
            'receipt' in result ? result.receipt : null
        );

        mutateCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>({
            id: 'root',
            changeFn: (document) => {
                document.takeLanes.lanes[0]!.activeCompRegions = structuredClone(lane.activeCompRegions);
            },
        });
        takeLaneStore.hydrate();
        const retryBatch = compileVersionedCommandBatchEnvelope({
            baseRevision,
            batchId: 'batch-comp-recovery-retry',
            commands: [serializeVersionedCommandEnvelope(command)],
            idempotencyKey: 'comp-recovery-fresh-retry',
            intent: 'Retry the comp interval',
            mode: 'commit',
            projectId: 'project-comp-recovery',
            runId: 'run-comp-recovery-retry',
        });
        const retry = await executeVersionedCommandBatchEnvelope({
            approvalBinding: issueCommandApprovalBinding({
                authority: retryBatch.authority,
                serialized: retryBatch.serialized,
                validate: () => ({ status: 'valid' }),
            }),
            authority: retryBatch.authority,
            serialized: retryBatch.serialized,
        });

        expect(retry).toMatchObject({ status: 'committed' });
        const recoveredRegions = [
            { startBeat: 0, endBeat: 2, takeId: 'take-a' },
            { startBeat: 2, endBeat: 4, takeId: 'take-b' },
            { startBeat: 4, endBeat: 8, takeId: 'take-a' },
        ];
        expect(activeRegions()).toEqual(recoveredRegions);
        expect(
            getCrdtDoc<{ takeLanes: { lanes: (typeof lane)[] } }>('root')?.takeLanes.lanes[0]?.activeCompRegions
        ).toEqual(recoveredRegions);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        expect(undoStore.value?.past).toEqual([{ label: 'Set comp region' }]);
    });
});
