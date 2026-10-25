import { change, from } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { type ActionHandler, type HandlerCommitValidation } from '#/utils/handlerContract';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { AppActionCommittedError, AppActionConflictError } from '../../errors/AppActionExecutionError';
import { clearUndoHistory } from '../clearUndoHistory';
import { executeAppAction } from '../executeAppAction';
import { executeAppActionBatch } from '../executeAppActionBatch';
import { setActionHistoryMetadataPort } from '../actionHistoryMetadataPort';

type Document = { editingTool: { tool: string }; snapValue: { value: number } };
type Action = { type: 'setEditingTool'; payload: { tool: string } };
const action: Action = { type: 'setEditingTool', payload: { tool: 'draw' } };
const noMetadata = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function handler(execute: ActionHandler<Action>['execute']): ActionHandler<Action> {
    return {
        execute,
        describe: () => ({ label: 'Set tool' }),
        undoable: false,
        validate: () => true,
        requiresAbortCompensation: false,
    };
}

describe('handler commit validation through single and atomic Command routes', () => {
    let document = from<Document>({ editingTool: { tool: 'select' }, snapValue: { value: 1 } });
    let failAfterPublication = false;
    let tool = createAutomergeStorage<{ tool: string }>('root', 'editingTool');
    let snap = createAutomergeStorage<{ value: number }>('root', 'snapValue');
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        document = from<Document>({ editingTool: { tool: 'select' }, snapValue: { value: 1 } });
        failAfterPublication = false;
        configureAutomergeStoragePort({
            getDoc: () => document,
            hasDoc: () => true,
            getSemanticMessage: () => undefined,
            mutateDoc: ({ changeFn }) => {
                document = change(document, changeFn);
                if (failAfterPublication) {
                    throw new Error('publication observer rejected');
                }
            },
        });
        tool = createAutomergeStorage('root', 'editingTool');
        snap = createAutomergeStorage('root', 'snapValue');
        tool.hydrate?.();
        snap.hydrate?.();
        clearHandlerRegistry();
        clearUndoHistory();
        agentProjectRepairStateStore.set(null);
        setActionHistoryMetadataPort(noMetadata);
    });
    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        clearUndoHistory();
    });

    function proof(beforeCommit: () => string | null, validateDocument: HandlerCommitValidation['validateDocument']) {
        return { beforeCommit, documentId: 'root', validateDocument, release: vi.fn() };
    }

    it('reads the prospective single-action document and releases the returned guard', async () => {
        const validate = vi.fn((draft: Readonly<Record<string, unknown>>) =>
            JSON.stringify(draft.editingTool) === JSON.stringify({ tool: 'draw' }) ? null : 'missing tool'
        );
        const guard = proof(() => null, validate);
        registerHandlerMap({
            setEditingTool: handler(() => {
                tool.set({ tool: 'draw' });
                return { status: 'written', commitValidation: guard };
            }),
        });
        await executeAppAction(action);
        expect(validate).toHaveBeenCalledTimes(1);
        expect(document.editingTool.tool).toBe('draw');
        expect(guard.release).toHaveBeenCalledTimes(1);
    });

    it.each(['before', 'document'] as const)('classifies %s refusal and rolls back sibling slots', async (phase) => {
        const guard = proof(
            () => (phase === 'before' ? 'owner replaced' : null),
            () => (phase === 'document' ? 'missing owner' : null)
        );
        registerHandlerMap({
            setEditingTool: handler(() => {
                tool.set({ tool: 'draw' });
                snap.set({ value: 2 });
                return { status: 'written', commitValidation: guard };
            }),
        });
        await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionConflictError);
        expect(document).toEqual({ editingTool: { tool: 'select' }, snapValue: { value: 1 } });
        expect(tool.get()).toEqual({ tool: 'select' });
        expect(snap.get()).toEqual({ value: 1 });
        expect(guard.release).toHaveBeenCalledTimes(1);
    });

    it('composes guards for one root with the existing final batch postcondition', async () => {
        const first = proof(
            () => null,
            (draft) => (JSON.stringify(draft.editingTool) === JSON.stringify({ tool: 'draw' }) ? null : 'missing tool')
        );
        const second = proof(
            () => null,
            (draft) => (JSON.stringify(draft.snapValue) === JSON.stringify({ value: 2 }) ? null : 'missing snap')
        );
        registerHandlerMap({
            setEditingTool: handler(() => {
                tool.set({ tool: 'draw' });
                return { status: 'written', commitValidation: first };
            }),
            setSnapValue: {
                execute: () => {
                    snap.set({ value: 2 });
                    return { status: 'written', commitValidation: second };
                },
                describe: () => ({ label: 'Set snap' }),
                undoable: false,
                validate: () => true,
                requiresAbortCompensation: false,
            },
        });
        const final = vi.fn(() => null);
        const result = await executeAppActionBatch([action, { type: 'setSnapValue', payload: { value: 2 } }], {
            prepareValidation: () => ({ status: 'ready', postconditions: { documentId: 'root', validate: final } }),
        });
        expect(result.status).toBe('committed');
        expect(final).toHaveBeenCalledTimes(1);
        expect(first.release).toHaveBeenCalledTimes(1);
        expect(second.release).toHaveBeenCalledTimes(1);
        expect(document).toEqual({ editingTool: { tool: 'draw' }, snapValue: { value: 2 } });
    });

    it.each(['refusal', 'throw'] as const)('releases earlier guards and aborts on a later batch %s', async (kind) => {
        const guard = proof(
            () => null,
            () => null
        );
        registerHandlerMap({
            setEditingTool: handler(() => {
                tool.set({ tool: 'draw' });
                return { status: 'written', commitValidation: guard };
            }),
            setSnapValue: {
                execute: () => {
                    if (kind === 'throw') {
                        throw new Error('later handler rejected');
                    }
                    return { status: 'conflict' };
                },
                describe: () => ({ label: 'Set snap' }),
                undoable: false,
                validate: () => true,
                requiresAbortCompensation: false,
            },
        });
        const result = await executeAppActionBatch([action, { type: 'setSnapValue', payload: { value: 2 } }]);
        expect(result.status).toBe(kind === 'throw' ? 'failed' : 'conflicted');
        expect(guard.release).toHaveBeenCalledTimes(1);
        expect(document.editingTool.tool).toBe('select');
        expect(tool.get()).toEqual({ tool: 'select' });
    });
    it('releases its guard when publication commits and a later observer throws', async () => {
        const guard = proof(
            () => null,
            () => null
        );
        registerHandlerMap({
            setEditingTool: handler(() => {
                tool.set({ tool: 'draw' });
                return { status: 'written', commitValidation: guard };
            }),
        });
        failAfterPublication = true;
        await expect(executeAppAction(action)).rejects.toBeInstanceOf(AppActionCommittedError);
        expect(document.editingTool.tool).toBe('draw');
        expect(guard.release).toHaveBeenCalledTimes(1);
    });

    it('permits a legitimate already-absorbed non-creation delta', async () => {
        const guard = proof(
            () => null,
            (draft) => (JSON.stringify(draft.editingTool) === JSON.stringify({ tool: 'draw' }) ? null : 'missing tool')
        );
        registerHandlerMap({
            setEditingTool: handler(() => {
                tool.set({ tool: 'draw' });
                document = change(document, (draft) => {
                    draft.editingTool.tool = 'draw';
                });
                tool.hydrate?.();
                return { status: 'written', commitValidation: guard };
            }),
        });
        await executeAppAction(action);
        expect(document.editingTool.tool).toBe('draw');
        expect(tool.get()).toEqual({ tool: 'draw' });
        expect(guard.release).toHaveBeenCalledTimes(1);
    });
});
