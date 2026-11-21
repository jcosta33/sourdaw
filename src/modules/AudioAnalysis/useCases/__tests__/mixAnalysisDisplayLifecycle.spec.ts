import { describe, expect, it, vi } from 'vitest';

import { mixAnalysisDisplayLifecycle, setMixAnalysisDisplayLifecyclePort } from '../mixAnalysisDisplayLifecycle';

const registered = {
    begin: vi.fn((): number | null => 42),
    complete: vi.fn(),
    fail: vi.fn(),
};

describe('mixAnalysisDisplayLifecycle', () => {
    it('refuses every member before a lifecycle is registered, naming the member and the registrar', () => {
        expect(() => mixAnalysisDisplayLifecycle.begin()).toThrow(
            /setMixAnalysisDisplayLifecycle\(\) from #\/app\/bootstrap/
        );
        expect(() => mixAnalysisDisplayLifecycle.complete({ token: 1, result: {} as never })).toThrow(
            /^mixAnalysisDisplayLifecycle\.complete: /
        );
        expect(() => mixAnalysisDisplayLifecycle.fail({ token: 1 })).toThrow(/^mixAnalysisDisplayLifecycle\.fail: /);
    });

    it('delegates every member to the registered lifecycle', () => {
        setMixAnalysisDisplayLifecyclePort(registered);
        const result = { timestamp: 1, overallLevel: { peakDb: 0, rmsDb: -3 } } as never;

        expect(mixAnalysisDisplayLifecycle.begin()).toBe(42);
        mixAnalysisDisplayLifecycle.complete({ token: 7, result });
        mixAnalysisDisplayLifecycle.fail({ token: 99 });

        expect(registered.complete).toHaveBeenCalledExactlyOnceWith({ token: 7, result });
        expect(registered.fail).toHaveBeenCalledExactlyOnceWith({ token: 99 });
    });

    it('replaces the registered lifecycle on a second fill', () => {
        const replacement = { begin: vi.fn((): number | null => 7), complete: vi.fn(), fail: vi.fn() };
        setMixAnalysisDisplayLifecyclePort(replacement);

        expect(mixAnalysisDisplayLifecycle.begin()).toBe(7);
        expect(registered.begin).toHaveBeenCalledTimes(1);
    });
});
