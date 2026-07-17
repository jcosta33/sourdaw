import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createHmrPersistentState } from '../createHmrPersistentState';

type TestState = {
    counter: number;
    label: string;
};

describe('createHmrPersistentState', () => {
    beforeEach(() => {
        // Each test starts with a fresh simulated `hot.data` so the
        // assertions are independent.
        if (import.meta.hot) {
            (import.meta.hot as { data: Record<string, unknown> }).data = {};
        }
    });

    it('returns a freshly-constructed state on first call', () => {
        const factory = vi.fn(
            (): TestState => ({
                counter: 7,
                label: 'first',
            })
        );

        const state = createHmrPersistentState<TestState>('test.first', factory);

        expect(factory).toHaveBeenCalledTimes(1);
        expect(state).toEqual({ counter: 7, label: 'first' });
    });

    it('returns the same object reference on subsequent calls with the same key', () => {
        const factory = vi.fn((): TestState => ({ counter: 0, label: 'persisted' }));

        const first = createHmrPersistentState<TestState>('test.persisted', factory);
        first.counter = 42;
        const second = createHmrPersistentState<TestState>('test.persisted', factory);

        expect(second).toBe(first);
        expect(second.counter).toBe(42);
        expect(factory).toHaveBeenCalledTimes(1);
    });

    it('isolates state between different keys', () => {
        const a = createHmrPersistentState<TestState>('test.a', () => ({ counter: 1, label: 'a' }));
        const b = createHmrPersistentState<TestState>('test.b', () => ({ counter: 2, label: 'b' }));

        expect(a).not.toBe(b);
        expect(a.label).toBe('a');
        expect(b.label).toBe('b');
    });

    it('survives a simulated module re-evaluation', () => {
        // "First evaluation" — we look up the state and mutate it to track
        // some in-flight work (a fake worker id, say).
        const firstEval = createHmrPersistentState<TestState>('test.reevaluated', () => ({
            counter: 0,
            label: 'initial',
        }));
        firstEval.counter = 99;
        firstEval.label = 'in-flight';

        // Simulate HMR re-evaluating the same module. In real Vite this
        // runs the module factory top-to-bottom again — the key point is
        // that `import.meta.hot.data` is NOT cleared between runs.
        const factory = vi.fn((): TestState => ({ counter: 0, label: 'should-not-run' }));
        const secondEval = createHmrPersistentState<TestState>('test.reevaluated', factory);

        expect(factory).not.toHaveBeenCalled();
        expect(secondEval).toBe(firstEval);
        expect(secondEval.counter).toBe(99);
        expect(secondEval.label).toBe('in-flight');
    });

    it('tolerates an undefined `hot.data` on first call', () => {
        // Vitest's simulated hot context leaves `hot.data` undefined by
        // default (the Vite dev server initialises it to `{}` but the
        // spec'd type allows undefined until written). The helper must
        // still construct and return the state without throwing — and
        // subsequent calls with the same key must stay persistent.
        if (import.meta.hot) {
            (import.meta.hot as { data: unknown }).data = undefined;
        }

        const first = createHmrPersistentState<TestState>('test.undefinedData', () => ({
            counter: 1,
            label: 'ok',
        }));
        first.counter = 5;
        const second = createHmrPersistentState<TestState>('test.undefinedData', () => ({
            counter: 99,
            label: 'replaced',
        }));

        expect(first).toEqual({ counter: 5, label: 'ok' });
        expect(second).toBe(first);
        expect(second.counter).toBe(5);
    });
});
