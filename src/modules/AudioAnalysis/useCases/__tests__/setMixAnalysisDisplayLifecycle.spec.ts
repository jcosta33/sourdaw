import { describe, it, expect, afterEach, vi } from 'vitest';

import { mixAnalysisDisplayLifecycle } from '../../handlers/analysis/mixAnalysisDisplayLifecycle';
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
    begin: (): boolean => false,
    complete: (): void => {},
    fail: (): void => {},
};

describe('setMixAnalysisDisplayLifecycle', () => {
    afterEach(() => {
        setMixAnalysisDisplayLifecycle(fallback_lifecycle);
    });

    it('should route display lifecycle calls through the configured port', () => {
        const lifecycle = {
            begin: vi.fn<() => boolean>(() => true),
            complete: vi.fn<(input: { result: typeof empty_result }) => void>(),
            fail: vi.fn<() => void>(),
        };

        setMixAnalysisDisplayLifecycle(lifecycle);

        expect(mixAnalysisDisplayLifecycle.begin()).toBe(true);
        mixAnalysisDisplayLifecycle.complete({ result: empty_result });
        mixAnalysisDisplayLifecycle.fail();

        expect(lifecycle.begin).toHaveBeenCalledTimes(1);
        expect(lifecycle.complete).toHaveBeenCalledWith({ result: empty_result });
        expect(lifecycle.fail).toHaveBeenCalledTimes(1);
    });
});
