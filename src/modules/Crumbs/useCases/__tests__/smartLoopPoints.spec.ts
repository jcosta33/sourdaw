import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

const mocks: {
    warn: Mock;
    detectSmartLoopPoints: Mock;
    setLoopParams: Mock;
    setCrumbsParamThrottled: Mock;
    activeSample: { sampleId: number } | null;
} = vi.hoisted(() => ({
    warn: vi.fn(),
    detectSmartLoopPoints: vi.fn(),
    setLoopParams: vi.fn(),
    setCrumbsParamThrottled: vi.fn(),
    activeSample: { sampleId: 9 },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.warn },
}));

vi.mock('../../repositories/crumbsBridge/detectSmartLoopPoints', () => ({
    detectSmartLoopPoints: mocks.detectSmartLoopPoints,
}));

vi.mock('../../stores/crumbsStore', () => ({
    crumbsStore: {
        get value() {
            return { inst1: { activeSample: mocks.activeSample } };
        },
    },
    setLoopParams: mocks.setLoopParams,
}));

vi.mock('../crumbsParamBridge/setCrumbsParamThrottled', () => ({
    setCrumbsParamThrottled: mocks.setCrumbsParamThrottled,
}));

import { detectAndApplyLoopPoints } from '../smartLoopPoints';

describe('detectAndApplyLoopPoints', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.activeSample = { sampleId: 9 };
    });

    it('does nothing when there is no active sample', async () => {
        mocks.activeSample = null;

        await detectAndApplyLoopPoints('inst1');

        expect(mocks.detectSmartLoopPoints).not.toHaveBeenCalled();
        expect(mocks.setLoopParams).not.toHaveBeenCalled();
        expect(mocks.setCrumbsParamThrottled).not.toHaveBeenCalled();
    });

    it('applies detected loop points to the store and pushes them to the engine', async () => {
        mocks.detectSmartLoopPoints.mockResolvedValueOnce({
            startFrame: 100,
            endFrame: 5000,
            crossfadeLength: 64,
            quality: 0.9,
        });

        await detectAndApplyLoopPoints('inst1');

        expect(mocks.detectSmartLoopPoints).toHaveBeenCalledWith('inst1', 9);
        expect(mocks.setLoopParams).toHaveBeenCalledWith('inst1', 'forward', 100, 5000);

        // Forward loop mode is engine value 1.
        expect(mocks.setCrumbsParamThrottled).toHaveBeenCalledWith('inst1', 'loopMode', 1);
        expect(mocks.setCrumbsParamThrottled).toHaveBeenCalledWith('inst1', 'loopStart', 100);
        expect(mocks.setCrumbsParamThrottled).toHaveBeenCalledWith('inst1', 'loopEnd', 5000);
        expect(mocks.setCrumbsParamThrottled).toHaveBeenCalledWith('inst1', 'loopCrossfade', 64);
        expect(mocks.setCrumbsParamThrottled).toHaveBeenCalledTimes(4);
    });

    it('leaves loop state untouched when detection resolves with no result', async () => {
        mocks.detectSmartLoopPoints.mockResolvedValueOnce(null);

        await detectAndApplyLoopPoints('inst1');

        expect(mocks.setLoopParams).not.toHaveBeenCalled();
        expect(mocks.setCrumbsParamThrottled).not.toHaveBeenCalled();
    });

    it('logs a warning and does not throw when detection rejects', async () => {
        mocks.detectSmartLoopPoints.mockRejectedValueOnce(new Error('backend unavailable'));

        await expect(detectAndApplyLoopPoints('inst1')).resolves.toBeUndefined();

        expect(mocks.warn).toHaveBeenCalledTimes(1);
        expect(mocks.setLoopParams).not.toHaveBeenCalled();
        expect(mocks.setCrumbsParamThrottled).not.toHaveBeenCalled();
    });
});
