import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { type ActionExecutionContext, type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { createEmptyTree } from '../../models/UndoTree';
import {
    clearActionReplayCapabilities,
    hasActionReplayCapability,
    registerActionReplayCapability,
} from '../../stores/actionReplayCapabilities';
import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { undoStore } from '../../stores/undoStore';
import { undoTreeStore } from '../../stores/undoTree';
import { clearUndoHistory } from '../clearUndoHistory';
import { executeAppAction } from '../executeAppAction';
import { getUndoRedoHandlers } from '../getUndoRedoHandlers';
import { runCommandTransitionExclusive } from '../runCommandTransitionExclusive';
import { runLegacyCommandMutation } from '../runLegacyCommandMutation';
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
        clearActionReplayCapabilities();
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
                if (!context?.runLegacyCommandMutation) {
                    throw new Error('Expected legacy Command mutation capability');
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

    it('lets an async handler commit legacy mutation and history through its exact owner', async () => {
        const composite_handler: ActionHandler<TogglePlaybackAction> = {
            undoable: false,
            execute: async (_action, context) => {
                if (!context?.runLegacyCommandMutation) {
                    throw new Error('Expected legacy Command mutation capability');
                }
                await Promise.resolve();
                await context.runLegacyCommandMutation((commitUndo) => {
                    const previous = value;
                    value = 4;
                    commitUndo(
                        'Async handler legacy edit',
                        () => {
                            value = previous;
                        },
                        () => {
                            value = 4;
                        }
                    );
                });
            },
            describe: () => ({ label: 'Composite action' }),
        };
        registerHandlerMap({ togglePlayback: composite_handler });

        const settled = await Promise.race([
            executeAppAction({ type: 'togglePlayback' }).then(() => true),
            new Promise<false>((resolve) => {
                setTimeout(() => resolve(false), 100);
            }),
        ]);

        expect(settled).toBe(true);
        expect(value).toBe(4);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]?.label).toBe('Async handler legacy edit');
    });

    it('rejects a stale nested mutation capability after its exact owner settles', async () => {
        type LegacyRunner = NonNullable<ActionExecutionContext['runLegacyCommandMutation']>;
        let capture_runner!: (runner: LegacyRunner) => void;
        const captured_runner = new Promise<LegacyRunner>((resolve) => {
            capture_runner = resolve;
        });
        const capture_handler: ActionHandler<TogglePlaybackAction> = {
            undoable: false,
            execute: (_action, context) => {
                if (!context?.runLegacyCommandMutation) {
                    throw new Error('Expected legacy Command mutation capability');
                }
                capture_runner(context.runLegacyCommandMutation);
            },
            describe: () => ({ label: 'Capture owner' }),
        };
        registerHandlerMap({ togglePlayback: capture_handler });

        await executeAppAction({ type: 'togglePlayback' });
        const stale_runner = await captured_runner;
        const replacement = executeAppAction({ type: 'setSnapValue', payload: { value: gated_value } });
        await inverse_started;

        await expect(
            stale_runner(() => {
                value = 99;
            })
        ).rejects.toThrow('owner');

        expect(value).toBe(0);
        release_inverse();
        await replacement;
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

    it('revokes replay authority while preserving audit metadata when a transition resets history', async () => {
        registerActionReplayCapability({
            entryId: 'old-arrangement-entry',
            inverseAction: { type: 'togglePlayback' },
            metadata: {
                id: 'old-arrangement-entry',
                label: 'Old arrangement action',
                actionKind: 'togglePlayback',
                source: 'manual',
                timestamp: 10,
            },
        });

        await runCommandTransitionExclusive((resetHistory) => {
            resetHistory();
            return Promise.resolve();
        });

        expect(hasActionReplayCapability('old-arrangement-entry')).toBe(false);
    });

    it('queues a complete legacy mutation behind an in-flight async undo', async () => {
        await executeAppAction({ type: 'setSnapValue', payload: { value: 1 } });
        const undoing = undo();
        await inverse_started;

        let legacy_settled = false;
        const legacy = runLegacyCommandMutation((commitUndo) => {
            const previous = value;
            value = 2;
            commitUndo(
                'Legacy snap edit',
                () => {
                    value = previous;
                },
                () => {
                    value = 2;
                }
            );
        }).then(() => {
            legacy_settled = true;
            return undefined;
        });

        await Promise.resolve();
        expect(value).toBe(1);
        expect(legacy_settled).toBe(false);

        release_inverse();
        await Promise.all([undoing, legacy]);

        expect(value).toBe(2);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]?.label).toBe('Legacy snap edit');
    });

    it('awaits detached replay work without publishing nested legacy history', async () => {
        let release_nested!: () => void;
        const nested_gate = new Promise<void>((resolve) => {
            release_nested = resolve;
        });
        let mark_nested_started!: () => void;
        const nested_started = new Promise<void>((resolve) => {
            mark_nested_started = resolve;
        });

        await runLegacyCommandMutation((commitUndo) => {
            value = 1;
            commitUndo(
                'Outer legacy edit',
                (runReplayMutation) => {
                    void runReplayMutation(async (commitNestedUndo) => {
                        mark_nested_started();
                        await nested_gate;
                        value = 0;
                        commitNestedUndo(
                            'Nested inverse',
                            () => {
                                value = 1;
                            },
                            () => {
                                value = 0;
                            }
                        );
                    });
                },
                () => {
                    value = 1;
                }
            );
        });

        let undo_settled = false;
        const undoing = undo().then(() => {
            undo_settled = true;
            return undefined;
        });
        await nested_started;
        await Promise.resolve();

        expect(undo_settled).toBe(false);
        release_nested();
        await undoing;

        expect(value).toBe(0);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(1);
        expect(undoStore.value?.future[0]?.label).toBe('Outer legacy edit');
    });

    it('drains more than twelve thousand synchronous failures without recursion or a wedged owner', async () => {
        let release_first!: () => void;
        const first_gate = new Promise<void>((resolve) => {
            release_first = resolve;
        });
        const first = runCommandTransitionExclusive(async () => {
            await first_gate;
        });
        const failures = Array.from({ length: 12_001 }, (_, index) =>
            runCommandTransitionExclusive(() => {
                throw new Error(`failure-${index}`);
            })
        );
        const final = runCommandTransitionExclusive(() => Promise.resolve('drained'));

        release_first();
        await first;
        const results = await Promise.allSettled(failures);

        expect(results.every((result) => result.status === 'rejected')).toBe(true);
        await expect(final).resolves.toBe('drained');
        await expect(runCommandTransitionExclusive(() => Promise.resolve('still-live'))).resolves.toBe('still-live');
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
