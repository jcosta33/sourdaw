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

    it('should return the void result of executeAppAction', async () => {
        mocks.executeAppAction.mockResolvedValueOnce(undefined);
        const action: Parameters<typeof runAppAction>[0] = { type: 'removeTrack', payload: { trackId: '456' } };

        const result = await runAppAction(action);
        expect(result).toBeUndefined();
    });
});
