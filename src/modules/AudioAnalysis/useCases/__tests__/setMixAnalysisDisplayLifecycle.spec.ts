import { describe, it, expect, afterEach, vi } from 'vitest';

import { mixAnalysisDisplayLifecycle } from '../mixAnalysisDisplayLifecycle';
import { setMixAnalysisDisplayLifecycle } from '../setMixAnalysisDisplayLifecycle';

const empty_result: Parameters<typeof mixAnalysisDisplayLifecycle.complete>[0]['result'] = {
    timestamp: 1,
    overallLevel: { peakDb: -6, rmsDb: -12 },
    frequencyBalance: {
        sub: -80,
        bass: -70,
        lowMid: -60,
        mid: -50,
        highMid: -55,
        high: -65,
    },
    trackLevels: [],
    issues: [],
    suggestions: [],
};

const fallback_lifecycle = {
    begin: (): number | null => null,
    complete: (): void => {},
    fail: (): void => {},
};

describe('setMixAnalysisDisplayLifecycle', () => {
    afterEach(() => {
        setMixAnalysisDisplayLifecycle(fallback_lifecycle);
    });

    it('should route display lifecycle calls through the configured port', () => {
        const lifecycle = {
            begin: vi.fn<() => number | null>(() => 3),
            complete: vi.fn<(input: { token: number; result: typeof empty_result }) => void>(),
            fail: vi.fn<(input: { token: number }) => void>(),
        };

        setMixAnalysisDisplayLifecycle(lifecycle);

        expect(mixAnalysisDisplayLifecycle.begin()).toBe(3);
        mixAnalysisDisplayLifecycle.complete({ token: 3, result: empty_result });
        mixAnalysisDisplayLifecycle.fail({ token: 3 });

        expect(lifecycle.begin).toHaveBeenCalledTimes(1);
        expect(lifecycle.complete).toHaveBeenCalledWith({ token: 3, result: empty_result });
        expect(lifecycle.fail).toHaveBeenCalledWith({ token: 3 });
    });
});
