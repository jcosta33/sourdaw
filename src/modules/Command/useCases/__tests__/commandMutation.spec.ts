import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { createEmptyTree } from '../../models/UndoTree';
import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { undoStore } from '../../stores/undoStore';
import { undoTreeStore } from '../../stores/undoTree';
import { clearUndoHistory } from '../clearUndoHistory';
import { executeAppAction } from '../executeAppAction';
import { getUndoRedoHandlers } from '../getUndoRedoHandlers';
import { runCommandTransitionExclusive } from '../runCommandTransitionExclusive';
import { undo } from '../undo';
import { undoToIndex } from '../undoToIndex';

type SetSnapValueAction = Extract<AppAction, { type: 'setSnapValue' }>;
type TogglePlaybackAction = Extract<AppAction, { type: 'togglePlayback' }>;

describe('commandMutation', () => {
    let value = 0;
    let gated_value = 0;
    let release_inverse!: () => void;
    let inverse_started!: Promise<void>;

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        clearUndoHistory();
        undoTreeStore.set({ tree: createEmptyTree(), enabled: true });
        value = 0;
        gated_value = 0;

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
                if (action.payload.value === gated_value) {
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

    it('resets linear and tree history inside one exclusive transition', async () => {
        await executeAppAction({ type: 'setSnapValue', payload: { value: 1 } });
        expect(undoStore.value?.past).toHaveLength(1);
        expect(Object.keys(undoTreeStore.value?.tree.nodes ?? {})).toHaveLength(1);

        await runCommandTransitionExclusive((resetHistory) => {
            resetHistory();
            return Promise.resolve();
        });

        expect(undoStore.value).toEqual({ past: [], future: [] });
        expect(undoTreeStore.value?.tree.nodes).toEqual({});
        expect(undoTreeStore.value?.tree.currentNodeId).toBeNull();
    });

    it('holds one mutation lease while navigating to a history unit so a concurrent edit is not consumed', async () => {
        gated_value = Number.NaN;
        await executeAppAction({ type: 'setSnapValue', payload: { value: 1 } });
        await executeAppAction({ type: 'setSnapValue', payload: { value: 2 } });
        await executeAppAction({ type: 'setSnapValue', payload: { value: 3 } });
        gated_value = 2;

        const targetEntryId = undoStore.value?.past[0]?.id;
        if (!targetEntryId) {
            throw new Error('Expected a stable target history entry');
        }
        const moving = undoToIndex(`entry:${targetEntryId}`);
        await inverse_started;
        const concurrent = executeAppAction({ type: 'setSnapValue', payload: { value: 9 } });

        release_inverse();
        await Promise.all([moving, concurrent]);

        expect(value).toBe(9);
        expect(undoStore.value?.past.map((entry) => (entry.kind === 'action' ? entry.action : null))).toEqual([
            { type: 'setSnapValue', payload: { value: 1 } },
            { type: 'setSnapValue', payload: { value: 9 } },
        ]);
        expect(undoStore.value?.future).toEqual([]);
    });

    it.each(['undo', 'redo'] as const)(
        'settles the real %s AppAction and a following action without re-entering the queue',
        async (history_action) => {
            gated_value = Number.NaN;
            registerHandlerMap(getUndoRedoHandlers());
            await executeAppAction({ type: 'setSnapValue', payload: { value: 1 } });
            if (history_action === 'redo') {
                await undo();
            }

            const queued_actions = Promise.all([
                executeAppAction({ type: history_action }),
                executeAppAction({ type: 'setSnapValue', payload: { value: 2 } }),
            ]).then(() => 'settled' as const);
            const bounded_result = await Promise.race([
                queued_actions,
                new Promise<'timed-out'>((resolve) => {
                    setTimeout(() => resolve('timed-out'), 100);
                }),
            ]);

            expect(bounded_result).toBe('settled');
            expect(value).toBe(2);
            expect(undoStore.value?.past.at(-1)).toMatchObject({
                kind: 'action',
                action: { type: 'setSnapValue', payload: { value: 2 } },
            });
            expect(undoStore.value?.future).toEqual([]);
        }
    );
});
