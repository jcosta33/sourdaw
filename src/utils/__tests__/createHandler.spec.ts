import { describe, expect, it, vi } from 'vitest';

import { createHandler } from '../createHandler';

describe('createHandler', () => {
    it('should return an ActionHandler that forwards execute and describe', () => {
        const execute = vi.fn();
        const describe = vi.fn(() => ({ label: 'Set tempo' }));
        const handler = createHandler<'setTempo'>({
            undoable: true,
            execute,
            describe,
        });

        expect(handler.undoable).toBe(true);
        expect(handler.batchExecution).toBe('singleton');
        expect(handler.batchRestriction).toBe('missing-validation');

        const action = { type: 'setTempo' as const, payload: { bpm: 120 } };
        void handler.execute(action);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledWith(action);

        expect(handler.describe(action)).toEqual({ label: 'Set tempo' });
        expect(describe).toHaveBeenCalledWith(action);
    });

    it('keeps only handlers with explicit side-effect-free validation batchable', () => {
        const handler = createHandler<'setTempo'>({
            undoable: true,
            execute: vi.fn(),
            describe: () => ({ label: 'Set tempo' }),
            validate: () => true,
        });

        expect(handler.batchExecution).toBeUndefined();
        expect(handler.batchRestriction).toBeUndefined();
    });

    it('distinguishes an explicit domain singleton from a missing validator', () => {
        const handler = createHandler<'setTempo'>({
            undoable: true,
            execute: vi.fn(),
            describe: () => ({ label: 'Set tempo' }),
            batchExecution: 'singleton',
        });

        expect(handler.batchExecution).toBe('singleton');
        expect(handler.batchRestriction).toBe('domain-singleton');
    });
});
