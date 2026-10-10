import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Logger } from '#/infra/logger/types';
import {
    AutomergeStorageWriteConflictError,
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';

import { AppActionCommittedError, AppActionConflictError } from '../../errors/AppActionExecutionError';
import { clearActionReplayCapabilities } from '../../stores/actionReplayCapabilities';
import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { executeAppAction } from '../executeAppAction';
import { productionBriefAdmissionPort } from '../productionBriefAdmissionPort';

import type { ActionHandler, AppAction, HandlerExecutionResult } from '#/utils/handlerContract';
import type { ActionHistoryMetadata } from '../actionHistoryMetadataPort';

// A handler can change state outside the document (the audio engine, automation
// recording) before the action aborts. The document rolls back with the
// transaction; the handler's own `prepareAbort` rollback is the only thing that
// puts the rest back, and the batch path already runs it. These specs pin that a
// single action does too, on every abort after execute and on none other.

type SetEditingToolAction = Extract<AppAction, { type: 'setEditingTool' }>;
type StorageValue = { tool: string };

const mocks = vi.hoisted(() => ({
    logger: {
        error: vi.fn<Logger['error']>(),
        info: vi.fn<Logger['info']>(),
        warn: vi.fn<Logger['warn']>(),
        debug: vi.fn<Logger['debug']>(),
        setWriters: vi.fn<Logger['setWriters']>(),
    } satisfies Logger,
    recordActionHistoryMetadata: vi.fn<(entry: ActionHistoryMetadata) => string[]>(),
    commitUndoEntry: vi.fn<(entry: unknown) => void>(),
    recordAction: vi.fn<(action: AppAction) => void>(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mocks.logger }));

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

const action: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'marquee' } };

type Harness = {
    doc: Record<string, unknown>;
    mutations: unknown[];
    storage: ReturnType<typeof createAutomergeStorage<StorageValue>>;
};

function createHarness(mutateDoc?: () => void): Harness {
    const doc: Record<string, unknown> = { editingTool: { tool: 'select' } };
    const mutations: unknown[] = [];
    configureAutomergeStoragePort({
        getDoc: () => doc,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            mutateDoc?.();
            changeFn(doc);
            mutations.push(structuredClone(doc.editingTool));
        },
    });
    const storage = createAutomergeStorage<StorageValue>('root', 'editingTool');
    storage.hydrate?.();
    return { doc, mutations, storage };
}

type Recorder = {
    calls: string[];
    prepareAbort: ReturnType<typeof vi.fn<NonNullable<ActionHandler<SetEditingToolAction>['prepareAbort']>>>;
    rollback: ReturnType<typeof vi.fn<() => void>>;
};

function recordRollback(onRollback: () => void = () => undefined): Recorder {
    const calls: string[] = [];
    const rollback = vi.fn(() => {
        calls.push('rollback');
        onRollback();
    });
    const prepareAbort = vi.fn<NonNullable<ActionHandler<SetEditingToolAction>['prepareAbort']>>(() => {
        calls.push('prepareAbort');
        return rollback;
    });
    return { calls, prepareAbort, rollback };
}

function registerHandler(
    recorder: Recorder,
    execute: (action: SetEditingToolAction) => void | HandlerExecutionResult | Promise<void | HandlerExecutionResult>,
    isNoop?: () => boolean
): void {
    registerHandlerMap({
        [action.type]: {
            undoable: true,
            describe: () => ({ label: 'Set editing tool' }),
            isNoop,
            prepareAbort: recorder.prepareAbort,
            execute: (executed) => {
                recorder.calls.push('execute');
                return execute(executed);
            },
        } satisfies ActionHandler<SetEditingToolAction>,
    });
}

const inverseAction: SetEditingToolAction = { type: 'setEditingTool', payload: { tool: 'select' } };

/**
 * Like `registerHandler`, for a handler that describes the inverse the batch path replays
 * on abort. The inverse is the same action type with the stored tool, so one `execute`
 * serves both and tells them apart by payload.
 */
function registerCompensableHandler(
    recorder: Recorder,
    execute: (action: SetEditingToolAction) => void | HandlerExecutionResult | Promise<void | HandlerExecutionResult>,
    compensate: () => void | HandlerExecutionResult = () => undefined,
    requiresAbortCompensation?: boolean
): void {
    registerHandlerMap({
        [action.type]: {
            undoable: true,
            describe: () => ({ label: 'Set editing tool', inverseAction }),
            prepareAbort: recorder.prepareAbort,
            requiresAbortCompensation,
            execute: (executed) => {
                if (executed.payload.tool === inverseAction.payload.tool) {
                    recorder.calls.push('compensate');
                    return compensate();
                }
                recorder.calls.push('execute');
                return execute(executed);
            },
        } satisfies ActionHandler<SetEditingToolAction>,
    });
}

let productionBriefAllows = true;

function refuseBrief(): void {
    productionBriefAllows = false;
}

type AbortRoute = {
    name: string;
    mutateDoc?: () => void;
    execute: (context: {
        storage: Harness['storage'];
    }) => void | HandlerExecutionResult | Promise<void | HandlerExecutionResult>;
};

const abortRoutes: AbortRoute[] = [
    {
        name: 'a synchronous handler throw',
        execute: () => {
            throw new Error('handler threw');
        },
    },
    {
        name: 'a rejected handler',
        execute: async () => {
            await Promise.resolve();
            throw new Error('handler rejected');
        },
    },
    {
        name: 'a synchronous storage write conflict',
        execute: () => {
            throw new AutomergeStorageWriteConflictError('storage conflict');
        },
    },
    {
        name: 'an awaited storage write conflict',
        execute: async () => {
            await Promise.resolve();
            throw new AutomergeStorageWriteConflictError('storage conflict');
        },
    },
    {
        name: 'a commit validation failure',
        execute: () => {
            refuseBrief();
        },
    },
    {
        name: 'a storage write conflict raised by the commit',
        mutateDoc: () => {
            throw new AutomergeStorageWriteConflictError('commit conflict');
        },
        execute: ({ storage }) => storage.set({ tool: 'marquee' }),
    },
    {
        name: 'another commit failure',
        mutateDoc: () => {
            throw new Error('CRDT commit failed');
        },
        execute: ({ storage }) => storage.set({ tool: 'marquee' }),
    },
];

describe('executeAppAction abort rollback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        clearActionReplayCapabilities();
        mocks.recordActionHistoryMetadata.mockReturnValue([]);
        configureAutomergeStoragePort(null);
        productionBriefAllows = true;
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => productionBriefAllows }));
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
    });

    it('prepares the rollback before execute and never runs it when the action commits', async () => {
        const { doc, storage } = createHarness();
        const recorder = recordRollback();
        registerHandler(recorder, () => storage.set({ tool: 'marquee' }));

        await executeAppAction(action);

        expect(recorder.calls).toEqual(['prepareAbort', 'execute']);
        expect(doc.editingTool).toEqual({ tool: 'marquee' });
    });

    it('does not prepare a rollback for a semantic no-op', async () => {
        createHarness();
        const recorder = recordRollback();
        registerHandler(
            recorder,
            () => undefined,
            () => true
        );

        await executeAppAction(action);

        expect(recorder.calls).toEqual([]);
    });

    it('does not prepare a rollback for an action the production brief refuses before execute', async () => {
        createHarness();
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => false }));
        const recorder = recordRollback();
        registerHandler(recorder, () => undefined);

        await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionConflictError);

        expect(recorder.calls).toEqual([]);
    });

    it('rolls back once, before the abort, when the handler rejects after it wrote', async () => {
        const { doc, storage } = createHarness();
        const cause = new Error('handler failed after write');
        let storedDuringRollback: StorageValue | null | undefined;
        const recorder = recordRollback(() => {
            storedDuringRollback = storage.get();
        });
        registerHandler(recorder, async () => {
            storage.set({ tool: 'marquee' });
            await Promise.resolve();
            throw cause;
        });

        await expect(executeAppAction(action)).rejects.toBe(cause);

        expect(recorder.calls).toEqual(['prepareAbort', 'execute', 'rollback']);
        // The rollback ran while the transaction was still open: the aborted write was still pending.
        expect(storedDuringRollback).toEqual({ tool: 'marquee' });
        expect(storage.get()).toEqual({ tool: 'select' });
        expect(doc.editingTool).toEqual({ tool: 'select' });
    });

    it('rolls back once when the handler throws synchronously', async () => {
        createHarness();
        const cause = new Error('threw before returning');
        const recorder = recordRollback();
        registerHandlerMap({
            [action.type]: {
                undoable: true,
                describe: () => ({ label: 'Set editing tool' }),
                prepareAbort: recorder.prepareAbort,
                execute: () => {
                    recorder.calls.push('execute');
                    throw cause;
                },
            } satisfies ActionHandler<SetEditingToolAction>,
        });

        await expect(executeAppAction(action)).rejects.toBe(cause);

        expect(recorder.calls).toEqual(['prepareAbort', 'execute', 'rollback']);
    });

    it.each([
        [
            'synchronous',
            () => {
                throw new AutomergeStorageWriteConflictError('storage conflict');
            },
        ],
        [
            'awaited',
            async () => {
                await Promise.resolve();
                throw new AutomergeStorageWriteConflictError('storage conflict');
            },
        ],
    ] as const)(
        'rolls back once and still reports a %s storage write conflict as a conflict',
        async (_kind, execute) => {
            createHarness();
            const recorder = recordRollback();
            registerHandler(recorder, execute);

            await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionConflictError);

            expect(recorder.calls).toEqual(['prepareAbort', 'execute', 'rollback']);
        }
    );

    it('rolls back once when a commit validator refuses the write', async () => {
        const { doc, storage } = createHarness();
        let briefAllows = true;
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => briefAllows }));
        let storedDuringRollback: StorageValue | null | undefined;
        const recorder = recordRollback(() => {
            storedDuringRollback = storage.get();
        });
        registerHandler(recorder, () => {
            storage.set({ tool: 'marquee' });
            briefAllows = false;
        });

        await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionConflictError);

        expect(recorder.calls).toEqual(['prepareAbort', 'execute', 'rollback']);
        expect(storedDuringRollback).toEqual({ tool: 'marquee' });
        expect(doc.editingTool).toEqual({ tool: 'select' });
    });

    it('rolls back once and still reports a storage write conflict raised by the commit as a conflict', async () => {
        const { doc, storage } = createHarness(() => {
            throw new AutomergeStorageWriteConflictError('commit conflict');
        });
        const recorder = recordRollback();
        registerHandler(recorder, () => storage.set({ tool: 'marquee' }));

        await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionConflictError);

        expect(recorder.calls).toEqual(['prepareAbort', 'execute', 'rollback']);
        expect(doc.editingTool).toEqual({ tool: 'select' });
    });

    it('rolls back once when the commit fails before anything reached storage', async () => {
        const commitFailure = new Error('CRDT commit failed');
        const { doc, storage } = createHarness(() => {
            throw commitFailure;
        });
        const recorder = recordRollback();
        registerHandler(recorder, () => storage.set({ tool: 'marquee' }));

        await expect(executeAppAction(action)).rejects.toBe(commitFailure);

        expect(recorder.calls).toEqual(['prepareAbort', 'execute', 'rollback']);
        expect(doc.editingTool).toEqual({ tool: 'select' });
    });

    it('does not roll back a commit that already reached storage', async () => {
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
        const primary = createAutomergeStorage<StorageValue>('primary', 'editingTool');
        const secondary = createAutomergeStorage<{ value: number }>('secondary', 'snap');
        primary.hydrate?.();
        secondary.hydrate?.();
        const recorder = recordRollback();
        registerHandler(recorder, () => {
            primary.set({ tool: 'marquee' });
            secondary.set({ value: 1 });
            return { status: 'written', afterCommit: () => undefined, afterAmbiguousCommit: () => undefined };
        });

        await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionCommittedError);

        expect(recorder.calls).toEqual(['prepareAbort', 'execute']);
    });

    // The batch path drops a handler's attempt from its rollback list the same way:
    // a handler that reports no write declined before touching anything.
    it('does not roll back a handler that reports no write, because it declined before changing anything', async () => {
        createHarness();
        const recorder = recordRollback();
        registerHandler(recorder, () => ({ status: 'no-write' }));

        await executeAppAction(action);

        expect(recorder.calls).toEqual(['prepareAbort', 'execute']);
    });

    it('does not roll back a handler that reports a conflict, because it declined before changing anything', async () => {
        createHarness();
        const recorder = recordRollback();
        registerHandler(recorder, () => ({ status: 'conflict' }));

        await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionConflictError);

        expect(recorder.calls).toEqual(['prepareAbort', 'execute']);
    });

    // Every route that aborts after execute names its own failure kind, and each kind
    // has its own classification as a retryable conflict. A failed rollback or
    // compensation must outrank that classification on all of them, so each route is
    // exercised for both the failure reporting and the compensation it shares.
    describe.each<AbortRoute>(abortRoutes)('on $name', (route) => {
        it('reports a failed rollback with the abort cause, as a failure rather than a retryable conflict', async () => {
            const { storage } = createHarness(route.mutateDoc);
            const recorder = recordRollback(() => {
                throw new Error('engine unreachable');
            });
            registerHandler(recorder, () => route.execute({ storage }));

            const execution = executeAppAction(action);

            await expect(execution).rejects.toThrow('abort rollback failed: setEditingTool: engine unreachable');
            await expect(execution).rejects.not.toBeInstanceOf(AppActionConflictError);
            expect(recorder.calls).toEqual(['prepareAbort', 'execute', 'rollback']);
        });

        it('replays the described inverse once, before the rollback', async () => {
            const { storage } = createHarness(route.mutateDoc);
            const recorder = recordRollback();
            registerCompensableHandler(recorder, () => route.execute({ storage }));

            await expect(executeAppAction(action)).rejects.toThrow();

            expect(recorder.calls).toEqual(['prepareAbort', 'execute', 'compensate', 'rollback']);
        });

        it('reports a failed compensation, and still rolls back, rather than a retryable conflict', async () => {
            const { storage } = createHarness(route.mutateDoc);
            const recorder = recordRollback();
            registerCompensableHandler(
                recorder,
                () => route.execute({ storage }),
                () => ({ status: 'conflict' })
            );

            const execution = executeAppAction(action);

            await expect(execution).rejects.toThrow(
                'runtime compensation failed: Runtime compensation did not apply for setEditingTool'
            );
            await expect(execution).rejects.not.toBeInstanceOf(AppActionConflictError);
            expect(recorder.calls).toEqual(['prepareAbort', 'execute', 'compensate', 'rollback']);
        });
    });

    describe('abort compensation', () => {
        it('does not run for a handler that declares the transaction abort undoes everything', async () => {
            const { storage } = createHarness();
            const recorder = recordRollback();
            registerCompensableHandler(
                recorder,
                () => {
                    storage.set({ tool: 'marquee' });
                    refuseBrief();
                },
                undefined,
                false
            );

            await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionConflictError);

            expect(recorder.calls).toEqual(['prepareAbort', 'execute', 'rollback']);
        });

        it('does not run when the action commits', async () => {
            const { storage } = createHarness();
            const recorder = recordRollback();
            registerCompensableHandler(recorder, () => storage.set({ tool: 'marquee' }));

            await executeAppAction(action);

            expect(recorder.calls).toEqual(['prepareAbort', 'execute']);
        });

        it('does not run for an action the production brief refuses before execute', async () => {
            createHarness();
            productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => false }));
            const recorder = recordRollback();
            registerCompensableHandler(recorder, () => undefined);

            await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionConflictError);

            expect(recorder.calls).toEqual([]);
        });

        it('does not run for a handler that reports no write or a conflict', async () => {
            createHarness();
            const noWrite = recordRollback();
            registerCompensableHandler(noWrite, () => ({ status: 'no-write' }));

            await executeAppAction(action);

            expect(noWrite.calls).toEqual(['prepareAbort', 'execute']);

            clearHandlerRegistry();
            const conflict = recordRollback();
            registerCompensableHandler(conflict, () => ({ status: 'conflict' }));

            await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionConflictError);

            expect(conflict.calls).toEqual(['prepareAbort', 'execute']);
        });

        it('does not run after a commit that already reached storage', async () => {
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
            const primary = createAutomergeStorage<StorageValue>('primary', 'editingTool');
            const secondary = createAutomergeStorage<{ value: number }>('secondary', 'snap');
            primary.hydrate?.();
            secondary.hydrate?.();
            const recorder = recordRollback();
            registerCompensableHandler(recorder, () => {
                primary.set({ tool: 'marquee' });
                secondary.set({ value: 1 });
                return { status: 'written', afterCommit: () => undefined, afterAmbiguousCommit: () => undefined };
            });

            await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionCommittedError);

            expect(recorder.calls).toEqual(['prepareAbort', 'execute']);
        });

        it('has nothing to replay for a handler that described no inverse, so the abort keeps its classification', async () => {
            createHarness();
            const recorder = recordRollback();
            registerHandler(recorder, () => {
                throw new AutomergeStorageWriteConflictError('storage conflict');
            });

            await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionConflictError);

            expect(recorder.calls).toEqual(['prepareAbort', 'execute', 'rollback']);
        });
    });
});
