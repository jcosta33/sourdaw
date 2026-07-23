import { beforeEach, describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { onConfirmation } from '../onConfirmation';

const mocks = vi.hoisted(() => ({
    mockEventBus: {
        on: vi.fn(),
    },
}));

describe('onConfirmation', () => {
    beforeEach(() => {
        injectDependencies(onConfirmation, { eventBus: mocks.mockEventBus });
        mocks.mockEventBus.on.mockClear();
    });

    it('should subscribe to ui.confirm and return unsubscribe', () => {
        const unsubscribe = vi.fn();
        mocks.mockEventBus.on.mockReturnValue(unsubscribe);

        const handler = vi.fn();
        const result = onConfirmation(handler);

        expect(mocks.mockEventBus.on).toHaveBeenCalledWith('ui.confirm', handler);
        expect(result).toBe(unsubscribe);
    });
});
