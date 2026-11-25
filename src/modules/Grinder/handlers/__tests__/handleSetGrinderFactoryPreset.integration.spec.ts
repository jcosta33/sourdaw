import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    registerProductionCommandHandlers,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    subscribeToCrdtChanges,
} from '#/modules/CrdtDocument/useCases';

import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';

import { type GrinderFactoryPresetAction } from '../../events/grinderAppActions';
import { grinderFactoryPresetRuntimePort } from '../../useCases/grinderFactoryPresetRuntimePort';
import { selectRectifierHeavyPreset } from '../../useCases/selectRectifierHeavyPreset';
import { captureRectifierHeavyPreset } from '../../useCases/grinderParamBridge/captureRectifierHeavyPreset';
import { invertGrinderFactoryPresetAction, isGrinderFactoryPresetSessionEntry } from '../grinderFactoryPresetCapture';

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
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        resetCrdtProjectAuthority('Grinder preset command');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        clearHandlerRegistry();
        clearUndoHistory();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        trackStore.set({
            ...defaultTrackState,
            tracks: sanitizeTrackSnapshot({
                tracks: [
                    {
                        id: 'track',
                        name: 'Guitar',
                        kind: 'audio',
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
    });

    it('writes one history entry and restores legacy presence exactly through undo and redo', async () => {
        const action = makeAction();
        const before = JSON.stringify(getCrdtDoc('root'));
        const snapshots: unknown[] = [];
        let rootChanges = 0;
        const unsubscribeRoot = subscribeToCrdtChanges((docId) => {
            if (docId === 'root') rootChanges++;
        });
        const unsubscribe = trackStore.subscribe((state) =>
            snapshots.push(structuredClone(state?.tracks[0]?.devices[0]?.parameterValues))
        );
        try {
            await executeAppAction(action);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            const after = JSON.stringify(getCrdtDoc('root'));
            expect(after).not.toBe(before);
            expect(sync).toHaveBeenCalledOnce();
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
            expect(sync).toHaveBeenCalledTimes(2);
            await redo();
            expect(JSON.stringify(getCrdtDoc('root'))).toBe(after);
            expect(sync).toHaveBeenCalledTimes(3);
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
