import { describe, it, expect, vi } from 'vitest';

import { onNotification } from '../onNotification';

const mocks = vi.hoisted(() => ({
    mockEventBus: {
        on: vi.fn(),
    },
}));

vi.mock('#/app/registerDependencies', () => ({
    eventBus: mocks.mockEventBus,
}));

describe('onNotification', () => {
    it('should subscribe to ui.notify and return unsubscribe', () => {
        const unsubscribe = vi.fn();
        mocks.mockEventBus.on.mockReturnValue(unsubscribe);

        const handler = vi.fn();
        const result = onNotification(handler);

        expect(mocks.mockEventBus.on).toHaveBeenCalledWith('ui.notify', handler);
        expect(result).toBe(unsubscribe);
    });
});
