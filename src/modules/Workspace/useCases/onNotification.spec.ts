import { describe, it, expect, vi } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { onNotification } from './onNotification';

type EventBusShape = {
    on: ReturnType<typeof vi.fn>;
};

describe('onNotification', () => {
    it('should subscribe to ui.notify and return unsubscribe', () => {
        const eventBus = createMock<EventBusShape>();
        const unsubscribe = vi.fn();
        eventBus.on.mockReturnValue(unsubscribe);
        injectDependencies(onNotification, { eventBus });

        const handler = vi.fn();
        const result = onNotification(handler);

        expect(eventBus.on).toHaveBeenCalledWith('ui.notify', handler);
        expect(result).toBe(unsubscribe);
    });
});
