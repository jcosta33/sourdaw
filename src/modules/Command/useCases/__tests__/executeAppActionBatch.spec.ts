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

type SetEditingToolAction = Extract<AppAction, { type: 'setEditingTool' }>;
type SetSnapValueAction = Extract<AppAction, { type: 'setSnapValue' }>;

const mocks = vi.hoisted(() => ({
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
    execute: ActionHandler<Action>['execute'];
    describe?: ActionHandler<Action>['describe'];
    isNoop?: ActionHandler<Action>['isNoop'];
}): ActionHandler<Action> {
    return {
        execute: input.execute,
        describe: input.describe ?? ((action) => ({ label: 'Batch action', inverseAction: action })),
        isNoop: input.isNoop,
        undoable: true,
    };
}

describe('executeAppActionBatch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
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
        expect(editingToolStorage.hydrate?.()).toBe(true);
        expect(snapValueStorage.hydrate?.()).toBe(true);
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: (action) => {
                    runtimeEffects.editingTool = action.payload.tool;
                    editingToolStorage.set({ tool: action.payload.tool });
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
        expect(editingToolStorage.hydrate?.()).toBe(true);
        expect(snapValueStorage.hydrate?.()).toBe(true);
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: () => editingToolStorage.set({ tool: 'marquee' }),
            }),
            setSnapValue: createHandler<SetSnapValueAction>({
                execute: () => snapValueStorage.set({ value: 0.5 }),
            }),
        });

        const result = await executeAppActionBatch([
            { type: 'setEditingTool', payload: { tool: 'marquee' } },
            { type: 'setSnapValue', payload: { value: 0.5 } },
        ]);

        expect(result).toEqual({
            status: 'ambiguous',
            reason: 'Automerge storage transaction committed before a later document failed',
            actions: [],
        });
        expect(documents.first).toEqual({ editingTool: { tool: 'marquee' } });
        expect(documents.second).toEqual({ snapValue: { value: 1 } });
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

    it('returns a typed no-op without history when every action already matches project truth', async () => {
        registerHandlerMap({
            setEditingTool: createHandler<SetEditingToolAction>({
                execute: vi.fn(),
                isNoop: () => true,
            }),
        });

        const result = await executeAppActionBatch([{ type: 'setEditingTool', payload: { tool: 'marquee' } }]);

        expect(result).toEqual({ status: 'no-op', actions: [] });
        expect(mocks.recordActionHistoryMetadata).not.toHaveBeenCalled();
        expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
    });
});
