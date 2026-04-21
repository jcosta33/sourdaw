import { describe, it, expect, vi, beforeEach } from 'vitest';

import { runAppAction } from '../runAppAction';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

describe('runAppAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards the action to executeAppAction', () => {
        const action = { type: 'testAction', payload: 123 } as any;
        void runAppAction(action);

        expect(mocks.executeAppAction).toHaveBeenCalledWith(action);
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
    });

    it('returns the result of executeAppAction (Promise or void)', async () => {
        mocks.executeAppAction.mockResolvedValueOnce('success');
        const action = { type: 'asyncAction' } as any;

        const result = await runAppAction(action);
        expect(result).toBe('success');
    });
});
