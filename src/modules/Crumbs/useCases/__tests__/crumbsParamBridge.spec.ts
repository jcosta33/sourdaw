import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    setCrumbsParam: vi.fn(),
}));

vi.mock('../../repositories/crumbsBridge', () => ({
    setCrumbsParam: mocks.setCrumbsParam,
}));

vi.mock('#/utils/DOM/createRafBatcher', () => ({
    createRafBatcher: () => ({
        schedule: (key: string, value: unknown, flush: (k: string, v: unknown) => void) => {
            flush(key, value);
        },
        cancel: (): void => {},
        cancelAll: (): void => {},
        pendingSize: 0,
    }),
}));

import { setCrumbsParamImmediate } from '../crumbsParamBridge/setCrumbsParamImmediate';
import { setCrumbsParamThrottled } from '../crumbsParamBridge/setCrumbsParamThrottled';

describe('crumbsParamBridge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('setCrumbsParamImmediate forwards to the bridge', () => {
        mocks.setCrumbsParam.mockResolvedValue(undefined);
        setCrumbsParamImmediate('inst-1', 'gain', 0.5);
        expect(mocks.setCrumbsParam).toHaveBeenCalledWith('inst-1', 'gain', 0.5);
    });

    it('setCrumbsParamThrottled flushes to the bridge via rAF', () => {
        mocks.setCrumbsParam.mockResolvedValue(undefined);
        setCrumbsParamThrottled('inst-2', 'gain', 0.25);
        expect(mocks.setCrumbsParam).toHaveBeenCalledWith('inst-2', 'gain', 0.25);
    });
});
