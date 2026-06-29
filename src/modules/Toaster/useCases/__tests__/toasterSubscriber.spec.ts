import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMock } from '#/infra/di/testing/createMock';
import { type Logger } from '#/infra/logger/types';

vi.mock('../disposeToasterDevice', () => ({
    disposeToasterDevice: vi.fn(),
}));

import { disposeToasterDevice } from '../disposeToasterDevice';
import { initToasterSubscribers } from '../toasterSubscriber';

type EventBusShape = {
    on: ReturnType<typeof vi.fn>;
};

/** Capture the handler the subscriber registered for a given event. */
function handlerFor(eventBus: EventBusShape, event: string): (payload: unknown) => void {
    const call = eventBus.on.mock.calls.find((c) => c[0] === event);
    if (!call) {
        throw new Error(`no subscription registered for ${event}`);
    }
    return call[1] as (payload: unknown) => void;
}

describe('initToasterSubscribers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('subscribes to audioDevice.loaded and audioDevice.removed', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.on.mockReturnValue(vi.fn());

        initToasterSubscribers({
            eventBus,
            logger: createMock<Logger>(),
        });

        expect(eventBus.on).toHaveBeenCalledWith('audioDevice.loaded', expect.any(Function));
        expect(eventBus.on).toHaveBeenCalledWith('audioDevice.removed', expect.any(Function));
    });

    it('returns a teardown that unsubscribes both subscriptions', () => {
        const eventBus = createMock<EventBusShape>();
        const unsubLoaded = vi.fn();
        const unsubRemoved = vi.fn();
        eventBus.on.mockReturnValueOnce(unsubLoaded).mockReturnValueOnce(unsubRemoved);

        const teardown = initToasterSubscribers({
            eventBus,
            logger: createMock<Logger>(),
        });
        teardown();

        expect(unsubLoaded).toHaveBeenCalledTimes(1);
        expect(unsubRemoved).toHaveBeenCalledTimes(1);
    });

    // Regression (Bug #3 wiring): a toaster removal event must dispose the
    // device. This is the bridge between AudioEngine's destroy() emit and the
    // teardown orchestrator — the only path now that AudioEngine cannot import
    // the Toaster useCases barrel directly (acyclic-boundary constraint).
    it('disposes the device on a toaster audioDevice.removed event', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.on.mockReturnValue(vi.fn());

        initToasterSubscribers({
            eventBus,
            logger: createMock<Logger>(),
        });

        handlerFor(eventBus, 'audioDevice.removed')({ deviceId: 'toast-1', deviceType: 'toaster' });

        expect(disposeToasterDevice).toHaveBeenCalledWith('toast-1');
    });

    it('ignores a non-toaster audioDevice.removed event', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.on.mockReturnValue(vi.fn());

        initToasterSubscribers({
            eventBus,
            logger: createMock<Logger>(),
        });

        handlerFor(eventBus, 'audioDevice.removed')({ deviceId: 'fermenter-1', deviceType: 'fermenter' });

        expect(disposeToasterDevice).not.toHaveBeenCalled();
    });
});
