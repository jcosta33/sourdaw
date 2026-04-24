import { describe, it, expect, vi, beforeEach } from 'vitest';

import { runAppAction } from '../runAppAction';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn<typeof import('#/modules/Command/useCases').executeAppAction>(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

describe('runAppAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards the action to executeAppAction', () => {
        const action: Parameters<typeof runAppAction>[0] = { type: 'removeTrack', payload: { trackId: '123' } };
        void runAppAction(action);

        expect(mocks.executeAppAction).toHaveBeenCalledWith(action);
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
    });

    it('returns the result of executeAppAction (Promise or void)', async () => {
        mocks.executeAppAction.mockResolvedValueOnce('success');
        const action: Parameters<typeof runAppAction>[0] = { type: 'removeTrack', payload: { trackId: '456' } };

        const result = await runAppAction(action);
        expect(result).toBe('success');
    });
});
