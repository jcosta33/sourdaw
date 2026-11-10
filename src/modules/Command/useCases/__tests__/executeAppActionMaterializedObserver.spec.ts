import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { AppActionConflictError } from '../../errors/AppActionExecutionError';
import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { executeAppAction } from '../executeAppAction';
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
});
