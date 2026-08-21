import { afterEach, describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { type Logger } from '#/infra/logger/types';
import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { doesProductionBriefAllowActionBatch, productionBriefActionBatchAdmission } from '#/modules/Project/useCases';

import {
    AppActionCommittedError,
    AppActionConflictError,
    AppActionNotDispatchedError,
} from '../../errors/AppActionExecutionError';
import { clearActionReplayCapabilities, hasActionReplayCapability } from '../../stores/actionReplayCapabilities';
import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { undoStore } from '../../stores/undoStore';
import { createAppActionCommittedError } from '../createAppActionCommittedError';
import { executeAppAction } from '../executeAppAction';
import { isAppActionCommittedError } from '../isAppActionCommittedError';
import { productionBriefAdmissionPort } from '../productionBriefAdmissionPort';
import { redo } from '../redo';

import type { ActionHandler, AppAction, HandlerDescribeResult, HandlerExecutionResult } from '#/utils/handlerContract';
import type { ActionUndoEntry } from '../../models/UndoEntry';
import type { ActionHistoryMetadata } from '../actionHistoryMetadataPort';

type CrdtStoresModule = typeof import('#/modules/CrdtDocument/stores');
type SetSemanticContextInput = Parameters<CrdtStoresModule['setSemanticContext']>[0];
type CommitUndoEntryModule = typeof import('../commitUndoEntry');
type CommitUndoEntryInput = Parameters<CommitUndoEntryModule['commitUndoEntry']>[0];
type SetEditingToolAction = Extract<AppAction, { type: 'setEditingTool' }>;
type SetSnapValueAction = Extract<AppAction, { type: 'setSnapValue' }>;
type SetPlaybackAction = Extract<AppAction, { type: 'setPlayback' }>;
type StopPlaybackAction = Extract<AppAction, { type: 'stopPlayback' }>;
type ToggleSidebarAction = Extract<AppAction, { type: 'toggleSidebar' }>;
type RemoveDeviceAction = Extract<AppAction, { type: 'removeDevice' }>;
type SetTrackGainAction = Extract<AppAction, { type: 'setTrackGain' }>;

type MockCommandHandler<Action extends AppAction> = ActionHandler<Action> & {
    execute: Mock<(action: Action) => void | HandlerExecutionResult | Promise<void | HandlerExecutionResult>>;
    describe: Mock<(action: Action) => HandlerDescribeResult>;
};

type CreateMockHandlerInput<Action extends AppAction> = {
    batchExecution?: ActionHandler<Action>['batchExecution'];
    label?: string;
    execute?: (action: Action) => void | HandlerExecutionResult | Promise<void | HandlerExecutionResult>;
    describe?: (action: Action) => HandlerDescribeResult;
    executionKind?: ActionHandler<Action>['executionKind'];
    isNoop?: (action: Action) => boolean;
    undoable?: boolean;
};

type CreateMockHandlerOutput<Action extends AppAction> = MockCommandHandler<Action>;

function create_mock_handler<Action extends AppAction>({
    batchExecution,
    label = 'Mock Label',
    execute = () => undefined,
    describe = () => ({ label }),
    executionKind,
    isNoop,
    undoable = true,
}: CreateMockHandlerInput<Action> = {}): CreateMockHandlerOutput<Action> {
    return {
        batchExecution,
        execute:
            vi.fn<(action: Action) => void | HandlerExecutionResult | Promise<void | HandlerExecutionResult>>(execute),
        describe: vi.fn<(action: Action) => HandlerDescribeResult>(describe),
        executionKind,
        undoable,
        isNoop,
    };
}

const mocks = vi.hoisted(() => ({
    logger: {
        error: vi.fn<Logger['error']>(),
        info: vi.fn<Logger['info']>(),
        warn: vi.fn<Logger['warn']>(),
        debug: vi.fn<Logger['debug']>(),
        setWriters: vi.fn<Logger['setWriters']>(),
    } satisfies Logger,
    setSemanticContext: vi.fn<(ctx: SetSemanticContextInput) => void>(),
    clearSemanticContext: vi.fn<() => void>(),
    recordActionHistoryMetadata: vi.fn<(entry: ActionHistoryMetadata) => string[]>(),
    markActionHistoryMetadataReverted:
        vi.fn<(input: { entryId: string; expectedFingerprint: string }) => { status: 'marked' | 'unavailable' }>(),
    clearActionHistoryMetadata: vi.fn<() => void>(),
    commitUndoEntry: vi.fn<(entry: CommitUndoEntryInput) => void>(),
    recordAction: vi.fn<(action: AppAction) => void>(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mocks.logger }));

vi.mock('#/modules/CrdtDocument/stores', async (importOriginal) => ({
    ...(await importOriginal<CrdtStoresModule>()),
    setSemanticContext: mocks.setSemanticContext,
    clearSemanticContext: mocks.clearSemanticContext,
}));

vi.mock('../actionHistoryMetadataPort', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../actionHistoryMetadataPort')>()),
    actionHistoryMetadataPort: {
        record: mocks.recordActionHistoryMetadata,
        markReverted: mocks.markActionHistoryMetadataReverted,
        clear: mocks.clearActionHistoryMetadata,
    },
}));

vi.mock('../commitUndoEntry', () => ({ commitUndoEntry: mocks.commitUndoEntry }));

vi.mock('../macro/recording/recordAction', () => ({ recordAction: mocks.recordAction }));

describe('executeAppAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        clearActionReplayCapabilities();
        mocks.recordActionHistoryMetadata.mockReturnValue([]);
        configureAutomergeStoragePort(null);
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('requires project reconciliation while accepting a runtime-only follow-up', () => {
        const runtimeResult = {
            status: 'written',
            afterRuntimeExecution: () => undefined,
        } satisfies HandlerExecutionResult;

        // @ts-expect-error Project deferred effects require ambiguity reconciliation.
        const invalidProjectResult: HandlerExecutionResult = {
            status: 'written',
            afterCommit: () => undefined,
        };

        expect(runtimeResult.status).toBe('written');
        expect(invalidProjectResult.status).toBe('written');
    });

    it('rejects a singleton project write when current production intent denies it', async () => {
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const handler = create_mock_handler<SetEditingToolAction>();
        registerHandlerMap({ [action.type]: handler });
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => false }));

        await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionConflictError);
        expect(handler.execute).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
    });

    it('aborts with a replayable conflict when a collaborator locks a removed device parent before commit', async () => {
        const previousProject = projectStore.value ? structuredClone(projectStore.value) : null;
        const previousTracks = trackStore.value ? structuredClone(trackStore.value) : null;

        let releaseHandler: (() => void) | undefined;
        let markHandlerStarted: (() => void) | undefined;
        const handlerStarted = new Promise<void>((resolve) => {
            markHandlerStarted = resolve;
        });
        const handlerRelease = new Promise<void>((resolve) => {
            releaseHandler = resolve;
        });
        const trackId = 'track-vocal';
        const deviceId = 'device-vocal-eq';
        const initialTrack = {
            ...createTrack({ id: trackId, name: 'Vocal', kind: 'audio' }),
            devices: [
                {
                    id: deviceId,
                    name: 'Vocal EQ',
                    type: 'builtin-eq',
                    bypassed: false,
                    parameterValues: {},
                },
            ],
        };
        const document: Record<string, unknown> = {};
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => changeFn(document),
        });
        setTrackStoreState({ ...structuredClone(defaultTrackState), tracks: [initialTrack] });
        projectStore.set(structuredClone(defaultProjectStoreState));
        flushAutomergeStorageWrites();
        productionBriefAdmissionPort.setGuard(productionBriefActionBatchAdmission.capture);

        const action: RemoveDeviceAction = { type: 'removeDevice', payload: { deviceId } };
        const afterCommit = vi.fn();
        const onCommitted = vi.fn();
        const handler = create_mock_handler<RemoveDeviceAction>({
            execute: async () => {
                const currentTracks = trackStore.value;
                if (!currentTracks) {
                    throw new Error('Expected current tracks');
                }
                setTrackStoreState({
                    ...currentTracks,
                    tracks: currentTracks.tracks.map((track) =>
                        track.id === trackId
                            ? { ...track, devices: track.devices.filter((device) => device.id !== deviceId) }
                            : track
                    ),
                });
                markHandlerStarted?.();
                await handlerRelease;
                return { status: 'written', afterCommit, afterAmbiguousCommit: afterCommit };
            },
        });
        registerHandlerMap({ [action.type]: handler });
        expect(doesProductionBriefAllowActionBatch([action])).toBe(true);

        try {
            const execution = executeAppAction(action, { onCommitted });
            await handlerStarted;
            expect(trackStore.value?.tracks[0]?.devices).toEqual([]);
            const currentProject = projectStore.value;
            if (!currentProject) {
                throw new Error('Expected a current project');
            }
            projectStore.set({
                ...currentProject,
                productionBrief: {
                    ...currentProject.productionBrief,
                    revision: currentProject.productionBrief.revision + 1,
                    locks: [
                        {
                            id: 'collaborator-track-lock',
                            scope: { kind: 'track', trackId },
                            statement: 'Keep the vocal device chain fixed',
                            createdAt: currentProject.productionBrief.updatedAt + 1,
                        },
                    ],
                    updatedAt: currentProject.productionBrief.updatedAt + 1,
                },
            });
            releaseHandler?.();

            await expect(execution).rejects.toBeInstanceOf(AppActionConflictError);
            expect(trackStore.value?.tracks[0]?.devices).toEqual(initialTrack.devices);
            expect(document).toHaveProperty('tracks.tracks.0.devices', initialTrack.devices);
            expect(onCommitted).not.toHaveBeenCalled();
            expect(afterCommit).not.toHaveBeenCalled();
            expect(mocks.recordAction).not.toHaveBeenCalled();
            expect(mocks.recordActionHistoryMetadata).not.toHaveBeenCalled();
            expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
        } finally {
            releaseHandler?.();
            if (previousProject) {
                projectStore.set(previousProject);
            }
            if (previousTracks) {
                setTrackStoreState(previousTracks);
            }
        }
    });

    it('keeps a redo replay pending when production intent changes before singleton commit', async () => {
        const previousProject = projectStore.value ? structuredClone(projectStore.value) : null;
        const previousUndo = undoStore.value ? structuredClone(undoStore.value) : null;
        projectStore.set(structuredClone(defaultProjectStoreState));
        productionBriefAdmissionPort.setGuard(productionBriefActionBatchAdmission.capture);

        let releaseHandler: (() => void) | undefined;
        let markHandlerStarted: (() => void) | undefined;
        const handlerStarted = new Promise<void>((resolve) => {
            markHandlerStarted = resolve;
        });
        const handlerRelease = new Promise<void>((resolve) => {
            releaseHandler = resolve;
        });
        const document: Record<string, unknown> = { trackGain: { value: 1 } };
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => changeFn(document),
        });
        const storage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
        expect(storage.hydrate?.()).toBe(true);
        const action: SetTrackGainAction = {
            type: 'setTrackGain',
            payload: { trackId: 'track-vocal', gain: 0.7, expectedGain: 1 },
        };
        registerHandlerMap({
            setTrackGain: create_mock_handler<SetTrackGainAction>({
                execute: async () => {
                    storage.set({ value: 0.7 });
                    markHandlerStarted?.();
                    await handlerRelease;
                    return { status: 'written' };
                },
            }),
        });
        const replayEntry: ActionUndoEntry = {
            kind: 'action',
            id: 'production-brief-replay',
            label: 'Set vocal gain',
            timestamp: 1,
            source: 'manual',
            action,
            inverseAction: null,
        };
        undoStore.set({ past: [], future: [replayEntry] });

        try {
            const replay = redo();
            await handlerStarted;
            const currentProject = projectStore.value;
            if (!currentProject) {
                throw new Error('Expected a current project');
            }
            projectStore.set({
                ...currentProject,
                productionBrief: {
                    ...currentProject.productionBrief,
                    revision: currentProject.productionBrief.revision + 1,
                    locks: [
                        {
                            id: 'collaborator-track-lock',
                            scope: { kind: 'track', trackId: 'track-vocal' },
                            statement: 'Keep the vocal gain fixed',
                            createdAt: currentProject.productionBrief.updatedAt + 1,
                        },
                    ],
                    updatedAt: currentProject.productionBrief.updatedAt + 1,
                },
            });
            releaseHandler?.();

            await expect(replay).resolves.toBeUndefined();
            expect(document.trackGain).toEqual({ value: 1 });
            expect(storage.get()).toEqual({ value: 1 });
            expect(undoStore.value).toEqual({ past: [], future: [replayEntry] });
            expect(mocks.recordAction).not.toHaveBeenCalled();
        } finally {
            releaseHandler?.();
            if (previousProject) {
                projectStore.set(previousProject);
            }
            if (previousUndo) {
                undoStore.set(previousUndo);
            }
        }
    });

    it('should reject as not dispatched and log when no handler is found', async () => {
        const action: ToggleSidebarAction = { type: 'toggleSidebar' };

        await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionNotDispatchedError);

        expect(mocks.logger.error).toHaveBeenCalled();
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.recordActionHistoryMetadata).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
    });

    it('should publicly discriminate committed failures without exposing the private error class', () => {
        expect(isAppActionCommittedError(new AppActionCommittedError('togglePlayback', new Error('history')))).toBe(
            true
        );
        expect(isAppActionCommittedError(new AppActionNotDispatchedError('togglePlayback'))).toBe(false);
        expect(isAppActionCommittedError(new Error('handler failed'))).toBe(false);
    });

    it('should create a public Error value that retains committed classification', () => {
        const failure = createAppActionCommittedError({
            actionType: 'autoFixMix',
            cause: new Error('later nested write failed'),
        });

        expect(failure).toBeInstanceOf(Error);
        expect(isAppActionCommittedError(failure)).toBe(true);
    });

    it('executes a registered handler', async () => {
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const handler = create_mock_handler<SetEditingToolAction>();
        registerHandlerMap({ [action.type]: handler });

        await executeAppAction(action);

        expect(handler.execute).toHaveBeenCalledWith(action);
        expect(mocks.setSemanticContext).toHaveBeenCalledWith(expect.objectContaining({ message: 'Mock Label' }));
        expect(mocks.commitUndoEntry).toHaveBeenCalled();
        expect(mocks.recordActionHistoryMetadata).toHaveBeenCalled();
    });

    it('executes runtime handlers without CRDT semantics, undo history, or macro recording', async () => {
        const action: SetPlaybackAction = { type: 'setPlayback', payload: { playing: true } };
        const handler = create_mock_handler<SetPlaybackAction>({ executionKind: 'runtime', undoable: false });
        registerHandlerMap({ [action.type]: handler });

        await executeAppAction(action);

        expect(handler.execute).toHaveBeenCalledWith(action);
        expect(handler.describe).not.toHaveBeenCalled();
        expect(mocks.setSemanticContext).not.toHaveBeenCalled();
        expect(mocks.clearSemanticContext).not.toHaveBeenCalled();
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.recordActionHistoryMetadata).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
    });

    it('classifies rejected Stop teardown as committed after Stop was applied', async () => {
        const teardownFailure = new Error('recording flush failed');
        const teardown = Promise.reject(teardownFailure);
        let stopApplied = false;
        const action: StopPlaybackAction = { type: 'stopPlayback' };
        const handler = create_mock_handler<StopPlaybackAction>({
            execute: () => {
                stopApplied = true;
                return {
                    status: 'written',
                    afterRuntimeExecution: () => teardown,
                };
            },
            executionKind: 'runtime',
            undoable: false,
        });
        registerHandlerMap({ [action.type]: handler });

        await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionCommittedError);

        expect(stopApplied).toBe(true);
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.recordActionHistoryMetadata).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
    });

    it('runs deferred external effects only after the action commits', async () => {
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const afterCommit = vi.fn();
        const handler = create_mock_handler<SetEditingToolAction>({
            execute: () => ({ status: 'written', afterCommit, afterAmbiguousCommit: afterCommit }),
        });
        registerHandlerMap({ [action.type]: handler });

        await executeAppAction(action);

        expect(afterCommit).toHaveBeenCalledOnce();
        expect(mocks.recordActionHistoryMetadata).toHaveBeenCalledOnce();
    });

    it('recovers a deferred-effect failure by reconciling durable truth', async () => {
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const failure = new Error('event unavailable');
        const reconcileRuntime = vi.fn();
        const handler = create_mock_handler<SetEditingToolAction>({
            execute: () => ({
                status: 'written',
                afterCommit: () => Promise.reject(failure),
                afterAmbiguousCommit: reconcileRuntime,
            }),
        });
        registerHandlerMap({ [action.type]: handler });

        await expect(executeAppAction(action)).resolves.toBeUndefined();

        expect(reconcileRuntime).toHaveBeenCalledOnce();
        expect(mocks.recordActionHistoryMetadata).toHaveBeenCalledOnce();
    });

    it('reports both deferred-effect and reconciliation failures as committed', async () => {
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const effectFailure = new Error('event unavailable');
        const reconciliationFailure = new Error('runtime unavailable');
        const handler = create_mock_handler<SetEditingToolAction>({
            execute: () => ({
                status: 'written',
                afterCommit: () => Promise.reject(effectFailure),
                afterAmbiguousCommit: () => Promise.reject(reconciliationFailure),
            }),
        });
        registerHandlerMap({ [action.type]: handler });

        await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionCommittedError);

        const reportedError = mocks.logger.error.mock.calls.at(-1)?.[0];
        expect(reportedError).toBeInstanceOf(AppActionCommittedError);
        const reportedCause = reportedError?.cause;
        expect(reportedCause).toBeInstanceOf(AggregateError);
        if (!(reportedCause instanceof AggregateError)) {
            throw new Error('Expected an AggregateError cause');
        }
        expect(reportedCause.errors).toEqual([effectFailure, reconciliationFailure]);
    });

    it('skips execution, macro recording, history metadata, and undo for a semantic no-op', async () => {
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const handler = create_mock_handler<SetEditingToolAction>({ isNoop: () => true });
        const onCommitted = vi.fn();
        registerHandlerMap({ [action.type]: handler });

        await executeAppAction(action, { onCommitted });

        expect(handler.describe).not.toHaveBeenCalled();
        expect(handler.execute).not.toHaveBeenCalled();
        expect(mocks.setSemanticContext).not.toHaveBeenCalled();
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.recordActionHistoryMetadata).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
        expect(onCommitted).not.toHaveBeenCalled();
    });

    it('drops history and undo when execution discovers a concurrent no-write', async () => {
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const handler = create_mock_handler<SetEditingToolAction>({ execute: () => ({ status: 'no-write' }) });
        const onCommitted = vi.fn();
        registerHandlerMap({ [action.type]: handler });

        await executeAppAction(action, { onCommitted });

        expect(handler.describe).toHaveBeenCalledOnce();
        expect(handler.execute).toHaveBeenCalledOnce();
        expect(mocks.clearSemanticContext).toHaveBeenCalledOnce();
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.recordActionHistoryMetadata).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
        expect(onCommitted).not.toHaveBeenCalled();
    });

    it('aborts compensated storage writes when execution returns no-write', async () => {
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const doc: Record<string, unknown> = { editingTool: { tool: 'select' } };
        const mutations: unknown[] = [];
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                changeFn(doc);
                mutations.push(structuredClone(doc));
            },
        });
        const storage = createAutomergeStorage<{ tool: string }>('root', 'editingTool');
        expect(storage.hydrate?.()).toBe(true);
        const handler = create_mock_handler<SetEditingToolAction>({
            execute: () => {
                storage.set({ tool: 'marquee' });
                storage.set({ tool: 'select' });
                return { status: 'no-write' };
            },
        });
        registerHandlerMap({ [action.type]: handler });

        await executeAppAction(action);
        flushAutomergeStorageWrites();

        expect(storage.get()).toEqual({ tool: 'select' });
        expect(doc.editingTool).toEqual({ tool: 'select' });
        expect(mutations).toEqual([]);
    });

    it('aborts storage writes when execution reports a conflict', async () => {
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const doc: Record<string, unknown> = { editingTool: { tool: 'select' } };
        const mutations: unknown[] = [];
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                changeFn(doc);
                mutations.push(structuredClone(doc));
            },
        });
        const storage = createAutomergeStorage<{ tool: string }>('root', 'editingTool');
        expect(storage.hydrate?.()).toBe(true);
        const handler = create_mock_handler<SetEditingToolAction>({
            execute: () => {
                storage.set({ tool: 'marquee' });
                return { status: 'conflict' };
            },
        });
        registerHandlerMap({ [action.type]: handler });

        await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionConflictError);
        flushAutomergeStorageWrites();

        expect(storage.get()).toEqual({ tool: 'select' });
        expect(doc.editingTool).toEqual({ tool: 'select' });
        expect(mutations).toEqual([]);
    });

    it('aborts storage writes when the handler throws', async () => {
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const cause = new Error('handler failed after write');
        const doc: Record<string, unknown> = { editingTool: { tool: 'select' } };
        const mutations: unknown[] = [];
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                changeFn(doc);
                mutations.push(structuredClone(doc));
            },
        });
        const storage = createAutomergeStorage<{ tool: string }>('root', 'editingTool');
        expect(storage.hydrate?.()).toBe(true);
        const handler = create_mock_handler<SetEditingToolAction>({
            execute: () => {
                storage.set({ tool: 'marquee' });
                throw cause;
            },
        });
        registerHandlerMap({ [action.type]: handler });

        await expect(executeAppAction(action)).rejects.toBe(cause);
        flushAutomergeStorageWrites();

        expect(storage.get()).toEqual({ tool: 'select' });
        expect(doc.editingTool).toEqual({ tool: 'select' });
        expect(mutations).toEqual([]);
    });

    it('restores storage cache and rethrows an ordinary error when mutateDoc fails before commit', async () => {
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const commitFailure = new Error('CRDT commit failed');
        const doc: Record<string, unknown> = { editingTool: { tool: 'select' } };
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: () => {
                throw commitFailure;
            },
        });
        const storage = createAutomergeStorage<{ tool: string }>('root', 'editingTool');
        expect(storage.hydrate?.()).toBe(true);
        const handler = create_mock_handler<SetEditingToolAction>({
            execute: () => storage.set({ tool: 'marquee' }),
        });
        registerHandlerMap({ [action.type]: handler });

        const execution = executeAppAction(action);

        await expect(execution).rejects.toBe(commitFailure);
        expect(isAppActionCommittedError(commitFailure)).toBe(false);
        expect(storage.get()).toEqual({ tool: 'select' });
        expect(doc.editingTool).toEqual({ tool: 'select' });
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.recordActionHistoryMetadata).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
    });

    it('reports a committed error when a later document fails after an earlier document commits', async () => {
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const commitFailure = new Error('secondary document commit failed');
        const docs: Record<string, Record<string, unknown>> = {
            primary: { editingTool: { tool: 'select' } },
            secondary: { snap: { value: 0 } },
        };
        configureAutomergeStoragePort({
            getDoc: (docId) => docs[docId],
            getSemanticMessage: () => undefined,
            hasDoc: (docId) => docs[docId] !== undefined,
            mutateDoc: ({ docId, changeFn }) => {
                const doc = docs[docId];
                if (!doc) {
                    throw new Error(`Missing test document: ${docId}`);
                }
                if (docId === 'secondary') {
                    throw commitFailure;
                }
                changeFn(doc);
            },
        });
        const primaryStorage = createAutomergeStorage<{ tool: string }>('primary', 'editingTool');
        const secondaryStorage = createAutomergeStorage<{ value: number }>('secondary', 'snap');
        let reconciledRuntime: unknown;
        const reconcileRuntime = vi.fn(() => {
            reconciledRuntime = docs.primary?.editingTool;
        });
        const onCommitted = vi.fn();
        expect(primaryStorage.hydrate?.()).toBe(true);
        expect(secondaryStorage.hydrate?.()).toBe(true);
        const handler = create_mock_handler<SetEditingToolAction>({
            execute: () => {
                primaryStorage.set({ tool: 'marquee' });
                secondaryStorage.set({ value: 1 });
                return {
                    status: 'written',
                    afterCommit: () => undefined,
                    afterAmbiguousCommit: reconcileRuntime,
                };
            },
        });
        registerHandlerMap({ [action.type]: handler });

        const execution = executeAppAction(action, { onCommitted });

        await expect(execution).rejects.toBeInstanceOf(AppActionCommittedError);
        const reportedError = mocks.logger.error.mock.calls.at(-1)?.[0];
        expect(reportedError).toBeInstanceOf(AppActionCommittedError);
        expect(reportedError?.cause).toBe(commitFailure);
        expect(reconciledRuntime).toEqual({ tool: 'marquee' });
        expect(primaryStorage.get()).toEqual({ tool: 'marquee' });
        expect(docs.primary?.editingTool).toEqual({ tool: 'marquee' });
        expect(secondaryStorage.get()).toEqual({ value: 0 });
        expect(docs.secondary?.snap).toEqual({ value: 0 });
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.recordActionHistoryMetadata).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
        expect(onCommitted).not.toHaveBeenCalled();
    });

    it('waits for snapshot ownership before describing or executing an action', async () => {
        let releaseWait!: () => void;
        const wait = new Promise<void>((resolve) => {
            releaseWait = resolve;
        });
        const waitForSnapshotTransaction = vi.fn(() => wait);
        configureAutomergeStoragePort({
            getDoc: () => undefined,
            getSemanticMessage: () => undefined,
            hasDoc: () => false,
            mutateDoc: () => undefined,
            waitForSnapshotTransaction,
        });
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const handler = create_mock_handler<SetEditingToolAction>();
        registerHandlerMap({ [action.type]: handler });

        const execution = executeAppAction(action);
        await Promise.resolve();

        expect(waitForSnapshotTransaction).toHaveBeenCalledWith(undefined);
        expect(handler.describe).not.toHaveBeenCalled();
        expect(handler.execute).not.toHaveBeenCalled();

        releaseWait();
        await execution;
        expect(handler.describe).toHaveBeenCalledOnce();
        expect(handler.execute).toHaveBeenCalledWith(action);
    });

    it('scopes the snapshot transaction to storage writes made by the action', async () => {
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const snapshotTransaction = {};
        const mutations: Array<{ snapshotTransaction?: object }> = [];
        const doc: Record<string, unknown> = {};
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn, snapshotTransaction: mutationTransaction }) => {
                changeFn(doc);
                mutations.push({ snapshotTransaction: mutationTransaction });
            },
        });
        const storage = createAutomergeStorage<{ tool: string }>('root', 'editingTool');
        const handler = create_mock_handler<SetEditingToolAction>({
            execute: () => storage.set({ tool: 'marquee' }),
        });
        registerHandlerMap({ [action.type]: handler });

        await executeAppAction(action, { skipUndo: true, snapshotTransaction });
        flushAutomergeStorageWrites(snapshotTransaction);

        expect(mutations).toEqual([{ snapshotTransaction }]);
        expect(doc.editingTool).toEqual({ tool: 'marquee' });
    });

    it('suppresses macro recording independently of undo-history recording', async () => {
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const handler = create_mock_handler<SetEditingToolAction>();
        registerHandlerMap({ [action.type]: handler });

        await executeAppAction(action, { skipMacroRecording: true });

        expect(handler.execute).toHaveBeenCalledWith(action);
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).toHaveBeenCalled();
        expect(mocks.recordActionHistoryMetadata).toHaveBeenCalled();
    });

    it('excludes singleton actions from caller-supplied undo and metadata groups', async () => {
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const handler = create_mock_handler<SetEditingToolAction>({ batchExecution: 'singleton' });
        registerHandlerMap({ [action.type]: handler });

        await executeAppAction(action, { groupId: 'group-1', groupLabel: 'Unsafe group' });

        const metadata = mocks.recordActionHistoryMetadata.mock.calls[0]?.[0];
        const undoEntry = mocks.commitUndoEntry.mock.calls[0]?.[0];
        expect(metadata?.groupId).toBeUndefined();
        expect(metadata?.groupLabel).toBeUndefined();
        expect(undoEntry?.groupId).toBeUndefined();
        expect(undoEntry?.groupLabel).toBeUndefined();
    });

    it('keeps macro recording enabled when only undo-history recording is suppressed', async () => {
        const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };
        const handler = create_mock_handler<SetEditingToolAction>();
        registerHandlerMap({ [action.type]: handler });

        await executeAppAction(action, { skipUndo: true });

        expect(handler.execute).toHaveBeenCalledWith(action);
        expect(mocks.recordAction).toHaveBeenCalledWith(action);
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
        expect(mocks.recordActionHistoryMetadata).not.toHaveBeenCalled();
    });

    it('should log and rethrow rejected registered handlers without recording side effects', async () => {
        const action: ToggleSidebarAction = { type: 'toggleSidebar' };
        const cause = new Error('handler failed');
        const handler = create_mock_handler<ToggleSidebarAction>({
            execute: () => Promise.reject(cause),
        });
        registerHandlerMap({ [action.type]: handler });

        await expect(executeAppAction(action)).rejects.toBe(cause);

        const reported_error = mocks.logger.error.mock.calls[0]?.[0];
        expect(reported_error).toBeInstanceOf(Error);
        if (reported_error === undefined) {
            throw new Error('Expected rejected handler to log an error');
        }
        expect(reported_error.message).toContain(action.type);
        expect(reported_error.cause).toBe(cause);
        expect(mocks.clearSemanticContext).toHaveBeenCalledOnce();
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.recordActionHistoryMetadata).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
    });

    it('should mint a replay capability only after a typed inverse follows successful execution', async () => {
        const action: SetSnapValueAction = { type: 'setSnapValue', payload: { value: 0.25 } };
        const handler = create_mock_handler<SetSnapValueAction>({
            describe: () => ({ label: 'Replayable', inverseAction: { type: 'togglePlayback' } }),
        });
        registerHandlerMap({ [action.type]: handler });

        await executeAppAction(action);

        const history_entry = mocks.recordActionHistoryMetadata.mock.calls[0]?.[0];
        if (!history_entry) {
            throw new Error('Expected action metadata to be recorded');
        }
        expect(hasActionReplayCapability(history_entry.id)).toBe(true);
    });

    it('should revoke an exact capability when 200 non-replayable metadata rows evict its entry', async () => {
        const action: SetSnapValueAction = { type: 'setSnapValue', payload: { value: 0.25 } };
        const replayable_entry_id = '00000000-0000-4000-8000-000000000001';
        const metadata_entry_ids: string[] = [];
        const random_uuid_spy = vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(replayable_entry_id);
        mocks.recordActionHistoryMetadata.mockImplementation((entry) => {
            metadata_entry_ids.push(entry.id);
            if (metadata_entry_ids.length <= 200) {
                return [];
            }
            return metadata_entry_ids.splice(0, metadata_entry_ids.length - 200);
        });
        registerHandlerMap({
            [action.type]: create_mock_handler<SetSnapValueAction>({
                describe: () => ({ label: 'Replayable', inverseAction: { type: 'togglePlayback' } }),
            }),
        });

        await executeAppAction(action);
        expect(hasActionReplayCapability(replayable_entry_id)).toBe(true);

        clearHandlerRegistry();
        registerHandlerMap({
            [action.type]: create_mock_handler<SetSnapValueAction>({
                describe: () => ({ label: 'Non-replayable' }),
            }),
        });
        for (let index = 0; index < 200; index += 1) {
            await executeAppAction(action);
        }

        expect(metadata_entry_ids).toHaveLength(200);
        expect(metadata_entry_ids).not.toContain(replayable_entry_id);
        expect(hasActionReplayCapability(replayable_entry_id)).toBe(false);

        random_uuid_spy.mockReturnValueOnce(replayable_entry_id);
        await executeAppAction(action);

        expect(metadata_entry_ids).toContain(replayable_entry_id);
        expect(hasActionReplayCapability(replayable_entry_id)).toBe(false);
    });

    it('should not mint a replay capability when typed action execution fails', async () => {
        const action: SetSnapValueAction = { type: 'setSnapValue', payload: { value: 0.25 } };
        const handler = create_mock_handler<SetSnapValueAction>({
            describe: () => ({ label: 'Replayable', inverseAction: { type: 'togglePlayback' } }),
            execute: () => Promise.reject(new Error('handler failed')),
        });
        registerHandlerMap({ [action.type]: handler });

        await expect(executeAppAction(action)).rejects.toThrow('handler failed');

        expect(mocks.recordActionHistoryMetadata).not.toHaveBeenCalled();
    });

    it('should preserve handler-provided committed classification', async () => {
        const action: SetSnapValueAction = { type: 'setSnapValue', payload: { value: 0.25 } };
        const committed_failure = createAppActionCommittedError({
            actionType: 'autoFixMix',
            cause: new Error('later nested write failed'),
        });
        const handler = create_mock_handler<SetSnapValueAction>({
            execute: () => Promise.reject(committed_failure),
        });
        registerHandlerMap({ [action.type]: handler });

        await expect(executeAppAction(action)).rejects.toBe(committed_failure);

        expect(isAppActionCommittedError(committed_failure)).toBe(true);
        expect(mocks.recordActionHistoryMetadata).not.toHaveBeenCalled();
    });

    it('should surface a committed error when metadata recording fails after handler execution', async () => {
        const action: SetSnapValueAction = { type: 'setSnapValue', payload: { value: 0.25 } };
        const metadata_failure = new Error('metadata failed');
        const doc: Record<string, unknown> = {};
        const mutations: unknown[] = [];
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                changeFn(doc);
                mutations.push(structuredClone(doc));
            },
        });
        const storage = createAutomergeStorage<{ value: number }>('root', 'snap');
        const handler = create_mock_handler<SetSnapValueAction>({
            describe: () => ({ label: 'Replayable', inverseAction: { type: 'togglePlayback' } }),
            execute: () => storage.set({ value: action.payload.value }),
        });
        mocks.recordActionHistoryMetadata.mockImplementation(() => {
            throw metadata_failure;
        });
        registerHandlerMap({ [action.type]: handler });

        const execution = executeAppAction(action);

        await expect(execution).rejects.toBeInstanceOf(AppActionCommittedError);
        expect(handler.execute).toHaveBeenCalledTimes(1);
        expect(mocks.recordActionHistoryMetadata).toHaveBeenCalledTimes(1);
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
        const reported_error = mocks.logger.error.mock.calls.at(-1)?.[0];
        expect(reported_error).toBeInstanceOf(AppActionCommittedError);
        expect(reported_error?.cause).toBe(metadata_failure);
        expect(doc.snap).toEqual({ value: 0.25 });
        expect(mutations).toHaveLength(1);
    });

    // Dispatch-ordering invariant. `executeAppAction` documents that, for an
    // undoable action, `describe()` must run BEFORE `execute()` so it can snapshot
    // pre-mutation state for destructive inverses (restoreTrack/restoreClip), and
    // the undo + action-history records must be pushed AFTER `execute()` resolves
    // (so an `await`ed async handler has actually committed before the entry is
    // recorded). A handler that re-ordered these — or pushed undo before awaiting —
    // would corrupt destructive undo without any other test catching it.
    it('runs describe() before execute(), and records undo/history only after execute() resolves', async () => {
        const action: SetSnapValueAction = { type: 'setSnapValue', payload: { value: 0.25 } };
        const order: string[] = [];
        const handler = create_mock_handler<SetSnapValueAction>({
            describe: () => {
                order.push('describe');
                return { label: 'Ordered' };
            },
            execute: async () => {
                order.push('execute:start');
                await Promise.resolve();
                order.push('execute:end');
            },
        });
        registerHandlerMap({ [action.type]: handler });
        mocks.commitUndoEntry.mockImplementation(() => order.push('commitUndoEntry'));
        mocks.recordActionHistoryMetadata.mockImplementation(() => {
            order.push('recordActionHistoryMetadata');
            return [];
        });

        await executeAppAction(action);

        // describe is the first thing recorded (snapshot before mutation)…
        expect(order[0]).toBe('describe');
        // …execute runs to completion before either record is pushed…
        expect(order.indexOf('execute:end')).toBeLessThan(order.indexOf('commitUndoEntry'));
        expect(order.indexOf('execute:end')).toBeLessThan(order.indexOf('recordActionHistoryMetadata'));
        // …and describe never runs after execute started.
        expect(order.indexOf('describe')).toBeLessThan(order.indexOf('execute:start'));
    });
});
