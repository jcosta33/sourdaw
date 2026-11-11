import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { AppActionConflictError } from '../../errors/AppActionExecutionError';
import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { undoStore } from '../../stores/undoStore';
import { createUndoEntry } from '../createUndoEntry';
import { createVersionedCommandEnvelope } from '../createVersionedCommandEnvelope';
import { executeAppAction } from '../executeAppAction';
import { findPendingRedoEntry } from '../findPendingRedoEntry';
import { productionBriefAdmissionPort } from '../productionBriefAdmissionPort';

type Action = Extract<AppAction, { type: 'setEditingTool' }>;

function handler(input: Partial<ActionHandler<Action>> = {}): ActionHandler<Action> {
    return {
        undoable: false,
        describe: () => ({ label: 'Observer fixture' }),
        execute: () => ({ status: 'written' }),
        materializeCommandArguments: (action) => {
            action.payload.tool = 'marquee';
        },
        ...input,
    };
}

const request: Action = { type: 'setEditingTool', payload: { tool: 'select' } };

function holdSnapshotWait() {
    const entered = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();
    const waitForSnapshotTransaction = vi.fn(() => {
        entered.resolve();
        return held.promise;
    });
    configureAutomergeStoragePort({
        getDoc: () => undefined,
        getSemanticMessage: () => undefined,
        hasDoc: () => false,
        mutateDoc: () => undefined,
        waitForSnapshotTransaction,
    });
    return { entered: entered.promise, release: () => held.resolve(), waitForSnapshotTransaction };
}

type AddTrackAction = Extract<AppAction, { type: 'addTrack' }>;

function preparedTrackCommand(action: AddTrackAction) {
    return createVersionedCommandEnvelope({
        action,
        availableDeviceVersions: {},
        expectedEffect: 'Add prepared track',
        normalizedProjectRevision: 'fixture-revision',
        objectReferences: [],
        parameterUnits: [],
        reason: 'Prepared track fixture',
        time: [],
    });
}

describe('single action canonical materialization observer', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
    });
    afterEach(() => {
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
    });

    it('reports actual owner arguments through an isolated clone', async () => {
        const execute = vi.fn<ActionHandler<Action>['execute']>(() => ({ status: 'written' }));
        registerHandlerMap({ setEditingTool: handler({ execute }) });
        const observe = vi.fn((action: Readonly<AppAction>) => {
            expect(action).toEqual({ type: 'setEditingTool', payload: { tool: 'marquee' } });
            if (action.type === 'setEditingTool') {
                action.payload.tool = 'cut';
            }
        });
        await executeAppAction(request, {
            skipUndo: true,
            skipMacroRecording: true,
            observeMaterializedAction: observe,
        });
        expect(observe).toHaveBeenCalledOnce();
        expect(execute.mock.calls[0]?.[0]).toEqual({ type: 'setEditingTool', payload: { tool: 'marquee' } });
        expect(request.payload.tool).toBe('select');
    });

    it('reports a noop without changing the committed observer contract', async () => {
        const execute = vi.fn<ActionHandler<Action>['execute']>();
        registerHandlerMap({ setEditingTool: handler({ execute, isNoop: () => true }) });
        const observe = vi.fn();
        const onCommitted = vi.fn();
        await executeAppAction(request, { observeMaterializedAction: observe, onCommitted });
        expect(observe).toHaveBeenCalledWith({ type: 'setEditingTool', payload: { tool: 'marquee' } });
        expect(execute).not.toHaveBeenCalled();
        expect(onCommitted).not.toHaveBeenCalled();
    });

    it('does not report cancelled admission', async () => {
        const execute = vi.fn<ActionHandler<Action>['execute']>();
        registerHandlerMap({ setEditingTool: handler({ execute }) });
        const observe = vi.fn();
        await executeAppAction(request, { shouldExecute: () => false, observeMaterializedAction: observe });
        expect(observe).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });

    it('does not turn observed arguments into successful commit authority', async () => {
        registerHandlerMap({ setEditingTool: handler({ execute: () => ({ status: 'conflict' }) }) });
        const observe = vi.fn();
        const onCommitted = vi.fn();
        await expect(
            executeAppAction(request, { observeMaterializedAction: observe, onCommitted })
        ).rejects.toBeInstanceOf(AppActionConflictError);
        expect(observe).toHaveBeenCalledOnce();
        expect(onCommitted).not.toHaveBeenCalled();
    });

    it('materializes execution-opted arguments after cancellation and before guards, observing an isolated clone', async () => {
        const wait = holdSnapshotWait();
        let tool: Action['payload']['tool'] = 'marquee';
        const order: string[] = [];
        const materialize = vi.fn((action: Action) => {
            order.push('materialize');
            action.payload.tool = tool;
        });
        const execute = vi.fn<ActionHandler<Action>['execute']>(() => {
            order.push('execute');
            return { status: 'written' };
        });
        registerHandlerMap({
            setEditingTool: handler({
                materializeCommandArgumentsAt: 'execution',
                materializeCommandArguments: materialize,
                execute,
            }),
        });
        productionBriefAdmissionPort.setGuard((actions) => {
            order.push('guard');
            expect(actions[0]).toEqual({ type: 'setEditingTool', payload: { tool: 'cut' } });
            return { allowsCurrent: () => true };
        });
        const observe = vi.fn((action: Readonly<AppAction>) => {
            order.push('observe');
            expect(action).toEqual({ type: 'setEditingTool', payload: { tool: 'cut' } });
            if (action.type === 'setEditingTool') {
                action.payload.tool = 'select';
            }
        });
        const execution = executeAppAction(request, {
            shouldExecute: () => {
                order.push('cancel');
                return true;
            },
            observeMaterializedAction: observe,
        });
        try {
            await wait.entered;
            expect(materialize).not.toHaveBeenCalled();
            expect(execute).not.toHaveBeenCalled();
            tool = 'cut';
        } finally {
            wait.release();
            await Promise.allSettled([execution]);
        }
        await execution;
        expect(order).toEqual(['cancel', 'materialize', 'guard', 'observe', 'execute']);
        expect(materialize).toHaveBeenCalledOnce();
        expect(observe).toHaveBeenCalledOnce();
        expect(execute.mock.calls[0]?.[0]).toEqual({ type: 'setEditingTool', payload: { tool: 'cut' } });
        expect(execute.mock.calls[0]?.[0]).not.toBe(observe.mock.calls[0]?.[0]);
        expect(request.payload.tool).toBe('select');
    });

    it.each([undefined, 'admission'] as const)('keeps %s materialization once before the wait', async (phase) => {
        const wait = holdSnapshotWait();
        let tool: Action['payload']['tool'] = 'marquee';
        const materialize = vi.fn((action: Action) => {
            action.payload.tool = tool;
        });
        const execute = vi.fn<ActionHandler<Action>['execute']>(() => ({ status: 'written' }));
        registerHandlerMap({
            setEditingTool: handler({
                materializeCommandArgumentsAt: phase,
                materializeCommandArguments: materialize,
                execute,
            }),
        });
        const execution = executeAppAction(request);
        try {
            await wait.entered;
            expect(materialize).toHaveBeenCalledOnce();
            expect(execute).not.toHaveBeenCalled();
            tool = 'cut';
        } finally {
            wait.release();
            await Promise.allSettled([execution]);
        }
        await execution;
        expect(materialize).toHaveBeenCalledOnce();
        expect(execute.mock.calls[0]?.[0]).toEqual({ type: 'setEditingTool', payload: { tool: 'marquee' } });
        expect(request.payload.tool).toBe('select');
    });

    it('keeps runtime materialization early without entering the project snapshot wait', async () => {
        const wait = holdSnapshotWait();
        const materialize = vi.fn((action: Action) => {
            action.payload.tool = 'marquee';
        });
        const execute = vi.fn<ActionHandler<Action>['execute']>(() => ({ status: 'written' }));
        registerHandlerMap({
            setEditingTool: handler({
                executionKind: 'runtime',
                materializeCommandArgumentsAt: 'execution',
                materializeCommandArguments: materialize,
                execute,
            }),
        });
        const execution = executeAppAction(request);
        try {
            const terminal = await Promise.race([
                execution.then(() => 'executed' as const),
                wait.entered.then(() => 'waiting' as const),
            ]);
            expect(terminal).toBe('executed');
            expect(wait.waitForSnapshotTransaction).not.toHaveBeenCalled();
            expect(materialize).toHaveBeenCalledOnce();
            expect(execute.mock.calls[0]?.[0]).toEqual({ type: 'setEditingTool', payload: { tool: 'marquee' } });
        } finally {
            wait.release();
            await Promise.allSettled([execution]);
        }
        await execution;
    });

    it('does not materialize an execution-opted action after cancellation', async () => {
        const wait = holdSnapshotWait();
        const materialize = vi.fn<(action: Action) => void>();
        const execute = vi.fn<ActionHandler<Action>['execute']>();
        const observe = vi.fn();
        registerHandlerMap({
            setEditingTool: handler({
                materializeCommandArgumentsAt: 'execution',
                materializeCommandArguments: materialize,
                execute,
            }),
        });
        const execution = executeAppAction(request, { shouldExecute: () => false, observeMaterializedAction: observe });
        try {
            await wait.entered;
        } finally {
            wait.release();
            await Promise.allSettled([execution]);
        }
        await execution;
        expect(materialize).not.toHaveBeenCalled();
        expect(observe).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });

    it('keeps a supplied prepared name and its digest through early envelope materialization', async () => {
        const wait = holdSnapshotWait();
        const action: AddTrackAction = {
            type: 'addTrack',
            payload: { id: 'prepared-track', kind: 'midi', name: 'MIDI 7' },
        };
        const envelope = preparedTrackCommand(action);
        const before = structuredClone(envelope);
        const materialize = vi.fn((candidate: AddTrackAction) => {
            if (candidate.payload.name === undefined) {
                candidate.payload.name = 'MIDI 99';
            }
        });
        const execute = vi.fn<ActionHandler<AddTrackAction>['execute']>(() => ({ status: 'written' }));
        registerHandlerMap({
            addTrack: {
                undoable: false,
                describe: () => ({ label: 'Prepared add' }),
                materializeCommandArgumentsAt: 'execution',
                materializeCommandArguments: materialize,
                execute,
            },
        });
        const execution = executeAppAction(action, { commandEnvelope: envelope });
        try {
            await wait.entered;
            expect(materialize).toHaveBeenCalledOnce();
            expect(execute).not.toHaveBeenCalled();
        } finally {
            wait.release();
            await Promise.allSettled([execution]);
        }
        await execution;
        expect(materialize).toHaveBeenCalledOnce();
        expect(execute.mock.calls[0]?.[0]).toEqual(action);
        expect(envelope).toEqual(before);
    });

    it('refuses a supplied-name digest mismatch before waiting or observing', async () => {
        const wait = holdSnapshotWait();
        const prepared: AddTrackAction = {
            type: 'addTrack',
            payload: { id: 'prepared-track', kind: 'midi', name: 'MIDI 7' },
        };
        const action: AddTrackAction = { ...prepared, payload: { ...prepared.payload, name: 'MIDI 8' } };
        const envelope = preparedTrackCommand(prepared);
        const materialize = vi.fn<(candidate: AddTrackAction) => void>();
        const execute = vi.fn<ActionHandler<AddTrackAction>['execute']>();
        const observe = vi.fn();
        registerHandlerMap({
            addTrack: {
                undoable: false,
                describe: () => ({ label: 'Prepared add' }),
                materializeCommandArgumentsAt: 'execution',
                materializeCommandArguments: materialize,
                execute,
            },
        });
        const execution = executeAppAction(action, { commandEnvelope: envelope, observeMaterializedAction: observe });
        const refusal = expect(execution).rejects.toThrow('Command envelope does not match action addTrack');
        try {
            const terminal = await Promise.race([
                refusal.then(() => 'refused' as const),
                wait.entered.then(() => 'waiting' as const),
            ]);
            expect(terminal).toBe('refused');
            expect(materialize).toHaveBeenCalledOnce();
            expect(wait.waitForSnapshotTransaction).not.toHaveBeenCalled();
            expect(observe).not.toHaveBeenCalled();
            expect(execute).not.toHaveBeenCalled();
        } finally {
            wait.release();
            await Promise.allSettled([execution, refusal]);
        }
        await refusal;
    });

    it('keeps authenticated Redo context and its canonical binding before the wait', async () => {
        const wait = holdSnapshotWait();
        const previousUndo = undoStore.value;
        const inverse: Action = { type: 'setEditingTool', payload: { tool: 'cut' } };
        const entry = createUndoEntry('Recorded tool', request, inverse);
        undoStore.set({ past: [], future: [entry] });
        const materialize = vi.fn<NonNullable<ActionHandler<Action>['materializeCommandArguments']>>((action) => {
            action.payload.tool = 'marquee';
        });
        const execute = vi.fn<ActionHandler<Action>['execute']>((action) => {
            expect(findPendingRedoEntry(action)).toBe(entry);
            return { status: 'written' };
        });
        registerHandlerMap({
            setEditingTool: handler({
                materializeCommandArgumentsAt: 'execution',
                materializeCommandArguments: materialize,
                execute,
            }),
        });
        const execution = executeAppAction(request, { skipUndo: true });
        try {
            await wait.entered;
            expect(materialize).toHaveBeenCalledOnce();
            const [canonical, context] = materialize.mock.calls[0] ?? [];
            expect(context?.recordedRedo?.inverseAction).toBe(inverse);
            expect(context?.recordedRedo?.isCurrent()).toBe(true);
            if (!canonical) {
                throw new Error('Expected the materialized Redo action before waiting');
            }
            expect(findPendingRedoEntry(canonical)).toBe(entry);
            expect(execute).not.toHaveBeenCalled();
        } finally {
            wait.release();
            await Promise.allSettled([execution]);
            undoStore.set(previousUndo);
        }
        await execution;
        expect(materialize).toHaveBeenCalledOnce();
        expect(execute).toHaveBeenCalledOnce();
        expect(request.payload.tool).toBe('select');
    });
});
