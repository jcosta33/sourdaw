import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMock, type MockObject } from '#/infra/di/testing/createMock';
import { type Logger } from '#/infra/logger/types';

vi.mock('../disposeToasterDevice', () => ({
    disposeToasterDevice: vi.fn(),
}));

const hydrationMocks = vi.hoisted(() => ({
    getToasterDeviceControls: vi.fn(),
    toasterStore: { value: undefined as Record<string, { kit: unknown }> | undefined },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getToasterDeviceControls: hydrationMocks.getToasterDeviceControls,
}));

vi.mock('../../stores/toasterStore', () => ({
    toasterStore: hydrationMocks.toasterStore,
}));

import { createDefaultKit } from '../../models/ToasterKit';
import { disposeToasterDevice } from '../disposeToasterDevice';
import { initToasterSubscribers } from '../toasterSubscriber';

type LifecyclePayload = { deviceId: string; deviceType: string };

type EventBusShape = {
    on: (
        event: 'audioDevice.loaded' | 'audioDevice.removed',
        handler: (payload: LifecyclePayload) => void
    ) => () => void;
};

/** Capture the handler the subscriber registered for a given event. */
function handlerFor(eventBus: MockObject<EventBusShape>, event: string): (payload: LifecyclePayload) => void {
    const call = eventBus.on.mock.calls.find((c) => c[0] === event);
    if (!call) {
        throw new Error(`no subscription registered for ${event}`);
    }
    return call[1];
}

describe('initToasterSubscribers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        hydrationMocks.toasterStore.value = undefined;
    });

    it('subscribes to audioDevice.loaded and audioDevice.removed', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.on.mockReturnValue(vi.fn<() => void>());

        initToasterSubscribers({
            eventBus,
            logger: createMock<Logger>(),
        });

        expect(eventBus.on).toHaveBeenCalledWith('audioDevice.loaded', expect.any(Function));
        expect(eventBus.on).toHaveBeenCalledWith('audioDevice.removed', expect.any(Function));
    });

    it('returns a teardown that unsubscribes both subscriptions', () => {
        const eventBus = createMock<EventBusShape>();
        const unsubLoaded = vi.fn<() => void>();
        const unsubRemoved = vi.fn<() => void>();
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
        eventBus.on.mockReturnValue(vi.fn<() => void>());

        initToasterSubscribers({
            eventBus,
            logger: createMock<Logger>(),
        });

        handlerFor(eventBus, 'audioDevice.removed')({ deviceId: 'toast-1', deviceType: 'toaster' });

        expect(disposeToasterDevice).toHaveBeenCalledWith('toast-1');
    });

    it('ignores a non-toaster audioDevice.removed event', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.on.mockReturnValue(vi.fn<() => void>());

        initToasterSubscribers({
            eventBus,
            logger: createMock<Logger>(),
        });

        handlerFor(eventBus, 'audioDevice.removed')({ deviceId: 'fermenter-1', deviceType: 'fermenter' });

        expect(disposeToasterDevice).not.toHaveBeenCalled();
    });

    it('hydrates a loaded toaster device through the AudioEngine control port, not strip internals', () => {
        const setParam = vi.fn();
        const setPadParam = vi.fn();
        hydrationMocks.getToasterDeviceControls.mockReturnValue({ setParam, setPadParam });
        const kit = createDefaultKit();
        hydrationMocks.toasterStore.value = { 'toast-1': { kit } };

        const eventBus = createMock<EventBusShape>();
        eventBus.on.mockReturnValue(vi.fn<() => void>());
        initToasterSubscribers({
            eventBus,
            logger: createMock<Logger>(),
        });

        handlerFor(eventBus, 'audioDevice.loaded')({ deviceId: 'toast-1', deviceType: 'toaster' });

        // The device is resolved through the AudioEngine use-case port keyed by
        // deviceId — no getAllTracks / getTrackStrip / deviceNodes reach-in.
        expect(hydrationMocks.getToasterDeviceControls).toHaveBeenCalledWith('toast-1');
        expect(setParam).toHaveBeenCalledWith('master_gain', kit.masterGain);
        expect(setPadParam).toHaveBeenCalledWith(0, 'volume', kit.pads[0]!.volume);
    });

    it('skips hydration cleanly when the port finds no loaded device for the id', () => {
        hydrationMocks.getToasterDeviceControls.mockReturnValue(undefined);
        hydrationMocks.toasterStore.value = { 'toast-1': { kit: createDefaultKit() } };

        const eventBus = createMock<EventBusShape>();
        eventBus.on.mockReturnValue(vi.fn<() => void>());
        initToasterSubscribers({
            eventBus,
            logger: createMock<Logger>(),
        });

        // Not-found branch: the port is consulted, returns undefined, and the
        // handler bails without throwing.
        expect(() =>
            handlerFor(eventBus, 'audioDevice.loaded')({ deviceId: 'toast-1', deviceType: 'toaster' })
        ).not.toThrow();
        expect(hydrationMocks.getToasterDeviceControls).toHaveBeenCalledWith('toast-1');
    });
});
