import { describe, it, expect, vi } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type Logger } from '#/helpers/Logger/Logger';

/** Avoid circular import: toasterSubscriber → engineAccess → wasmDeviceRegistry → bootstrap → toasterSubscriber */
vi.mock('#/app/bootstrap', () => ({
    eventBus: {
        emit: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        waitForIdle: vi.fn().mockResolvedValue(undefined),
    },
    logger: {},
}));

import { initToasterSubscribers } from '../toasterSubscriber';

type EventBusShape = {
    on: ReturnType<typeof vi.fn>;
};

describe('initToasterSubscribers', () => {
    it('should subscribe to audioDevice.loaded and return unsubscribe', () => {
        const eventBus = createMock<EventBusShape>();
        const unsubscribe = vi.fn();
        eventBus.on.mockReturnValue(unsubscribe);

        const logger = createMock<Logger>();

        injectDependencies(initToasterSubscribers, {
            eventBus,
            logger,
            getTrackStrip: vi.fn(),
            getAllTracks: vi.fn(() => []),
        });

        const teardown = initToasterSubscribers();

        expect(eventBus.on).toHaveBeenCalledWith('audioDevice.loaded', expect.any(Function));
        expect(teardown).toBe(unsubscribe);
    });
});
