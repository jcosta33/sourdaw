import { beforeEach, describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { onNotification } from '../onNotification';

const mocks = vi.hoisted(() => ({
    mockEventBus: {
        on: vi.fn(),
    },
}));

describe('onNotification', () => {
    beforeEach(() => {
        injectDependencies(onNotification, { eventBus: mocks.mockEventBus });
        mocks.mockEventBus.on.mockClear();
    });

    it('should subscribe to ui.notify and return unsubscribe', () => {
        const unsubscribe = vi.fn();
        mocks.mockEventBus.on.mockReturnValue(unsubscribe);

        const handler = vi.fn();
        const result = onNotification(handler);

        expect(mocks.mockEventBus.on).toHaveBeenCalledWith('ui.notify', handler);
        expect(result).toBe(unsubscribe);
    });
});
