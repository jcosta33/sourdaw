import { describe, it, expect, vi, beforeEach } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { shortcutStore } from '../../stores/shortcutStore';
import { executeAppAction } from '../executeAppAction';

import type { ActionHandler, AppAction } from '../commandQueries';

const mocks = vi.hoisted(() => ({
    logger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        setWriters: vi.fn(),
    },
    setSemanticContext: vi.fn(),
    clearSemanticContext: vi.fn(),
    pushActionHistoryEntry: vi.fn(),
    pushUndo: vi.fn(),
    recordAction: vi.fn(),
    mockHandler: {
        execute: vi.fn(),
        describe: vi.fn(() => ({ label: 'Mock Label' })),
        undoable: true,
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mocks.logger }));

vi.mock('#/modules/CrdtDocument/stores', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    pushActionHistoryEntry: mocks.pushActionHistoryEntry,
    setSemanticContext: mocks.setSemanticContext,
    clearSemanticContext: mocks.clearSemanticContext,
}));

vi.mock('../../stores/undoStore', () => ({
    pushUndo: mocks.pushUndo,
    undoStore: { value: {} },
}));

vi.mock('../macro/recording/recordAction', () => ({ recordAction: mocks.recordAction }));

describe('executeAppAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        registerHandlerMap({ testAction: mocks.mockHandler as any });
    });

    it('logs error if no handler is found', async () => {
        clearHandlerRegistry();
        await executeAppAction({ type: 'unknownAction', payload: {} } as any);
        expect(mocks.logger.error).toHaveBeenCalled();
    });

    it('executes a registered handler', async () => {
        await executeAppAction({ type: 'testAction', payload: { foo: 'bar' } } as any);

        expect(mocks.mockHandler.execute).toHaveBeenCalledWith({ type: 'testAction', payload: { foo: 'bar' } });
        expect(mocks.setSemanticContext).toHaveBeenCalledWith(expect.objectContaining({ message: 'Mock Label' }));
        expect(mocks.pushUndo).toHaveBeenCalled();
        expect(mocks.pushActionHistoryEntry).toHaveBeenCalled();
    });

    it('should log and rethrow rejected registered handlers without recording side effects', async () => {
        const action: AppAction = { type: 'toggleSidebar' };
        const cause = new Error('handler failed');
        clearHandlerRegistry();
        registerHandlerMap({ [action.type]: mocks.mockHandler });
        mocks.mockHandler.execute.mockRejectedValueOnce(cause);

        await expect(executeAppAction(action)).rejects.toBe(cause);

        const reported_error = mocks.logger.error.mock.calls[0]?.[0];
        expect(reported_error).toBeInstanceOf(Error);
        expect(reported_error?.message).toContain(action.type);
        expect(reported_error?.cause).toBe(cause);
        expect(mocks.clearSemanticContext).toHaveBeenCalledOnce();
        expect(mocks.recordAction).not.toHaveBeenCalled();
        expect(mocks.pushActionHistoryEntry).not.toHaveBeenCalled();
        expect(mocks.pushUndo).not.toHaveBeenCalled();
    });

    // Dispatch-ordering invariant. `executeAppAction` documents that, for an
    // undoable action, `describe()` must run BEFORE `execute()` so it can snapshot
    // pre-mutation state for destructive inverses (restoreTrack/restoreClip), and
    // the undo + action-history records must be pushed AFTER `execute()` resolves
    // (so an `await`ed async handler has actually committed before the entry is
    // recorded). A handler that re-ordered these — or pushed undo before awaiting —
    // would corrupt destructive undo without any other test catching it.
    it('runs describe() before execute(), and records undo/history only after execute() resolves', async () => {
        const order: string[] = [];
        const orderedHandler: ActionHandler = {
            undoable: true,
            describe: () => {
                order.push('describe');
                return { label: 'Ordered' };
            },
            execute: async () => {
                order.push('execute:start');
                await Promise.resolve();
                order.push('execute:end');
            },
        };
        clearHandlerRegistry();
        registerHandlerMap({ orderedAction: orderedHandler });
        mocks.pushUndo.mockImplementation(() => order.push('pushUndo'));
        mocks.pushActionHistoryEntry.mockImplementation(() => order.push('pushActionHistoryEntry'));

        // `orderedAction` is a synthetic, test-only discriminant — cast through
        // `AppAction` the same way this suite's other synthetic actions are.
        await executeAppAction({ type: 'orderedAction', payload: {} } as unknown as AppAction);

        // describe is the first thing recorded (snapshot before mutation)…
        expect(order[0]).toBe('describe');
        // …execute runs to completion before either record is pushed…
        expect(order.indexOf('execute:end')).toBeLessThan(order.indexOf('pushUndo'));
        expect(order.indexOf('execute:end')).toBeLessThan(order.indexOf('pushActionHistoryEntry'));
        // …and describe never runs after execute started.
        expect(order.indexOf('describe')).toBeLessThan(order.indexOf('execute:start'));
    });
});

// Shortcut-conflict guard over the hand-authored default shortcut definitions.
// The maintainers already police this by hand — a dead duplicate `Escape`
// binding was deliberately removed (see shortcutStore comment) because
// `handleKeydown` returns on the first matching definition, making any later
// duplicate combo unreachable. This test locks that invariant in.
//
// The generated Loop-Station pad grid (`loopStation.*`) is excluded: those pads
// deliberately reuse single-letter keys (e.g. `m`, `r`, `g`) but are resolved
// through a separate, mode-gated path (`parseLoopStationPadCallbackId`), not the
// first-match `matches()` scan the core shortcuts share.
describe('INITIAL_DEFINITIONS shortcut conflicts', () => {
    it('has no two core (non-loop-station) definitions bound to the same key combo', () => {
        const definitions = shortcutStore.value?.definitions ?? [];
        const core = definitions.filter((def) => !def.id.startsWith('loopStation.'));
        expect(core.length).toBeGreaterThan(0);

        const owners = new Map<string, string>();
        const conflicts: Array<{ combo: string; first: string; second: string }> = [];
        for (const def of core) {
            for (const combo of def.defaultKeys) {
                const normalized = combo.toLowerCase();
                const existing = owners.get(normalized);
                if (existing !== undefined) {
                    conflicts.push({ combo: normalized, first: existing, second: def.id });
                } else {
                    owners.set(normalized, def.id);
                }
            }
        }

        expect(conflicts).toEqual([]);
    });
});
