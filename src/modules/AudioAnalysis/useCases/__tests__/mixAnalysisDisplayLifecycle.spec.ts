import { afterEach, describe, expect, it, vi } from 'vitest';

import { mixAnalysisDisplayLifecycle, setMixAnalysisDisplayLifecyclePort } from '../mixAnalysisDisplayLifecycle';

const noopPort = {
    begin: () => null,
    complete: () => {},
    fail: () => {},
};

describe('mixAnalysisDisplayLifecycle', () => {
    afterEach(() => {
        setMixAnalysisDisplayLifecyclePort(noopPort);
    });

    describe('default noop port', () => {
        it('begin returns null', () => {
            expect(mixAnalysisDisplayLifecycle.begin()).toBeNull();
        });

        it('complete and fail do not throw', () => {
            expect(() => mixAnalysisDisplayLifecycle.complete({ token: 1, result: {} as never })).not.toThrow();
            expect(() => mixAnalysisDisplayLifecycle.fail({ token: 1 })).not.toThrow();
        });
    });

    describe('swapped port', () => {
        it('begin delegates to the swapped implementation and returns its token', () => {
            const beginFn = vi.fn(() => 42);
            setMixAnalysisDisplayLifecyclePort({
                begin: beginFn,
                complete: () => {},
                fail: () => {},
            });

            const token = mixAnalysisDisplayLifecycle.begin();

            expect(beginFn).toHaveBeenCalledTimes(1);
            expect(token).toBe(42);
        });

        it('complete delegates with token and result', () => {
            const completeFn = vi.fn();
            setMixAnalysisDisplayLifecyclePort({ begin: () => null, complete: completeFn, fail: () => {} });

            const result = { timestamp: 1, overallLevel: { peakDb: 0, rmsDb: -3 } } as never;
            mixAnalysisDisplayLifecycle.complete({ token: 7, result });

            expect(completeFn).toHaveBeenCalledWith({ token: 7, result });
        });

        it('fail delegates with token', () => {
            const failFn = vi.fn();
            setMixAnalysisDisplayLifecyclePort({ begin: () => null, complete: () => {}, fail: failFn });

            mixAnalysisDisplayLifecycle.fail({ token: 99 });

            expect(failFn).toHaveBeenCalledWith({ token: 99 });
        });

        it('second swap replaces the first', () => {
            const first = vi.fn(() => 1);
            const second = vi.fn(() => 2);
            setMixAnalysisDisplayLifecyclePort({ begin: first, complete: () => {}, fail: () => {} });
            setMixAnalysisDisplayLifecyclePort({ begin: second, complete: () => {}, fail: () => {} });

            const token = mixAnalysisDisplayLifecycle.begin();

            expect(first).not.toHaveBeenCalled();
            expect(token).toBe(2);
        });
    });
});
