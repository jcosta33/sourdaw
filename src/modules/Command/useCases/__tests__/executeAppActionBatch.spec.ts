import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Logger } from '#/infra/logger/types';
import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { executeAppActionBatch } from '../executeAppActionBatch';
import { productionBriefAdmissionPort } from '../productionBriefAdmissionPort';

type SetEditingToolAction = Extract<AppAction, { type: 'setEditingTool' }>;
type SetSnapValueAction = Extract<AppAction, { type: 'setSnapValue' }>;
type SetPlaybackAction = Extract<AppAction, { type: 'setPlayback' }>;
type StopPlaybackAction = Extract<AppAction, { type: 'stopPlayback' }>;
type RestoreDeviceAction = Extract<AppAction, { type: 'restoreDevice' }>;
type RestoreTrackAction = Extract<AppAction, { type: 'restoreTrack' }>;

const mocks = vi.hoisted(() => ({
    agentProjectRepairStateStore: { value: null as null | { status: 'repair-required' } },
    logger: {
        error: vi.fn<Logger['error']>(),
        info: vi.fn<Logger['info']>(),
        warn: vi.fn<Logger['warn']>(),
        debug: vi.fn<Logger['debug']>(),
        setWriters: vi.fn<Logger['setWriters']>(),
    } satisfies Logger,
    setSemanticContext: vi.fn(),
    clearSemanticContext: vi.fn(),
    recordActionHistoryMetadata: vi.fn(() => []),
    commitUndoEntry: vi.fn(),
    recordAction: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mocks.logger }));
vi.mock('#/modules/CrdtDocument/stores', () => ({
    agentProjectRepairStateStore: mocks.agentProjectRepairStateStore,
    setSemanticContext: mocks.setSemanticContext,
    clearSemanticContext: mocks.clearSemanticContext,
}));
vi.mock('../actionHistoryMetadataPort', () => ({
    actionHistoryMetadataPort: {
        record: mocks.recordActionHistoryMetadata,
    },
}));
vi.mock('../commitUndoEntry', () => ({ commitUndoEntry: mocks.commitUndoEntry }));
vi.mock('../macro/recording/recordAction', () => ({ recordAction: mocks.recordAction }));

function createHandler<Action extends AppAction>(input: {
    batchExecution?: ActionHandler<Action>['batchExecution'];
    execute: ActionHandler<Action>['execute'];
    describe?: ActionHandler<Action>['describe'];
    executionKind?: ActionHandler<Action>['executionKind'];
    isNoop?: ActionHandler<Action>['isNoop'];
    validate?: ActionHandler<Action>['validate'];
    requiresAbortCompensation?: boolean;
    undoable?: boolean;
}): ActionHandler<Action> {
    return {
        batchExecution: input.batchExecution,
        execute: input.execute,
        describe: input.describe ?? ((action) => ({ label: 'Batch action', inverseAction: action })),
        executionKind: input.executionKind,
        isNoop: input.isNoop,
        validate: input.validate ?? (() => true),
        requiresAbortCompensation: input.requiresAbortCompensation,
        undoable: input.undoable ?? true,
    };
}

function createRestoreTrackAction(trackId: string, trackIndex: number): RestoreTrackAction {
    return {
        type: 'restoreTrack',
        payload: {
            trackId,
            trackSnapshot: { id: trackId },
            trackName: trackId,
            trackKind: 'audio',
            trackGain: 1,
            trackParentId: null,
            trackIndex,
            wasSelected: false,
            routingPatches: [],
            automationLaneSnapshots: [],
            midiNotesByClipId: {},
            midiCcByClipId: {},
            midiPitchBendByClipId: {},
            takeLaneSnapshots: [],
            sidechainRouteSnapshots: [],
            ownedModulatorSnapshots: [],
            incomingModulationMappingSnapshots: [],
        },
    };
}

function createRestoreDeviceAction(
    trackId: string,
    deviceId: string,
    deviceIndex: number,
    expectedDeviceIds: readonly string[]
): RestoreDeviceAction {
    return {
        type: 'restoreDevice',
        payload: {
            trackId,
            deviceSnapshot: {
                id: deviceId,
                name: deviceId,
                type: 'builtin-delay',
                bypassed: false,
                parameterValues: {},
            },
            deviceIndex,
            expectedDeviceIds,
        },
    };
}

describe('executeAppActionBatch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        mocks.agentProjectRepairStateStore.value = null;
        productionBriefAdmissionPort.setGuard(() => true);
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        productionBriefAdmissionPort.setGuard(() => true);
    });

    it('commits every action as one project document mutation', async () => {
        const document: Record<string, unknown> = {
            editingTool: { tool: 'select' },
            snapValue: { value: 1 },
        };
        const mutations: Array<Record<string, unknown>> = [];
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                changeFn(document);
                mutations.push(structuredClone(document));
            },
        });
        const editingToolStorage = createAutomergeStorage<{ tool: string }>('root', 'editingTool');
        const snapValueStorage = createAutomergeStorage<{ value: number }>('root', 'snapValue');
        expect(editingToolStorage.hydrate?.()).toBe(true);
        expect(snapValueStorage.hydrate?.()).toBe(true);
        const editingAction: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const snapAction: SetSnapValueAction = { type: 'setSnapValue', payload: { value: 0.5 } };
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: () => editingToolStorage.set({ tool: 'marquee' }),
            }),
            setSnapValue: createHandler<SetSnapValueAction>({
                execute: () => snapValueStorage.set({ value: 0.5 }),
            }),
        });

        const result = await executeAppActionBatch([editingAction, snapAction], {
            groupId: 'batch-1',
            groupLabel: 'Change editing controls',
            source: 'prompt',
        });

        expect(result.status).toBe('committed');
        expect(mutations).toEqual([
            {
                editingTool: { tool: 'marquee' },
                snapValue: { value: 0.5 },
            },
        ]);
        expect(mocks.commitUndoEntry).toHaveBeenCalledTimes(2);
    });

    it('validates the whole batch before the first handler effect', async () => {
        const firstEffect = vi.fn();
        const secondEffect = vi.fn();
        const editingAction: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const snapAction: SetSnapValueAction = { type: 'setSnapValue', payload: { value: 0.5 } };
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: firstEffect,
                validate: () => true,
            }),
            setSnapValue: createHandler<SetSnapValueAction>({
                execute: secondEffect,
                validate: () => false,
            }),
        });

        const result = await executeAppActionBatch([editingAction, snapAction]);

        expect(result).toEqual({
            status: 'conflicted',
            reason: 'Action conflicts with current project state: setSnapValue',
            actions: [],
        });
        expect(firstEffect).not.toHaveBeenCalled();
        expect(secondEffect).not.toHaveBeenCalled();
    });

    it('blocks project batches before the first handler effect while project repair is required', async () => {
        const effect = vi.fn();
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({ execute: effect }),
        });
        mocks.agentProjectRepairStateStore.value = { status: 'repair-required' };

        const result = await executeAppActionBatch([action]);

        expect(result).toEqual({
            status: 'conflicted',
            reason: 'Project repair is required before project actions can execute',
            actions: [],
        });
        expect(effect).not.toHaveBeenCalled();
    });

    it('aborts a project batch when repair becomes required before commit', async () => {
        let releaseHandler: (() => void) | undefined;
        let markHandlerStarted: (() => void) | undefined;
        const handlerStarted = new Promise<void>((resolve) => {
            markHandlerStarted = resolve;
        });
        const handlerRelease = new Promise<void>((resolve) => {
            releaseHandler = resolve;
        });
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: async () => {
                    markHandlerStarted?.();
                    await handlerRelease;
                    return { status: 'written' };
                },
            }),
        });

        const execution = executeAppActionBatch([action]);
        await handlerStarted;
        mocks.agentProjectRepairStateStore.value = { status: 'repair-required' };
        releaseHandler?.();

        await expect(execution).resolves.toEqual({
            status: 'conflicted',
            reason: 'Project repair is required before project actions can execute',
            actions: [],
            failureKind: 'verification',
        });
    });

    it('records original identities and indices on sibling restore inverses from one atomic batch', async () => {
        const firstAction: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const secondAction: SetSnapValueAction = { type: 'setSnapValue', payload: { value: 0.5 } };
        const firstRestore = createRestoreTrackAction('track-a', 0);
        const secondRestore = createRestoreTrackAction('track-b', 1);
        const batchRestoreTracks = [
            { trackId: 'track-a', trackIndex: 0 },
            { trackId: 'track-b', trackIndex: 1 },
        ];
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: () => ({ status: 'written' }),
                describe: () => ({ label: 'First', inverseAction: firstRestore }),
            }),
            setSnapValue: createHandler<SetSnapValueAction>({
                execute: () => ({ status: 'written' }),
                describe: () => ({ label: 'Second', inverseAction: secondRestore }),
            }),
        });

        await executeAppActionBatch([firstAction, secondAction], { groupId: 'batch-restore' });

        expect(mocks.commitUndoEntry).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                inverseAction: {
                    ...firstRestore,
                    payload: { ...firstRestore.payload, batchRestoreTracks },
                },
            })
        );
        expect(mocks.commitUndoEntry).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                inverseAction: {
                    ...secondRestore,
                    payload: { ...secondRestore.payload, batchRestoreTracks },
                },
            })
        );
    });

    it('keeps restore inverses independent when a multi-action batch has no history group', async () => {
        const firstAction: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const secondAction: SetSnapValueAction = { type: 'setSnapValue', payload: { value: 0.5 } };
        const firstRestore = createRestoreTrackAction('track-a', 0);
        const secondRestore = createRestoreTrackAction('track-b', 1);
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: () => ({ status: 'written' }),
                describe: () => ({ label: 'First', inverseAction: firstRestore }),
            }),
            setSnapValue: createHandler<SetSnapValueAction>({
                execute: () => ({ status: 'written' }),
                describe: () => ({ label: 'Second', inverseAction: secondRestore }),
            }),
        });

        await executeAppActionBatch([firstAction, secondAction]);

        expect(mocks.commitUndoEntry).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ inverseAction: firstRestore })
        );
        expect(mocks.commitUndoEntry).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ inverseAction: secondRestore })
        );
        expect(mocks.commitUndoEntry.mock.calls[0]?.[0]).not.toHaveProperty('groupId');
        expect(mocks.commitUndoEntry.mock.calls[1]?.[0]).not.toHaveProperty('groupId');
    });

    it('records original identities and indices on sibling device restores from one atomic batch', async () => {
        const firstAction: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const secondAction: SetSnapValueAction = { type: 'setSnapValue', payload: { value: 0.5 } };
        const firstRestore = createRestoreDeviceAction('track-a', 'delay-a', 1, ['eq-a', 'reverb-a']);
        const secondRestore = createRestoreDeviceAction('track-a', 'reverb-a', 2, ['eq-a', 'delay-a']);
        const batchRestoreDevices = [
            { trackId: 'track-a', deviceId: 'delay-a', deviceIndex: 1 },
            { trackId: 'track-a', deviceId: 'reverb-a', deviceIndex: 2 },
        ];
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: () => ({ status: 'written' }),
                describe: () => ({ label: 'First', inverseAction: firstRestore }),
            }),
            setSnapValue: createHandler<SetSnapValueAction>({
                execute: () => ({ status: 'written' }),
                describe: () => ({ label: 'Second', inverseAction: secondRestore }),
            }),
        });

        await executeAppActionBatch([firstAction, secondAction], { groupId: 'batch-device-restore' });

        expect(mocks.commitUndoEntry).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                inverseAction: {
                    ...firstRestore,
                    payload: { ...firstRestore.payload, batchRestoreDevices },
                },
            })
        );
        expect(mocks.commitUndoEntry).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                inverseAction: {
                    ...secondRestore,
                    payload: { ...secondRestore.payload, batchRestoreDevices },
                },
            })
        );
    });

    it('retains a handler-provided guarded redo action in the committed undo entry', async () => {
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const redoAction: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: () => ({ status: 'written' }),
                describe: () => ({
                    label: 'Set editing tool',
                    inverseAction: { type: 'setEditingTool', payload: { tool: 'select' } },
                    redoAction,
                }),
            }),
        });

        const result = await executeAppActionBatch([action]);

        expect(result.status).toBe('committed');
        expect(mocks.commitUndoEntry).toHaveBeenCalledWith(expect.objectContaining({ action, redoAction }));
    });

    it('rejects a singleton-only action mixed with another action before dispatch and runs it alone', async () => {
        const singletonExecute = vi.fn();
        const companionExecute = vi.fn();
        const singletonAction: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                batchExecution: 'singleton',
                execute: singletonExecute,
            }),
            setSnapValue: createHandler<SetSnapValueAction>({ execute: companionExecute }),
        });

        await expect(
            executeAppActionBatch([singletonAction, { type: 'setSnapValue', payload: { value: 0.5 } }])
        ).resolves.toEqual({
            status: 'rejected',
            reason: 'Action must execute as a singleton batch: setEditingTool',
            actions: [],
        });
        expect(singletonExecute).not.toHaveBeenCalled();
        expect(companionExecute).not.toHaveBeenCalled();

        await expect(executeAppActionBatch([singletonAction])).resolves.toMatchObject({ status: 'committed' });
        expect(singletonExecute).toHaveBeenCalledOnce();
    });

    it('runs deferred external effects after the project transaction commits', async () => {
        const afterCommit = vi.fn();
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: () => ({ status: 'written', afterCommit, afterAmbiguousCommit: afterCommit }),
            }),
        });

        const result = await executeAppActionBatch([{ type: 'setEditingTool', payload: { tool: 'marquee' } }]);

        expect(result.status).toBe('committed');
        expect(afterCommit).toHaveBeenCalledOnce();
    });

    it('recovers a deferred-effect failure by reconciling durable truth', async () => {
        const afterCommit = vi.fn().mockRejectedValue(new Error('event unavailable'));
        const reconcileRuntime = vi.fn();
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: () => ({ status: 'written', afterCommit, afterAmbiguousCommit: reconcileRuntime }),
            }),
        });

        const result = await executeAppActionBatch([{ type: 'setEditingTool', payload: { tool: 'marquee' } }]);

        expect(result.status).toBe('committed');
        expect(afterCommit).toHaveBeenCalledOnce();
        expect(reconcileRuntime).toHaveBeenCalledOnce();
        expect(mocks.commitUndoEntry).toHaveBeenCalledOnce();
    });

    it('reports both deferred-effect and reconciliation failures as committed truth', async () => {
        const afterCommit = vi.fn().mockRejectedValue(new Error('event unavailable'));
        const reconcileRuntime = vi.fn().mockRejectedValue(new Error('runtime unavailable'));
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: () => ({ status: 'written', afterCommit, afterAmbiguousCommit: reconcileRuntime }),
            }),
        });

        const result = await executeAppActionBatch([{ type: 'setEditingTool', payload: { tool: 'marquee' } }]);

        expect(result).toMatchObject({
            status: 'committed-with-warning',
            actions: [
                {
                    action: { type: 'setEditingTool', payload: { tool: 'marquee' } },
                    label: 'Batch action',
                },
            ],
            warning:
                'setEditingTool post-commit effect failed: event unavailable; runtime reconciliation failed: runtime unavailable',
        });
        expect(afterCommit).toHaveBeenCalledOnce();
        expect(reconcileRuntime).toHaveBeenCalledOnce();
        expect(mocks.commitUndoEntry).toHaveBeenCalledOnce();
    });

    it('aborts every pending write when a later action fails', async () => {
        const failure = new Error('second action failed');
        const document: Record<string, unknown> = {
            editingTool: { tool: 'select' },
            snapValue: { value: 1 },
        };
        const mutations: Array<Record<string, unknown>> = [];
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                changeFn(document);
                mutations.push(structuredClone(document));
            },
        });
        const editingToolStorage = createAutomergeStorage<{ tool: string }>('root', 'editingTool');
        const snapValueStorage = createAutomergeStorage<{ value: number }>('root', 'snapValue');
        const runtimeEffects = { editingTool: 'select', snapValue: 1 };
        const afterCommit = vi.fn();
        expect(editingToolStorage.hydrate?.()).toBe(true);
        expect(snapValueStorage.hydrate?.()).toBe(true);
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: (action) => {
                    runtimeEffects.editingTool = action.payload.tool;
                    editingToolStorage.set({ tool: action.payload.tool });
                    return { status: 'written', afterCommit, afterAmbiguousCommit: afterCommit };
                },
                describe: () => ({
                    label: 'Set editing tool',
                    inverseAction: { type: 'setEditingTool', payload: { tool: 'select' } },
                }),
            }),
            setSnapValue: createHandler<SetSnapValueAction>({
                execute: (action) => {
                    runtimeEffects.snapValue = action.payload.value;
                    snapValueStorage.set({ value: action.payload.value });
                    if (action.payload.value === 0.5) {
                        throw failure;
                    }
                },
                describe: () => ({
                    label: 'Set snap value',
                    inverseAction: { type: 'setSnapValue', payload: { value: 1 } },
                }),
            }),
        });

        const result = await executeAppActionBatch(
            [
                { type: 'setEditingTool', payload: { tool: 'marquee' } },
                { type: 'setSnapValue', payload: { value: 0.5 } },
            ],
            { source: 'prompt' }
        );
        flushAutomergeStorageWrites();

        expect(result).toEqual({ status: 'failed', reason: 'second action failed', actions: [] });
        expect(document).toEqual({
            editingTool: { tool: 'select' },
            snapValue: { value: 1 },
        });
        expect(mutations).toEqual([]);
        expect(runtimeEffects).toEqual({ editingTool: 'select', snapValue: 1 });
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
        expect(afterCommit).not.toHaveBeenCalled();
    });

    it('does not compensate a deferred-only action after storage abort restores its write', async () => {
        const failure = new Error('second action failed');
        const document: Record<string, unknown> = {
            editingTool: { tool: 'select' },
            snapValue: { value: 1 },
        };
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => changeFn(document),
        });
        const editingToolStorage = createAutomergeStorage<{ tool: string }>('root', 'editingTool');
        const afterCommit = vi.fn();
        const executeEditingTool = vi.fn((action: SetEditingToolAction) => {
            editingToolStorage.set({ tool: action.payload.tool });
            return {
                status: 'written' as const,
                afterCommit,
                afterAmbiguousCommit: afterCommit,
            };
        });
        expect(editingToolStorage.hydrate?.()).toBe(true);
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: executeEditingTool,
                requiresAbortCompensation: false,
                describe: () => ({
                    label: 'Set editing tool',
                    inverseAction: { type: 'setEditingTool', payload: { tool: 'select' } },
                }),
            }),
            setSnapValue: createHandler<SetSnapValueAction>({
                execute: (action) => {
                    if (action.payload.value === 0.5) {
                        throw failure;
                    }
                },
                describe: () => ({
                    label: 'Set snap value',
                    inverseAction: { type: 'setSnapValue', payload: { value: 1 } },
                }),
            }),
        });

        const result = await executeAppActionBatch([
            { type: 'setEditingTool', payload: { tool: 'marquee' } },
            { type: 'setSnapValue', payload: { value: 0.5 } },
        ]);

        expect(result).toEqual({ status: 'failed', reason: 'second action failed', actions: [] });
        expect(editingToolStorage.get()).toEqual({ tool: 'select' });
        expect(executeEditingTool).toHaveBeenCalledOnce();
        expect(afterCommit).not.toHaveBeenCalled();
    });

    it('does not compensate a deferred-only action that rejects as stale', async () => {
        const execute = vi.fn(() => ({ status: 'conflict' as const }));
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute,
                requiresAbortCompensation: false,
                describe: () => ({
                    label: 'Set editing tool',
                    inverseAction: { type: 'setEditingTool', payload: { tool: 'select' } },
                }),
            }),
        });

        const result = await executeAppActionBatch([{ type: 'setEditingTool', payload: { tool: 'marquee' } }]);

        expect(result).toEqual({
            status: 'conflicted',
            reason: 'Action conflicts with current project state: setEditingTool',
            actions: [],
        });
        expect(execute).toHaveBeenCalledOnce();
    });

    it('reports compensation failure when an inverse action produces no write', async () => {
        const runtimeEffects = { editingTool: 'select' };
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: (action) => {
                    if (action.payload.tool === 'select') {
                        return { status: 'no-write' };
                    }
                    runtimeEffects.editingTool = action.payload.tool;
                    return undefined;
                },
                describe: () => ({
                    label: 'Set editing tool',
                    inverseAction: { type: 'setEditingTool', payload: { tool: 'select' } },
                }),
            }),
            setSnapValue: createHandler<SetSnapValueAction>({
                execute: (action) => {
                    if (action.payload.value === 0.5) {
                        throw new Error('second action failed');
                    }
                },
                describe: () => ({
                    label: 'Set snap value',
                    inverseAction: { type: 'setSnapValue', payload: { value: 1 } },
                }),
            }),
        });

        const result = await executeAppActionBatch([
            { type: 'setEditingTool', payload: { tool: 'marquee' } },
            { type: 'setSnapValue', payload: { value: 0.5 } },
        ]);

        expect(result).toEqual({
            status: 'failed',
            reason: 'second action failed; runtime compensation failed: Runtime compensation did not apply for setEditingTool',
            actions: [],
        });
        expect(runtimeEffects.editingTool).toBe('marquee');
    });

    it('reports failed rather than conflicted when stale-state compensation does not restore runtime', async () => {
        const runtimeEffects = { editingTool: 'select' };
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: (action) => {
                    if (action.payload.tool === 'select') {
                        return { status: 'no-write' };
                    }
                    runtimeEffects.editingTool = action.payload.tool;
                    return undefined;
                },
                describe: () => ({
                    label: 'Set editing tool',
                    inverseAction: { type: 'setEditingTool', payload: { tool: 'select' } },
                }),
            }),
            setSnapValue: createHandler<SetSnapValueAction>({
                execute: () => ({ status: 'conflict' }),
                describe: () => ({
                    label: 'Set snap value',
                    inverseAction: { type: 'setSnapValue', payload: { value: 1 } },
                }),
            }),
        });

        const result = await executeAppActionBatch([
            { type: 'setEditingTool', payload: { tool: 'marquee' } },
            { type: 'setSnapValue', payload: { value: 0.5 } },
        ]);

        expect(result).toEqual({
            status: 'failed',
            reason: 'Action conflicts with current project state: setSnapValue; runtime compensation failed: Runtime compensation did not apply for setEditingTool',
            actions: [],
        });
        expect(runtimeEffects.editingTool).toBe('marquee');
    });

    it('reports an ambiguous terminal without history when one document commits before another fails', async () => {
        const documents: Record<string, Record<string, unknown>> = {
            first: { editingTool: { tool: 'select' } },
            second: { snapValue: { value: 1 } },
        };
        configureAutomergeStoragePort({
            getDoc: (docId) => documents[docId],
            getSemanticMessage: () => undefined,
            hasDoc: (docId) => docId in documents,
            mutateDoc: ({ docId, changeFn }) => {
                if (docId === 'second') {
                    throw new Error('second document failed');
                }
                const document = documents[docId];
                if (document) {
                    changeFn(document);
                }
            },
        });
        const editingToolStorage = createAutomergeStorage<{ tool: string }>('first', 'editingTool');
        const snapValueStorage = createAutomergeStorage<{ value: number }>('second', 'snapValue');
        const reconciledRuntime: Array<{ editingTool: unknown; snapValue: unknown }> = [];
        const reconcileRuntime = vi.fn(() => {
            reconciledRuntime.push({
                editingTool: documents.first?.editingTool,
                snapValue: documents.second?.snapValue,
            });
        });
        expect(editingToolStorage.hydrate?.()).toBe(true);
        expect(snapValueStorage.hydrate?.()).toBe(true);
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: () => {
                    editingToolStorage.set({ tool: 'marquee' });
                    return {
                        status: 'written',
                        afterCommit: () => undefined,
                        afterAmbiguousCommit: reconcileRuntime,
                    };
                },
            }),
            setSnapValue: createHandler<SetSnapValueAction>({
                execute: () => {
                    snapValueStorage.set({ value: 0.5 });
                    return {
                        status: 'written',
                        afterCommit: () => undefined,
                        afterAmbiguousCommit: reconcileRuntime,
                    };
                },
            }),
        });
        const actions = [
            { type: 'setEditingTool' as const, payload: { tool: 'marquee' as const } },
            { type: 'setSnapValue' as const, payload: { value: 0.5 } },
        ];
        const onCommitted = vi.fn();

        const result = await executeAppActionBatch(actions, { onCommitted });

        expect(result).toEqual({
            status: 'ambiguous',
            reason: 'Automerge storage transaction committed before a later document failed',
            actions: [],
        });
        expect(documents.first).toEqual({ editingTool: { tool: 'marquee' } });
        expect(documents.second).toEqual({ snapValue: { value: 1 } });
        expect(reconcileRuntime).toHaveBeenCalledTimes(2);
        expect(reconciledRuntime).toEqual([
            { editingTool: { tool: 'marquee' }, snapValue: { value: 1 } },
            { editingTool: { tool: 'marquee' }, snapValue: { value: 1 } },
        ]);
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
        expect(onCommitted).not.toHaveBeenCalled();
    });

    it('treats a first-document failure after mutation as ambiguous and reconciles runtime from durable truth', async () => {
        const document: Record<string, unknown> = { editingTool: { tool: 'select' } };
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                changeFn(document);
                throw new Error('adapter failed after mutation');
            },
        });
        const editingToolStorage = createAutomergeStorage<{ tool: string }>('root', 'editingTool');
        const runtimeEffect = { tool: 'select' };
        const reconcileRuntime = vi.fn(() => {
            runtimeEffect.tool = (document.editingTool as { tool: string }).tool;
        });
        expect(editingToolStorage.hydrate?.()).toBe(true);
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: (action) => {
                    runtimeEffect.tool = action.payload.tool;
                    editingToolStorage.set({ tool: action.payload.tool });
                    return {
                        status: 'written',
                        afterCommit: () => undefined,
                        afterAmbiguousCommit: reconcileRuntime,
                    };
                },
                describe: () => ({
                    label: 'Set editing tool',
                    inverseAction: { type: 'setEditingTool', payload: { tool: 'select' } },
                }),
            }),
        });

        const result = await executeAppActionBatch([{ type: 'setEditingTool', payload: { tool: 'marquee' } }]);

        expect(result).toEqual({
            status: 'ambiguous',
            reason: 'Automerge storage transaction committed before a later document failed',
            actions: [],
        });
        expect(document).toEqual({ editingTool: { tool: 'marquee' } });
        expect(runtimeEffect.tool).toBe('marquee');
        expect(reconcileRuntime).toHaveBeenCalledOnce();
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
    });

    it('rejects a non-compensable action before dispatch', async () => {
        const execute = vi.fn();
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute,
                describe: () => ({ label: 'Set editing tool', inverseAction: null }),
            }),
        });

        const result = await executeAppActionBatch([{ type: 'setEditingTool', payload: { tool: 'marquee' } }], {
            requireCompensation: true,
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Action is not compensable inside an atomic batch: setEditingTool',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('rejects an unguarded inverse before an atomic batch can dispatch', async () => {
        const execute = vi.fn();
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute,
                describe: () => ({
                    label: 'Set editing tool',
                    inverseAction: { type: 'setEditingTool', payload: { tool: 'select' } },
                }),
                validate: () => true,
            }),
        });

        const result = await executeAppActionBatch([{ type: 'setEditingTool', payload: { tool: 'marquee' } }], {
            requireCompensation: true,
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Action compensation is not guarded inside an atomic batch: setEditingTool',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('accepts a canonical no-op without requiring an inverse inside an atomic batch', async () => {
        const execute = vi.fn();
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute,
                describe: () => ({ label: 'Set editing tool', inverseAction: null }),
                isNoop: () => true,
            }),
        });

        const result = await executeAppActionBatch([{ type: 'setEditingTool', payload: { tool: 'marquee' } }], {
            requireCompensation: true,
        });

        expect(result).toEqual({ status: 'no-op', actions: [] });
        expect(execute).not.toHaveBeenCalled();
    });

    it('executes a singleton runtime handler outside project history even when atomic compensation is requested', async () => {
        let authorized = true;
        const shouldExecute = vi.fn(() => authorized);
        const execute = vi.fn(() => {
            authorized = false;
            return { status: 'written' as const };
        });
        registerHandlerMap({
            setPlayback: createHandler<SetPlaybackAction>({
                execute,
                describe: () => ({ label: 'Start playback' }),
                executionKind: 'runtime',
                undoable: false,
            }),
        });

        const result = await executeAppActionBatch([{ type: 'setPlayback', payload: { playing: true } }], {
            requireCompensation: true,
            shouldExecute,
            source: 'prompt',
        });

        expect(result).toMatchObject({
            status: 'executed',
            actions: [{ action: { type: 'setPlayback', payload: { playing: true } }, label: 'Start playback' }],
        });
        expect(shouldExecute).toHaveBeenCalledTimes(2);
        expect(execute).toHaveBeenCalledOnce();
        expect(mocks.setSemanticContext).not.toHaveBeenCalled();
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.recordActionHistoryMetadata).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
    });

    it('rejects a runtime action mixed with another action before either handler executes', async () => {
        const executeRuntime = vi.fn();
        const executeProject = vi.fn();
        registerHandlerMap({
            setPlayback: createHandler<SetPlaybackAction>({
                execute: executeRuntime,
                executionKind: 'runtime',
                undoable: false,
            }),
            setEditingTool: createHandler<SetEditingToolAction>({ execute: executeProject }),
        });

        const result = await executeAppActionBatch([
            { type: 'setPlayback', payload: { playing: true } },
            { type: 'setEditingTool', payload: { tool: 'marquee' } },
        ]);

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Runtime actions must execute as singleton batches',
            actions: [],
        });
        expect(executeRuntime).not.toHaveBeenCalled();
        expect(executeProject).not.toHaveBeenCalled();
        expect(mocks.setSemanticContext).not.toHaveBeenCalled();
    });

    it('cancels a runtime no-op when authority changes after snapshot admission', async () => {
        const execute = vi.fn();
        const isNoop = vi.fn(() => true);
        const shouldExecute = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
        registerHandlerMap({
            setPlayback: createHandler<SetPlaybackAction>({
                execute,
                executionKind: 'runtime',
                isNoop,
                undoable: false,
            }),
        });

        const result = await executeAppActionBatch([{ type: 'setPlayback', payload: { playing: true } }], {
            shouldExecute,
        });

        expect(result).toEqual({
            status: 'cancelled',
            reason: 'Batch execution authority was revoked',
            actions: [],
        });
        expect(shouldExecute).toHaveBeenCalledTimes(2);
        expect(isNoop).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });

    it('reports a runtime follow-up failure as executed truth without post-dispatch cancellation', async () => {
        const afterRuntimeExecution = vi.fn().mockRejectedValue(new Error('event unavailable'));
        registerHandlerMap({
            setPlayback: createHandler<SetPlaybackAction>({
                execute: () => ({ status: 'written', afterRuntimeExecution }),
                executionKind: 'runtime',
                undoable: false,
            }),
        });

        const result = await executeAppActionBatch([{ type: 'setPlayback', payload: { playing: true } }]);

        expect(result).toMatchObject({
            status: 'executed-with-warning',
            actions: [{ action: { type: 'setPlayback', payload: { playing: true } }, label: 'Batch action' }],
            warning: 'setPlayback follow-up effect failed: event unavailable',
        });
        expect(afterRuntimeExecution).toHaveBeenCalledOnce();
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
    });

    it('reports rejected Stop teardown as executed-with-warning after waiting for its completion', async () => {
        const teardownFailure = new Error('recording flush failed');
        let rejectTeardown: ((reason: Error) => void) | undefined;
        const teardown = new Promise<void>((_resolve, reject) => {
            rejectTeardown = reject;
        });
        let stopApplied = false;
        registerHandlerMap({
            stopPlayback: createHandler<StopPlaybackAction>({
                execute: () => {
                    stopApplied = true;
                    return {
                        status: 'written',
                        afterRuntimeExecution: () => teardown,
                    };
                },
                executionKind: 'runtime',
                undoable: false,
            }),
        });

        const pending = executeAppActionBatch([{ type: 'stopPlayback' }]);
        let settled = false;
        void pending.then(() => {
            settled = true;
            return undefined;
        });
        await Promise.resolve();

        expect(stopApplied).toBe(true);
        expect(settled).toBe(false);
        if (!rejectTeardown) {
            throw new Error('Expected Stop teardown to remain pending');
        }
        rejectTeardown(teardownFailure);

        await expect(pending).resolves.toMatchObject({
            status: 'executed-with-warning',
            actions: [{ action: { type: 'stopPlayback' }, label: 'Batch action' }],
            warning: 'stopPlayback follow-up effect failed: recording flush failed',
        });
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
    });

    it('preserves the original runtime-only follow-up failure', async () => {
        const afterRuntimeExecution = vi.fn().mockRejectedValue(new Error('event unavailable'));
        registerHandlerMap({
            setPlayback: createHandler<SetPlaybackAction>({
                execute: () => ({ status: 'written', afterRuntimeExecution }),
                executionKind: 'runtime',
                undoable: false,
            }),
        });

        const result = await executeAppActionBatch([{ type: 'setPlayback', payload: { playing: true } }]);

        expect(result).toMatchObject({
            status: 'executed-with-warning',
            actions: [{ action: { type: 'setPlayback', payload: { playing: true } }, label: 'Batch action' }],
            warning: 'setPlayback follow-up effect failed: event unavailable',
        });
        expect(afterRuntimeExecution).toHaveBeenCalledOnce();
    });

    it('cancels without dispatch when authority is revoked during a snapshot wait', async () => {
        let releaseSnapshot: (() => void) | undefined;
        const snapshotWait = new Promise<void>((resolve) => {
            releaseSnapshot = resolve;
        });
        configureAutomergeStoragePort({
            getDoc: () => ({}),
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: vi.fn(),
            waitForSnapshotTransaction: () => snapshotWait,
        });
        const execute = vi.fn();
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({ execute }),
        });
        let authorized = true;

        const pending = executeAppActionBatch([{ type: 'setEditingTool', payload: { tool: 'marquee' } }], {
            shouldExecute: () => authorized,
        });
        authorized = false;
        releaseSnapshot?.();

        await expect(pending).resolves.toEqual({
            status: 'cancelled',
            reason: 'Batch execution authority was revoked',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
        expect(mocks.recordAction).not.toHaveBeenCalled();
    });

    it('rejects the whole batch before dispatch when any handler is unavailable', async () => {
        const execute = vi.fn();
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({ execute }),
        });

        const result = await executeAppActionBatch([
            { type: 'setEditingTool', payload: { tool: 'marquee' } },
            { type: 'setSnapValue', payload: { value: 0.5 } },
        ]);

        expect(result.status).toBe('rejected');
        expect(execute).not.toHaveBeenCalled();
    });

    it('rejects a batch before dispatch when the current production brief protects its target', async () => {
        const execute = vi.fn();
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({ execute }),
        });
        productionBriefAdmissionPort.setGuard(() => false);

        const result = await executeAppActionBatch([{ type: 'setEditingTool', payload: { tool: 'marquee' } }]);

        expect(result).toEqual({
            status: 'conflicted',
            reason: 'Action batch conflicts with locked production intent',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
    });

    it('returns a typed no-op without history when every action already matches project truth', async () => {
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: vi.fn(),
                isNoop: () => true,
            }),
        });
        const onCommitted = vi.fn();

        const result = await executeAppActionBatch([{ type: 'setEditingTool', payload: { tool: 'marquee' } }], {
            onCommitted,
        });

        expect(result).toEqual({ status: 'no-op', actions: [] });
        expect(mocks.recordActionHistoryMetadata).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
        expect(onCommitted).not.toHaveBeenCalled();
    });
});
