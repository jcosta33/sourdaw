import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { createEmptyTree } from '../../models/UndoTree';
import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { undoStore } from '../../stores/undoStore';
import { undoTreeStore } from '../../stores/undoTree';
import { clearUndoHistory } from '../clearUndoHistory';
import { executeAppAction } from '../executeAppAction';
import { undo } from '../undo';

type SetSnapValueAction = Extract<AppAction, { type: 'setSnapValue' }>;
type TogglePlaybackAction = Extract<AppAction, { type: 'togglePlayback' }>;

describe('commandMutation', () => {
    let value = 0;
    let release_inverse!: () => void;
    let inverse_started!: Promise<void>;

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        clearUndoHistory();
        undoTreeStore.set({ tree: createEmptyTree(), enabled: true });
        value = 0;

        let mark_inverse_started!: () => void;
        inverse_started = new Promise<void>((resolve) => {
            mark_inverse_started = resolve;
        });
        const inverse_gate = new Promise<void>((resolve) => {
            release_inverse = resolve;
        });
        const handler: ActionHandler<SetSnapValueAction> = {
            undoable: true,
            execute: async (action) => {
                if (action.payload.value === 0) {
                    mark_inverse_started();
                    await inverse_gate;
                }
                value = action.payload.value;
            },
            describe: () => ({
                label: 'Set snap value',
                inverseAction: { type: 'setSnapValue', payload: { value } },
            }),
        };
        registerHandlerMap({ setSnapValue: handler });
    });

    afterEach(() => {
        release_inverse();
        clearUndoHistory();
        clearHandlerRegistry();
        undoTreeStore.set({ tree: createEmptyTree(), enabled: false });
        configureAutomergeStoragePort(null);
    });

    it('keeps domain, linear history, and undo tree coherent across a concurrent action during undo', async () => {
        await executeAppAction({ type: 'setSnapValue', payload: { value: 1 } });

        const undoing = undo();
        await inverse_started;
        let concurrent_settled = false;
        const concurrent = executeAppAction({ type: 'setSnapValue', payload: { value: 2 } }).then(() => {
            concurrent_settled = true;
            return undefined;
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(concurrent_settled).toBe(false);
        release_inverse();
        await Promise.all([undoing, concurrent]);

        expect(value).toBe(2);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toEqual([]);
        const current_node_id = undoTreeStore.value?.tree.currentNodeId;
        expect(current_node_id).not.toBeNull();
        const tree_entry = current_node_id ? undoTreeStore.value?.tree.nodes[current_node_id]?.entry : undefined;
        expect(tree_entry).toBe(undoStore.value?.past[0]);
        expect(tree_entry?.kind).toBe('action');
        if (tree_entry?.kind !== 'action') {
            throw new Error('Expected current undo-tree entry to be an action');
        }
        expect(tree_entry.action).toEqual({ type: 'setSnapValue', payload: { value: 2 } });
    });

    it('runs nested handler dispatch inside the owning mutation without reacquiring the lock', async () => {
        const composite_handler: ActionHandler<TogglePlaybackAction> = {
            undoable: false,
            execute: async (_action, context) => {
                if (!context) {
                    throw new Error('Expected Command execution context');
                }
                await context.executeAppAction({ type: 'setSnapValue', payload: { value: 3 } });
            },
            describe: () => ({ label: 'Composite action' }),
        };
        registerHandlerMap({ togglePlayback: composite_handler });

        await executeAppAction({ type: 'togglePlayback' });

        expect(value).toBe(3);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toEqual([]);
    });
});
