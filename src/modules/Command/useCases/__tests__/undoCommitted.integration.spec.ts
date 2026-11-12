import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { AppActionCommittedError } from '../../errors/AppActionExecutionError';
import { type ActionUndoEntry } from '../../models/UndoEntry';
import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { undoStore } from '../../stores/undoStore';
import { redo } from '../redo';
import { undo } from '../undo';

// Keep the real dispatch, undo orchestration and history. Runtime handlers are
// injected at the registry boundary and expose whether their inverse applied.
describe('undo and redo committed notifications through real dispatch', () => {
    let applied: number;
    let noWrite: boolean;
    let postCommitError: Error | null;
    let reconciliationError: Error | null;

    const entry: ActionUndoEntry = {
        kind: 'action',
        id: 'entry',
        label: 'Applied action',
        timestamp: 0,
        source: 'manual',
        action: { type: 'toggleMetronome' },
        inverseAction: { type: 'toggleMetronome' },
    };
    const conflict: ActionUndoEntry = {
        ...entry,
        id: 'conflict',
        label: 'Conflicting action',
        action: { type: 'toggleRecording' },
        inverseAction: { type: 'toggleRecording' },
    };

    beforeEach(() => {
        setNotificationEventBus({ emit: async () => undefined, on: () => () => undefined });
        applied = 0;
        noWrite = false;
        postCommitError = null;
        reconciliationError = null;
        clearHandlerRegistry();
        undoStore.set({ past: [], future: [] });
        registerHandlerMap({
            toggleMetronome: {
                executionKind: 'runtime',
                undoable: false,
                canReportConflict: true,
                describe: () => ({ label: 'Apply runtime state' }),
                afterRedoReplay: () => {
                    if (reconciliationError) {
                        throw reconciliationError;
                    }
                },
                execute: () => {
                    if (noWrite) {
                        return { status: 'no-write' };
                    }
                    applied += 1;
                    const error = postCommitError;
                    if (error !== null) {
                        return {
                            status: 'written',
                            afterRuntimeExecution: () => {
                                throw error;
                            },
                        };
                    }
                    return { status: 'written' };
                },
            },
            toggleRecording: {
                executionKind: 'runtime',
                undoable: false,
                canReportConflict: true,
                describe: () => ({ label: 'Refused runtime state' }),
                execute: () => ({ status: 'conflict' }),
            },
        });
    });

    afterEach(() => {
        clearHandlerRegistry();
        undoStore.set({ past: [], future: [] });
    });

    it.each(['undo', 'redo'] as const)(
        'does not notify for a %s inverse/replay that writes nothing',
        async (direction) => {
            noWrite = true;
            undoStore.set(direction === 'undo' ? { past: [entry], future: [] } : { past: [], future: [entry] });
            const onCommitted = vi.fn();
            await (direction === 'undo' ? undo({ onCommitted }) : redo({ onCommitted }));
            expect(applied).toBe(0);
            expect(onCommitted).not.toHaveBeenCalled();
            // Preserve existing stack consumption even when the handler is a no-op.
            expect(undoStore.value).toEqual(
                direction === 'undo' ? { past: [], future: [entry] } : { past: [entry], future: [] }
            );
        }
    );

    it.each(['undo', 'redo'] as const)(
        'notifies once for an older %s while retaining the conflicted original head',
        async (direction) => {
            let before: { past: ActionUndoEntry[]; future: ActionUndoEntry[] };
            if (direction === 'undo') {
                before = { past: [entry, conflict], future: [] };
            } else {
                before = { past: [], future: [conflict, entry] };
            }
            const after =
                direction === 'undo' ? { past: [conflict], future: [entry] } : { past: [entry], future: [conflict] };
            undoStore.set(before);
            const onCommitted = vi.fn(() => {
                expect(applied).toBe(1);
                expect(undoStore.value).toEqual(after);
            });
            if (direction === 'undo') {
                await expect(undo({ onCommitted })).resolves.toEqual({ headConsumed: false });
            } else {
                await expect(redo({ onCommitted })).resolves.toBeUndefined();
            }
            expect(onCommitted).toHaveBeenCalledOnce();
        }
    );

    it.each(['undo', 'redo'] as const)(
        'does not notify when the older %s beneath a retained conflict writes nothing',
        async (direction) => {
            noWrite = true;
            undoStore.set(
                direction === 'undo' ? { past: [entry, conflict], future: [] } : { past: [], future: [conflict, entry] }
            );
            const onCommitted = vi.fn();
            await (direction === 'undo' ? undo({ onCommitted }) : redo({ onCommitted }));
            expect(applied).toBe(0);
            expect(onCommitted).not.toHaveBeenCalled();
            expect(undoStore.value).toEqual(
                direction === 'undo' ? { past: [conflict], future: [entry] } : { past: [entry], future: [conflict] }
            );
        }
    );

    it.each(['undo', 'redo'] as const)('does not notify a refused or empty %s', async (direction) => {
        const before = direction === 'undo' ? { past: [conflict], future: [] } : { past: [], future: [conflict] };
        undoStore.set(before);
        const onCommitted = vi.fn();
        await (direction === 'undo' ? undo({ onCommitted }) : redo({ onCommitted }));
        expect(undoStore.value).toEqual(before);
        undoStore.set({ past: [], future: [] });
        await (direction === 'undo' ? undo({ onCommitted }) : redo({ onCommitted }));
        expect(applied).toBe(0);
        expect(onCommitted).not.toHaveBeenCalled();
    });

    it('does not count a no-write redo when its reconciliation reports a committed error', async () => {
        noWrite = true;
        reconciliationError = new Error('Reconciliation failed after no-write replay');
        undoStore.set({ past: [], future: [entry] });
        const onCommitted = vi.fn();
        await expect(redo({ onCommitted })).rejects.toMatchObject({ cause: reconciliationError });
        expect(applied).toBe(0);
        expect(onCommitted).not.toHaveBeenCalled();
        expect(undoStore.value).toEqual({ past: [entry], future: [] });
    });

    it.each(['undo', 'redo'] as const)(
        'notifies for a committed %s but preserves its post-commit rejection',
        async (direction) => {
            postCommitError = new Error('Applied runtime effect failed');
            undoStore.set(direction === 'undo' ? { past: [entry], future: [] } : { past: [], future: [entry] });
            const onCommitted = vi.fn(() => {
                throw new Error('Observer failed too');
            });
            const result = direction === 'undo' ? undo({ onCommitted }) : redo({ onCommitted });
            await expect(result).rejects.toBeInstanceOf(AppActionCommittedError);
            await expect(result).rejects.toMatchObject({ cause: postCommitError });
            expect(applied).toBe(1);
            expect(onCommitted).toHaveBeenCalledOnce();
            expect(undoStore.value).toEqual(
                direction === 'undo' ? { past: [], future: [entry] } : { past: [entry], future: [] }
            );
        }
    );
});
