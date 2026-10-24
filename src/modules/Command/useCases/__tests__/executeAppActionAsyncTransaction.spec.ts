import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import { type Logger } from '#/infra/logger/types';
import {
    captureAutomergeStorageTransactionScope,
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';

import { AppActionCommittedError } from '../../errors/AppActionExecutionError';
import { clearActionReplayCapabilities } from '../../stores/actionReplayCapabilities';
import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { executeAppAction } from '../executeAppAction';

import type { ActionHandler, AppAction } from '#/utils/handlerContract';
import type { ActionHistoryMetadata } from '../actionHistoryMetadataPort';

// Audit CC-10 — `runWithAutomergeStorageTransaction` installs the active
// transaction for the SYNCHRONOUS execution of its callback. An async handler
// returns its promise at the first `await`, so the transaction is uninstalled
// there and every store write the handler makes afterwards runs unscoped: it
// gets its own commit owner and its own animation frame, lands outside the
// action's atomic commit, and survives an abort that should have discarded it.
//
// Browsers have no async context propagation, so the transaction cannot be
// kept installed across an await without also capturing writes made by
// unrelated code running in that window (this app dispatches many actions
// without awaiting them). The contract is therefore explicit: a handler
// captures its scope synchronously, before its first await, and re-enters it
// for later writes.

type CrdtStoresModule = typeof import('#/modules/CrdtDocument/stores');
type SetEditingToolAction = Extract<AppAction, { type: 'setEditingTool' }>;

const mocks = vi.hoisted(() => ({
    logger: {
        error: vi.fn<Logger['error']>(),
        info: vi.fn<Logger['info']>(),
        warn: vi.fn<Logger['warn']>(),
        debug: vi.fn<Logger['debug']>(),
        setWriters: vi.fn<Logger['setWriters']>(),
    } satisfies Logger,
    setSemanticContext: vi.fn<(ctx: unknown) => void>(),
    clearSemanticContext: vi.fn<() => void>(),
    recordActionHistoryMetadata: vi.fn<(entry: ActionHistoryMetadata) => string[]>(),
    commitUndoEntry: vi.fn<(entry: unknown) => void>(),
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
        markReverted: vi.fn(),
        clear: vi.fn(),
    },
}));

vi.mock('../commitUndoEntry', () => ({ commitUndoEntry: mocks.commitUndoEntry }));
vi.mock('../macro/recording/recordAction', () => ({ recordAction: mocks.recordAction }));

type StorageValue = { tool: string };

type Harness = {
    doc: Record<string, unknown>;
    mutations: StorageValue[];
    storage: ReturnType<typeof createAutomergeStorage<StorageValue>>;
};

function createHarness(): Harness {
    const doc: Record<string, unknown> = { editingTool: { tool: 'select' } };
    const mutations: StorageValue[] = [];
    configureAutomergeStoragePort({
        getDoc: () => doc,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            changeFn(doc);
            mutations.push(structuredClone(doc.editingTool) as StorageValue);
        },
    });
    const storage = createAutomergeStorage<StorageValue>('root', 'editingTool');
    storage.hydrate?.();
    return { doc, mutations, storage };
}

const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };

function registerExecute(execute: ActionHandler<SetEditingToolAction>['execute']): void {
    registerHandlerMap({
        [action.type]: {
            undoable: true,
            describe: () => ({ label: 'Set editing tool' }),
            execute,
        } satisfies ActionHandler<SetEditingToolAction>,
    });
}

describe('executeAppAction — async handler transaction scope (audit CC-10)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        clearActionReplayCapabilities();
        mocks.recordActionHistoryMetadata.mockReturnValue([]);
        configureAutomergeStoragePort(null);
        agentProjectRepairStateStore.set(null);
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        agentProjectRepairStateStore.set(null);
    });

    it('commits a captured post-await write as part of the action’s single atomic change', async () => {
        const { doc, mutations, storage } = createHarness();
        registerExecute(async () => {
            const scope = captureAutomergeStorageTransactionScope();
            storage.set({ tool: 'marquee' });
            await Promise.resolve();
            scope(() => {
                storage.set({ tool: 'draw' });
            });
        });

        await executeAppAction(action);

        // One change, carrying the value written after the await.
        expect(mutations).toEqual([{ tool: 'draw' }]);
        expect(doc.editingTool).toEqual({ tool: 'draw' });
        expect(storage.get()).toEqual({ tool: 'draw' });
    });

    it.each(['sync', 'async'] as const)(
        'vetoes a staged %s write at its own commit without history or observers',
        async (mode) => {
            const { doc, mutations, storage } = createHarness();
            const staged = Promise.withResolvers<void>();
            const authorityLost = Promise.withResolvers<void>();
            let authorized = true;
            registerExecute(() => {
                const scope = captureAutomergeStorageTransactionScope();
                const stage = () => {
                    storage.set({ tool: 'draw' });
                    staged.resolve();
                    queueMicrotask(() => {
                        authorized = false;
                        authorityLost.resolve();
                    });
                };
                if (mode === 'sync') {
                    stage();
                    return undefined;
                }
                return Promise.resolve().then(() => scope(stage));
            });
            const onCommitted = vi.fn();
            const shouldCommit = vi.fn(() => authorized);

            const execution = executeAppAction(action, { shouldCommit, onCommitted });
            await staged.promise;
            await authorityLost.promise;
            await execution;

            expect(shouldCommit).toHaveBeenCalledTimes(1);
            expect(mutations).toEqual([]);
            expect(doc.editingTool).toEqual({ tool: 'select' });
            expect(storage.get()).toEqual({ tool: 'select' });
            expect(onCommitted).not.toHaveBeenCalled();
            expect(mocks.recordActionHistoryMetadata).not.toHaveBeenCalled();
            expect(mocks.commitUndoEntry).not.toHaveBeenCalled();
            expect(mocks.recordAction).not.toHaveBeenCalled();
            expect(mocks.clearSemanticContext).toHaveBeenCalledTimes(1);
        }
    );

    it.each([true, undefined])('commits a project write with commit authority %s', async (allowed) => {
        const { doc, mutations, storage } = createHarness();
        registerExecute(() => storage.set({ tool: 'draw' }));
        const onCommitted = vi.fn();
        await executeAppAction(action, {
            shouldCommit: allowed === undefined ? undefined : () => allowed,
            onCommitted,
        });
        expect(doc.editingTool).toEqual({ tool: 'draw' });
        expect(mutations).toEqual([{ tool: 'draw' }]);
        expect(onCommitted).toHaveBeenCalledTimes(1);
        expect(mocks.recordActionHistoryMetadata).toHaveBeenCalledTimes(1);
        expect(mocks.recordAction).toHaveBeenCalledTimes(1);
    });

    it('propagates a commit predicate exception after aborting its staged write', async () => {
        const { doc, mutations, storage } = createHarness();
        const failure = new Error('Commit predicate crashed');
        registerExecute(() => storage.set({ tool: 'draw' }));
        await expect(
            executeAppAction(action, {
                shouldCommit: () => {
                    throw failure;
                },
            })
        ).rejects.toBe(failure);
        expect(doc.editingTool).toEqual({ tool: 'select' });
        expect(storage.get()).toEqual({ tool: 'select' });
        expect(mutations).toEqual([]);
        expect(mocks.recordAction).not.toHaveBeenCalled();
    });

    it('propagates failed abort cleanup instead of treating a commit veto as no-write', async () => {
        const { doc, storage } = createHarness();
        const rollback = vi.fn(() => {
            throw new Error('Runtime rollback refused');
        });
        registerHandlerMap({
            [action.type]: {
                undoable: false,
                describe: () => ({ label: 'Set editing tool' }),
                prepareAbort: () => rollback,
                execute: () => storage.set({ tool: 'draw' }),
            } satisfies ActionHandler<SetEditingToolAction>,
        });
        await expect(executeAppAction(action, { shouldCommit: () => false })).rejects.toThrow(
            'Runtime rollback refused'
        );
        expect(rollback).toHaveBeenCalledTimes(1);
        expect(doc.editingTool).toEqual({ tool: 'select' });
        expect(storage.get()).toEqual({ tool: 'select' });
        expect(mocks.recordAction).not.toHaveBeenCalled();
    });

    it('propagates semantic cleanup failure after a clean commit veto', async () => {
        const { doc, storage } = createHarness();
        const failure = new Error('Semantic cleanup refused');
        registerExecute(() => storage.set({ tool: 'draw' }));
        mocks.clearSemanticContext.mockImplementationOnce(() => {
            throw failure;
        });
        await expect(executeAppAction(action, { shouldCommit: () => false })).rejects.toBe(failure);
        expect(doc.editingTool).toEqual({ tool: 'select' });
        expect(storage.get()).toEqual({ tool: 'select' });
        expect(mocks.recordAction).not.toHaveBeenCalled();
    });

    it.each(['before-write', 'after-first-document'] as const)(
        'preserves a genuine commit failure %s when the commit predicate allows it',
        async (mode) => {
            const firstDoc: Record<string, unknown> = { editingTool: { tool: 'select' } };
            const secondDoc: Record<string, unknown> = { editingTool: { tool: 'select' } };
            const failure = new Error('Document commit refused');
            configureAutomergeStoragePort({
                getDoc: (id) => (id === 'root' ? firstDoc : secondDoc),
                hasDoc: () => true,
                getSemanticMessage: () => undefined,
                mutateDoc: ({ docId, changeFn }) => {
                    if (mode === 'before-write' || docId !== 'root') {
                        throw failure;
                    }
                    changeFn(firstDoc);
                },
            });
            const first = createAutomergeStorage<StorageValue>('root', 'editingTool');
            const second = createAutomergeStorage<StorageValue>('child', 'editingTool');
            first.hydrate?.();
            second.hydrate?.();
            const afterAmbiguousCommit = vi.fn();
            registerExecute(() => {
                first.set({ tool: 'draw' });
                second.set({ tool: 'marquee' });
                return { status: 'written', afterAmbiguousCommit };
            });
            const onCommitted = vi.fn();
            const execution = executeAppAction(action, { shouldCommit: () => true, onCommitted });
            if (mode === 'before-write') {
                await expect(execution).rejects.toBe(failure);
                expect(firstDoc.editingTool).toEqual({ tool: 'select' });
                expect(afterAmbiguousCommit).not.toHaveBeenCalled();
            } else {
                const received = await execution.catch((error: unknown) => error);
                expect(received).toBeInstanceOf(AppActionCommittedError);
                expect(received).toHaveProperty('cause', failure);
                expect(firstDoc.editingTool).toEqual({ tool: 'draw' });
                expect(afterAmbiguousCommit).toHaveBeenCalledTimes(1);
            }
            expect(secondDoc.editingTool).toEqual({ tool: 'select' });
            expect(onCommitted).not.toHaveBeenCalled();
            expect(mocks.recordAction).not.toHaveBeenCalled();
            expect(mocks.recordActionHistoryMetadata).not.toHaveBeenCalled();
        }
    );

    it('leaves runtime-only handlers outside the project commit predicate', async () => {
        const execute = vi.fn();
        const shouldCommit = vi.fn(() => false);
        registerHandlerMap({
            [action.type]: {
                executionKind: 'runtime',
                undoable: false,
                describe: () => ({ label: 'Runtime editing tool' }),
                execute,
            } satisfies ActionHandler<SetEditingToolAction>,
        });
        await executeAppAction(action, { shouldCommit });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(shouldCommit).not.toHaveBeenCalled();
    });

    it('should abort a captured post-await write when repair becomes required before commit', async () => {
        const { doc, mutations, storage } = createHarness();
        let releaseHandler: (() => void) | undefined;
        let markHandlerStarted: (() => void) | undefined;
        const handlerStarted = new Promise<void>((resolve) => {
            markHandlerStarted = resolve;
        });
        const handlerRelease = new Promise<void>((resolve) => {
            releaseHandler = resolve;
        });
        registerExecute(async () => {
            const scope = captureAutomergeStorageTransactionScope();
            markHandlerStarted?.();
            await handlerRelease;
            scope(() => {
                storage.set({ tool: 'draw' });
            });
        });

        const execution = executeAppAction(action);
        await handlerStarted;
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'repair-revision',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });
        releaseHandler?.();

        await expect(execution).rejects.toThrow('Project repair is required before project actions can execute');
        expect(mutations).toEqual([]);
        expect(doc.editingTool).toEqual({ tool: 'select' });
        expect(storage.get()).toEqual({ tool: 'select' });
    });

    it('aborts a captured post-await write when the action reports no-write', async () => {
        const { doc, mutations, storage } = createHarness();
        registerExecute(async () => {
            const scope = captureAutomergeStorageTransactionScope();
            storage.set({ tool: 'marquee' });
            await Promise.resolve();
            return scope(() => {
                storage.set({ tool: 'draw' });
                return { status: 'no-write' } as const;
            });
        });

        await executeAppAction(action);
        flushAutomergeStorageWrites();

        // The write made after the await belongs to the action, so aborting
        // the action must discard it too.
        expect(mutations).toEqual([]);
        expect(doc.editingTool).toEqual({ tool: 'select' });
        expect(storage.get()).toEqual({ tool: 'select' });
    });

    it('leaves an uncaptured post-await write outside the action’s commit', async () => {
        // The residual limitation this API exists to make explicit. Without a
        // captured scope the post-await write is NOT part of the action: the
        // action commits the pre-await value, and the later write lands
        // separately on its own frame. Pinned so the boundary is a stated
        // contract rather than a surprise.
        const { doc, mutations, storage } = createHarness();
        registerExecute(async () => {
            storage.set({ tool: 'marquee' });
            await Promise.resolve();
            storage.set({ tool: 'draw' });
        });

        await executeAppAction(action);

        expect(mutations).toEqual([{ tool: 'marquee' }]);
        expect(doc.editingTool).toEqual({ tool: 'marquee' });

        flushAutomergeStorageWrites();

        expect(mutations).toEqual([{ tool: 'marquee' }, { tool: 'draw' }]);
    });

    it('refuses to re-enter a transaction that has already settled', async () => {
        const { storage } = createHarness();
        let escapedScope: (<Result>(callback: () => Result) => Result) | null = null;
        registerExecute(() => {
            escapedScope = captureAutomergeStorageTransactionScope();
            storage.set({ tool: 'marquee' });
        });

        await executeAppAction(action);

        // A handler that retains its scope past its own action must not be
        // able to attach writes to a commit owner that is already closed —
        // those writes would never flush.
        expect(escapedScope).not.toBeNull();
        expect(() => {
            escapedScope?.(() => {
                storage.set({ tool: 'draw' });
            });
        }).toThrow(/already settled/i);
    });

    it('runs the callback directly when no action transaction is active', () => {
        const { doc, storage } = createHarness();
        const scope = captureAutomergeStorageTransactionScope();

        scope(() => {
            storage.set({ tool: 'draw' });
        });
        flushAutomergeStorageWrites();

        // A handler invoked outside executeAppAction genuinely has no
        // transaction; the write still reaches the document unscoped.
        expect(doc.editingTool).toEqual({ tool: 'draw' });
    });
});
