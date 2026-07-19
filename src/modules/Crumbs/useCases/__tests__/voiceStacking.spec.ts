import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    setVoiceStack: vi.fn(),
    setCrumbsParamThrottled: vi.fn(),
}));

vi.mock('../../stores/crumbsStore', () => ({
    setVoiceStack: mocks.setVoiceStack,
}));

vi.mock('../crumbsParamBridge/setCrumbsParamThrottled', () => ({
    setCrumbsParamThrottled: mocks.setCrumbsParamThrottled,
}));

import { updateVoiceStack } from '../voiceStacking';

const INSTANCE = 'inst-A';

describe('updateVoiceStack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('always writes the partial update to the voice-stack store', () => {
        updateVoiceStack(INSTANCE, { stackCount: 4 });

        expect(mocks.setVoiceStack).toHaveBeenCalledWith(INSTANCE, { stackCount: 4 });
    });

    it('forwards a defined stackCount to the engine as stackCount', () => {
        updateVoiceStack(INSTANCE, { stackCount: 3 });

        expect(mocks.setCrumbsParamThrottled).toHaveBeenCalledWith(INSTANCE, 'stackCount', 3);
        expect(mocks.setCrumbsParamThrottled).toHaveBeenCalledTimes(1);
    });

    it('forwards a defined detuneSpread to the engine as detuneSpread', () => {
        updateVoiceStack(INSTANCE, { detuneSpread: 0.5 });

        expect(mocks.setCrumbsParamThrottled).toHaveBeenCalledWith(INSTANCE, 'detuneSpread', 0.5);
        expect(mocks.setCrumbsParamThrottled).toHaveBeenCalledTimes(1);
    });

    it('forwards a defined stackSpread to the engine as stackSpread', () => {
        updateVoiceStack(INSTANCE, { stackSpread: 0.8 });

        expect(mocks.setCrumbsParamThrottled).toHaveBeenCalledWith(INSTANCE, 'stackSpread', 0.8);
        expect(mocks.setCrumbsParamThrottled).toHaveBeenCalledTimes(1);
    });

    it('forwards every field present in a combined update, each as its own param push', () => {
        updateVoiceStack(INSTANCE, { stackCount: 2, detuneSpread: 0.1, stackSpread: 0.2 });

        expect(mocks.setCrumbsParamThrottled).toHaveBeenCalledTimes(3);
        expect(mocks.setCrumbsParamThrottled).toHaveBeenCalledWith(INSTANCE, 'stackCount', 2);
        expect(mocks.setCrumbsParamThrottled).toHaveBeenCalledWith(INSTANCE, 'detuneSpread', 0.1);
        expect(mocks.setCrumbsParamThrottled).toHaveBeenCalledWith(INSTANCE, 'stackSpread', 0.2);
    });

    it('does not push a param that is absent from the update, even when set to 0', () => {
        // stackCount: 0 is falsy but must still be forwarded — only `undefined`
        // (field absent) should be skipped.
        updateVoiceStack(INSTANCE, { stackCount: 0 });

        expect(mocks.setCrumbsParamThrottled).toHaveBeenCalledWith(INSTANCE, 'stackCount', 0);
        expect(mocks.setCrumbsParamThrottled).toHaveBeenCalledTimes(1);
    });

    it('pushes no params for an empty update', () => {
        updateVoiceStack(INSTANCE, {});

        expect(mocks.setCrumbsParamThrottled).not.toHaveBeenCalled();
        expect(mocks.setVoiceStack).toHaveBeenCalledWith(INSTANCE, {});
    });
});
