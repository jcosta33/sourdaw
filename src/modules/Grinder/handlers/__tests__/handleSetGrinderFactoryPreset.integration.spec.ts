import { change, clone, getHeads, getObjectId, load, save } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    defaultTrackState,
    sanitizeTrackSnapshot,
    trackStore,
    type TrackStoreState,
} from '#/modules/Arrangement/stores';
import { compileReorderDevicesAction } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    reconcileSessionUndoForProject,
    redo,
    registerProductionCommandHandlers,
    stampSessionUndoWitness,
    undo,
} from '#/modules/Command/useCases';
import {
    captureDurableDocumentWitness,
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDoc,
    replaceCrdtDocInLineage,
    resetCrdtProjectAuthority,
    subscribeToCrdtChanges,
} from '#/modules/CrdtDocument/useCases';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { type GrinderFactoryPresetAction } from '../../events/grinderAppActions';
import { grinderFactoryPresetRuntimePort } from '../../useCases/grinderFactoryPresetRuntimePort';
import { captureRectifierHeavyPreset } from '../../useCases/grinderParamBridge/captureRectifierHeavyPreset';
import { selectRectifierHeavyPreset } from '../../useCases/selectRectifierHeavyPreset';
import { invertGrinderFactoryPresetAction, isGrinderFactoryPresetSessionEntry } from '../grinderFactoryPresetCapture';

type Root = { tracks: TrackStoreState };
type NotificationEvents = { 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload };
const projectId = 'grinder-factory-preset';
const sessionKey = 'sourdaw-undo-session';

function rawRoot() {
    const root = getCrdtDoc<Root>('root');
    if (!root) {
        throw new Error('Expected the Grinder project root');
    }
    return root;
}

function rawDevice() {
    const device = rawRoot().tracks.tracks[0]?.devices.find(({ id }) => id === 'amp');
    if (!device) {
        throw new Error('Expected the raw Grinder device');
    }
    return device;
}

function installEqualPeerReplacement(): void {
    const device = rawDevice();
    const replacement = structuredClone(device);
    const peer = change(clone(rawRoot()), (doc) => {
        doc.tracks.tracks[0]!.devices.splice(0, 1, replacement);
    });
    replaceCrdtDocInLineage({ id: 'root', doc: peer });
    trackStore.hydrate();
    expect(rawDevice()).toEqual(replacement);
    expect(getObjectId(rawDevice())).not.toBe(getObjectId(device));
}

function addTwoNeighbors(): void {
    mutateCrdtDoc<Root>({
        id: 'root',
        changeFn: (doc) => {
            doc.tracks.tracks[0]!.devices.push(
                { id: 'first', type: 'eq', name: 'First', bypassed: false, parameterValues: {} },
                { id: 'second', type: 'eq', name: 'Second', bypassed: false, parameterValues: {} }
            );
        },
    });
    trackStore.hydrate();
}

function registerHistory(): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
    reconcileSessionUndoForProject({ projectId, captureWitness: captureDurableDocumentWitness });
}

async function reopenFromBinaryAndSession(): Promise<void> {
    flushAutomergeStorageWrites();
    stampSessionUndoWitness();
    const bytes = save(rawRoot());
    const mirror = sessionStorage.getItem(sessionKey);
    if (mirror === null) {
        throw new Error('Expected serialized Grinder history');
    }
    const transition = runProjectLoadTransaction();
    expect(await transition.prepare()).toBe(true);
    expect(transition.activate()).toBe(true);
    clearUndoHistory();
    expect(undoHistoryStore.value?.past).toHaveLength(0);
    expect(undoHistoryStore.value?.future).toHaveLength(0);
    replaceCrdtDoc({ id: 'root', doc: load<Root>(bytes) });
    trackStore.hydrate();
    sessionStorage.setItem(sessionKey, mirror);
    registerHistory();
}

function makeAction(): GrinderFactoryPresetAction {
    const captured = captureRectifierHeavyPreset('amp');
    if (!captured) {
        throw new Error('Missing capture');
    }
    return {
        type: 'setGrinderFactoryPreset',
        payload: {
            trackId: captured.trackId,
            deviceId: captured.deviceId,
            deviceIds: captured.deviceIds,
            ownerIncarnation: captured.ownerIncarnation,
            presetId: 'gr-rectifier-heavy',
            before: captured.before.parameterValues,
            after: captured.after.parameterValues,
        },
    };
}

describe('Grinder Rectifier project command', () => {
    const sync = vi.fn();
    beforeEach(async () => {
        configureAutomergeStoragePort(null);
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => {} });
        setNotificationEventBus(createEventBus<NotificationEvents>());
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        resetCrdtProjectAuthority('Grinder preset command');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        clearUndoHistory();
        sessionStorage.removeItem(sessionKey);
        registerHistory();
        trackStore.set({
            ...defaultTrackState,
            tracks: sanitizeTrackSnapshot({
                tracks: [
                    {
                        id: 'track',
                        name: 'Guitar',
                        // A dormant folder exercises project history without physical Web Audio nodes.
                        kind: 'folder',
                        devices: [
                            {
                                id: 'amp',
                                name: 'Amp',
                                type: 'grinder',
                                bypassed: false,
                                parameterValues: { master: 999, unrelated: 42 },
                                deviceState: { version: 1, data: { disclosureTier: 'lab' } },
                            },
                        ],
                    },
                ],
            }).tracks,
        });
        flushAutomergeStorageWrites();
        sync.mockClear();
        grinderFactoryPresetRuntimePort.setEffect(sync);
    });
    afterEach(() => {
        grinderFactoryPresetRuntimePort.setEffect(undefined);
        clearUndoHistory();
        clearHandlerRegistry();
        trackStore.set({ ...defaultTrackState, tracks: [] });
        flushAutomergeStorageWrites();
        removeCrdtDoc('root');
        configureAutomergeStoragePort(null);
        sessionStorage.removeItem(sessionKey);
    });

    it('writes one history entry and restores legacy presence exactly through undo and redo', async () => {
        const action = makeAction();
        const selected = structuredClone(action.payload);
        const undone = { ...selected, direction: 'undo' };
        const before = JSON.stringify(getCrdtDoc('root'));
        const snapshots: unknown[] = [];
        let rootChanges = 0;
        const unsubscribeRoot = subscribeToCrdtChanges((docId) => {
            if (docId === 'root') {
                rootChanges++;
            }
        });
        const unsubscribe = trackStore.subscribe((state) =>
            snapshots.push(structuredClone(state?.tracks[0]?.devices[0]?.parameterValues))
        );
        try {
            await executeAppAction(action);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            const after = JSON.stringify(getCrdtDoc('root'));
            expect(after).not.toBe(before);
            expect(sync.mock.calls).toStrictEqual([[selected]]);
            expect(rootChanges).toBe(1);
            expect(snapshots.length).toBeGreaterThan(0);
            const original = action.payload.before;
            const written = action.payload.after;
            expect(
                snapshots.every((snapshot) => {
                    const values = snapshot as Record<string, number>;
                    return (
                        Object.entries(written).every(([key, value]) => values[key] === value) ||
                        Object.entries(original).every(([key, value]) =>
                            value === null ? !Object.hasOwn(values, key) : values[key] === value
                        )
                    );
                })
            ).toBe(true);
            await undo();
            expect(JSON.stringify(getCrdtDoc('root'))).toBe(before);
            expect(sync.mock.calls).toStrictEqual([[selected], [undone]]);
            await redo();
            expect(JSON.stringify(getCrdtDoc('root'))).toBe(after);
            expect(sync.mock.calls).toStrictEqual([[selected], [undone], [selected]]);
        } finally {
            unsubscribe();
            unsubscribeRoot();
        }
    });

    it('refuses stale captures and a forged inverse', async () => {
        const action = makeAction();
        const inverse: GrinderFactoryPresetAction = { ...action, payload: { ...action.payload, direction: 'undo' } };
        await expect(executeAppAction(inverse)).rejects.toThrow();
        mutateCrdtDoc<{ tracks: { tracks: Array<{ devices: Array<{ parameterValues: Record<string, number> }> }> } }>({
            id: 'root',
            changeFn: (doc) => {
                doc.tracks.tracks[0]!.devices[0]!.parameterValues.master = 3;
            },
        });
        await expect(executeAppAction(action)).rejects.toThrow();
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(sync).not.toHaveBeenCalled();
    });

    it('refuses an equal peer replacement between capture and dispatch', async () => {
        const action = makeAction();
        installEqualPeerReplacement();
        const heads = getHeads(rawRoot());

        await expect(executeAppAction(action)).rejects.toThrow();

        expect(getHeads(rawRoot())).toEqual(heads);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(sync).not.toHaveBeenCalled();
    });

    it.each(['undo', 'redo'] as const)('refuses %s against an equal peer replacement', async (direction) => {
        await executeAppAction(makeAction());
        if (direction === 'redo') {
            await undo();
        }
        expect(undoHistoryStore.value?.future).toHaveLength(direction === 'redo' ? 1 : 0);
        installEqualPeerReplacement();
        const heads = getHeads(rawRoot());
        const history = structuredClone(undoHistoryStore.value);
        sync.mockClear();

        const replay = direction === 'undo' ? undo : redo;
        const result = await replay({ stepOverConflicts: false });

        expect(result).toEqual(direction === 'undo' ? { headConsumed: false } : undefined);
        expect(getHeads(rawRoot())).toEqual(heads);
        expect(undoHistoryStore.value).toEqual(history);
        expect(sync).not.toHaveBeenCalled();
    });

    it('keeps preset undo and redo across repeated removal Undo and a cold binary reopen', async () => {
        const originalId = getObjectId(rawDevice());
        const originalParameters = structuredClone(rawDevice().parameterValues);
        await executeAppAction(makeAction());
        const presetParameters = structuredClone(rawDevice().parameterValues);
        await executeAppAction({ type: 'removeDevice', payload: { deviceId: 'amp' } });
        expect(rawRoot().tracks.tracks[0]?.devices).toEqual([]);
        await reopenFromBinaryAndSession();
        expect(undoHistoryStore.value?.past).toHaveLength(2);

        expect(await undo()).toEqual({ headConsumed: true });
        const restoredId = getObjectId(rawDevice());
        expect(restoredId).not.toBe(originalId);
        expect(rawDevice().parameterValues).toEqual(presetParameters);
        await reopenFromBinaryAndSession();
        expect(getObjectId(rawDevice())).toBe(restoredId);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(rawDevice().parameterValues).toEqual(originalParameters);
        await reopenFromBinaryAndSession();
        expect(undoHistoryStore.value?.future).toHaveLength(2);

        await redo();
        expect(rawDevice().parameterValues).toEqual(presetParameters);
        await redo();
        expect(rawRoot().tracks.tracks[0]?.devices).toEqual([]);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(getObjectId(rawDevice())).not.toBe(restoredId);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(rawDevice().parameterValues).toEqual(originalParameters);
    });

    it('refuses an equal peer replacement after undoing a local removal', async () => {
        await executeAppAction(makeAction());
        await executeAppAction({ type: 'removeDevice', payload: { deviceId: 'amp' } });
        expect(await undo()).toEqual({ headConsumed: true });
        installEqualPeerReplacement();
        const heads = getHeads(rawRoot());
        const history = structuredClone(undoHistoryStore.value);
        sync.mockClear();

        await redo({ stepOverConflicts: false });
        expect(await undo({ stepOverConflicts: false })).toEqual({ headConsumed: false });

        expect(getHeads(rawRoot())).toEqual(heads);
        expect(undoHistoryStore.value).toEqual(history);
        expect(sync).not.toHaveBeenCalled();
    });

    it('does not rebind earlier preset history when Undo restores a different owner', async () => {
        await executeAppAction(makeAction());
        installEqualPeerReplacement();
        await executeAppAction({ type: 'removeDevice', payload: { deviceId: 'amp' } });
        expect(await undo()).toEqual({ headConsumed: true });
        const heads = getHeads(rawRoot());
        const history = structuredClone(undoHistoryStore.value);
        sync.mockClear();

        expect(await undo({ stepOverConflicts: false })).toEqual({ headConsumed: false });

        expect(getHeads(rawRoot())).toEqual(heads);
        expect(undoHistoryStore.value).toEqual(history);
        expect(sync).not.toHaveBeenCalled();
    });

    it('preserves earlier preset Undo when a local group restores the removed device', async () => {
        const parametersBefore = structuredClone(rawDevice().parameterValues);
        const originalId = getObjectId(rawDevice());
        await executeAppAction(makeAction());
        const groupId = 'remove-grinder-and-rename-track';
        await executeAppAction({ type: 'removeDevice', payload: { deviceId: 'amp' } }, { groupId });
        await executeAppAction({ type: 'renameTrack', payload: { trackId: 'track', name: 'Renamed' } }, { groupId });

        expect(await undo()).toEqual({ headConsumed: true });
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(undoHistoryStore.value?.future).toHaveLength(2);
        expect(getObjectId(rawDevice())).not.toBe(originalId);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(rawDevice().parameterValues).toEqual(parametersBefore);
    });

    it.each([
        { owner: 'same owner', route: 'single command' },
        { owner: 'same owner', route: 'one-action batch' },
        { owner: 'peer replacement', route: 'single command' },
    ] as const)('checks preset Undo ownership after reorder in a $route ($owner)', async ({ owner, route }) => {
        addTwoNeighbors();
        const parametersBefore = structuredClone(rawDevice().parameterValues);
        await executeAppAction(makeAction());
        if (owner === 'peer replacement') {
            installEqualPeerReplacement();
        }
        const beforeReorder = getObjectId(rawDevice());
        const action = compileReorderDevicesAction('track', 'amp', 'second');
        if (!action) {
            throw new Error('Expected the production device reorder');
        }

        if (route === 'one-action batch') {
            const result = await executeAppActionBatch([action]);
            if (result.status !== 'committed') {
                throw new Error(`Expected the reorder batch to commit, received ${result.status}`);
            }
        } else {
            await executeAppAction(action);
        }
        const afterReorder = getObjectId(rawDevice());
        expect(afterReorder).not.toBe(beforeReorder);
        expect(rawRoot().tracks.tracks[0]?.devices.map(({ id }) => id)).toEqual(['first', 'second', 'amp']);
        expect(await undo()).toEqual({ headConsumed: true });
        expect(getObjectId(rawDevice())).not.toBe(afterReorder);
        expect(rawRoot().tracks.tracks[0]?.devices.map(({ id }) => id)).toEqual(['amp', 'first', 'second']);
        const heads = getHeads(rawRoot());
        const differentHeads = expect.not.arrayContaining(heads);
        const parametersAfter = structuredClone(rawDevice().parameterValues);
        const shouldUndo = owner === 'same owner';
        sync.mockClear();

        expect(await undo({ stepOverConflicts: false })).toEqual({ headConsumed: shouldUndo });
        expect(rawDevice().parameterValues).toEqual(shouldUndo ? parametersBefore : parametersAfter);
        expect(getHeads(rawRoot())).toEqual(shouldUndo ? differentHeads : heads);
        expect(sync).toHaveBeenCalledTimes(shouldUndo ? 1 : 0);
    });

    it.each([
        { scenario: 'one reorder', targets: ['second'], replacement: false },
        { scenario: 'two same-rack reorders', targets: ['first', 'second'], replacement: false },
        { scenario: 'an equal peer replacement', targets: ['second'], replacement: true },
    ] as const)('checks preset history after grouped rack reorder with $scenario', async ({ targets, replacement }) => {
        addTwoNeighbors();
        const originalParameters = structuredClone(rawDevice().parameterValues);
        await executeAppAction(makeAction());
        if (replacement) {
            installEqualPeerReplacement();
        }
        const groupId = 'reorder-grinder-and-rename-track';
        for (const target of targets) {
            const action = compileReorderDevicesAction('track', 'amp', target);
            if (!action) {
                throw new Error('Expected the production device reorder');
            }
            await executeAppAction(action, { groupId });
        }
        await executeAppAction({ type: 'renameTrack', payload: { trackId: 'track', name: 'Renamed' } }, { groupId });
        const movedId = getObjectId(rawDevice());
        expect(rawRoot().tracks.tracks[0]?.devices.map(({ id }) => id)).toEqual(['first', 'second', 'amp']);

        expect(await undo()).toEqual({ headConsumed: true });
        expect(undoHistoryStore.value?.future).toHaveLength(targets.length + 1);
        expect(rawRoot().tracks.tracks[0]).toMatchObject({ name: 'Guitar' });
        expect(rawRoot().tracks.tracks[0]?.devices.map(({ id }) => id)).toEqual(['amp', 'first', 'second']);
        expect(getObjectId(rawDevice())).not.toBe(movedId);

        const heads = getHeads(rawRoot());
        const changedHeads = expect.not.arrayContaining(heads);
        const presetParameters = structuredClone(rawDevice().parameterValues);
        sync.mockClear();
        expect(await undo({ stepOverConflicts: false })).toEqual({ headConsumed: !replacement });
        expect(rawDevice().parameterValues).toEqual(replacement ? presetParameters : originalParameters);
        expect(getHeads(rawRoot())).toEqual(replacement ? heads : changedHeads);
        expect(sync).toHaveBeenCalledTimes(replacement ? 0 : 1);
    });

    it('keeps grouped Undo legal when another inverse changes the rack membership', async () => {
        addTwoNeighbors();
        await executeAppAction(makeAction());
        const groupId = 'reorder-grinder-and-remove-device';
        const action = compileReorderDevicesAction('track', 'amp', 'second');
        if (!action) {
            throw new Error('Expected the production device reorder');
        }
        await executeAppAction(action, { groupId });
        await executeAppAction({ type: 'removeDevice', payload: { deviceId: 'first' } }, { groupId });
        expect(rawRoot().tracks.tracks[0]?.devices.map(({ id }) => id)).toEqual(['second', 'amp']);

        expect(await undo()).toEqual({ headConsumed: true });
        expect(rawRoot().tracks.tracks[0]?.devices.map(({ id }) => id)).toEqual(['amp', 'first', 'second']);
        expect(undoHistoryStore.value?.future).toHaveLength(2);
    });

    it('does not deliver runtime effects to a same-id replacement after commit', async () => {
        const action = makeAction();
        let replaced = false;
        const unsubscribe = undoHistoryStore.subscribe((history) => {
            const entry = history?.past.at(-1);
            if (replaced || entry?.kind !== 'action' || entry.action.type !== 'setGrinderFactoryPreset') {
                return;
            }
            replaced = true;
            const root = getCrdtDoc<{ tracks: { tracks: Array<{ devices: Array<Record<string, unknown>> }> } }>('root');
            const replacement = structuredClone(root!.tracks.tracks[0]!.devices[0]!);
            mutateCrdtDoc<{ tracks: { tracks: Array<{ devices: Array<Record<string, unknown>> }> } }>({
                id: 'root',
                changeFn: (doc) => {
                    const devices = doc.tracks.tracks[0]!.devices;
                    devices.splice(0, 1, replacement);
                },
            });
        });
        try {
            await executeAppAction(action);
        } finally {
            unsubscribe();
        }
        expect(replaced).toBe(true);
        expect(sync).not.toHaveBeenCalled();
    });

    it('validates the exact forward, inverse and redo session pair', () => {
        const action = makeAction();
        const inverseAction = invertGrinderFactoryPresetAction(action);
        const entry = { action, inverseAction, redoAction: action };
        expect(isGrinderFactoryPresetSessionEntry(entry)).toBe(true);
        expect(
            isGrinderFactoryPresetSessionEntry({
                ...entry,
                inverseAction: {
                    ...inverseAction,
                    payload: { ...inverseAction.payload, before: { ...inverseAction.payload.before, master: 998 } },
                },
            })
        ).toBe(false);
        expect(
            isGrinderFactoryPresetSessionEntry({
                ...entry,
                redoAction: { ...action, payload: { ...action.payload, deviceId: 'other' } },
            })
        ).toBe(false);
    });

    it('treats the already-applied image as a no-op', async () => {
        const first = makeAction();
        await executeAppAction(first);
        clearUndoHistory();
        sync.mockClear();
        const equal = makeAction();
        await executeAppAction(equal);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(sync).not.toHaveBeenCalled();
        await selectRectifierHeavyPreset('amp');
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        expect(sync).toHaveBeenCalledOnce();
    });
});
