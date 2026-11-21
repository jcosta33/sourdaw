import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMock, type MockObject } from '#/infra/di/testing/createMock';
import { type Logger } from '#/infra/logger/types';

vi.mock('../disposeToasterDevice', () => ({
    disposeToasterDevice: vi.fn(),
}));

const hydrationMocks = vi.hoisted(() => ({
    getToasterDeviceControls: vi.fn(),
    readToasterStore: vi.fn<() => Record<string, { kit: unknown }> | undefined>(),
    registerToasterDevice: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    resolveEligibleDeviceWriteTarget: hydrationMocks.resolveEligibleDeviceWriteTarget,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getToasterDeviceControls: hydrationMocks.getToasterDeviceControls,
}));

vi.mock('../../stores/toasterStore', () => ({
    registerToasterDevice: hydrationMocks.registerToasterDevice,
    toasterStore: {
        get value() {
            return hydrationMocks.readToasterStore();
        },
    },
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
        hydrationMocks.readToasterStore.mockReturnValue(undefined);
        hydrationMocks.resolveEligibleDeviceWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: 'toast-1',
        });
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
        expect(hydrationMocks.resolveEligibleDeviceWriteTarget).not.toHaveBeenCalled();
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
        hydrationMocks.readToasterStore.mockReturnValue({ 'toast-1': { kit } });

        const eventBus = createMock<EventBusShape>();
        eventBus.on.mockReturnValue(vi.fn<() => void>());
        const logger = createMock<Logger>();
        initToasterSubscribers({
            eventBus,
            logger,
        });

        handlerFor(eventBus, 'audioDevice.loaded')({ deviceId: 'toast-1', deviceType: 'toaster' });

        // The device is resolved through the AudioEngine use-case port keyed by
        // deviceId — no getAllTracks / getTrackStrip / deviceNodes reach-in.
        expect(hydrationMocks.getToasterDeviceControls).toHaveBeenCalledWith('toast-1');
        expect(setParam).toHaveBeenCalledWith('master_gain', kit.masterGain);
        expect(setPadParam).toHaveBeenCalledWith(0, 'volume', kit.pads[0]!.volume);

        const resolutionOrder = hydrationMocks.resolveEligibleDeviceWriteTarget.mock.invocationCallOrder[0];
        const logOrder = logger.info.mock.invocationCallOrder[0];
        const storeReadOrder = hydrationMocks.readToasterStore.mock.invocationCallOrder[0];
        const lookupOrder = hydrationMocks.getToasterDeviceControls.mock.invocationCallOrder[0];
        const runtimeOrder = setParam.mock.invocationCallOrder[0];
        if (
            resolutionOrder === undefined ||
            logOrder === undefined ||
            storeReadOrder === undefined ||
            lookupOrder === undefined ||
            runtimeOrder === undefined
        ) {
            throw new Error('Expected authorization, log, store, lookup, and runtime effects');
        }
        expect(resolutionOrder).toBeLessThan(logOrder);
        expect(logOrder).toBeLessThan(storeReadOrder);
        expect(storeReadOrder).toBeLessThan(lookupOrder);
        expect(lookupOrder).toBeLessThan(runtimeOrder);
    });

    it.each(['missing', 'ineligible'] as const)(
        'rejects loaded hydration for a %s owner before log, store, lookup, or runtime effects',
        (status) => {
            const setParam = vi.fn();
            const setPadParam = vi.fn();
            hydrationMocks.getToasterDeviceControls.mockReturnValue({ setParam, setPadParam });
            hydrationMocks.readToasterStore.mockReturnValue({ 'toast-1': { kit: createDefaultKit() } });
            hydrationMocks.resolveEligibleDeviceWriteTarget.mockReturnValue({ status });

            const eventBus = createMock<EventBusShape>();
            eventBus.on.mockReturnValue(vi.fn<() => void>());
            const logger = createMock<Logger>();
            initToasterSubscribers({ eventBus, logger });

            handlerFor(eventBus, 'audioDevice.loaded')({ deviceId: 'toast-1', deviceType: 'toaster' });

            expect(hydrationMocks.resolveEligibleDeviceWriteTarget).toHaveBeenCalledWith('toast-1');
            expect(logger.info).not.toHaveBeenCalled();
            expect(hydrationMocks.readToasterStore).not.toHaveBeenCalled();
            expect(hydrationMocks.getToasterDeviceControls).not.toHaveBeenCalled();
            expect(setParam).not.toHaveBeenCalled();
            expect(setPadParam).not.toHaveBeenCalled();
        }
    );

    it('skips hydration cleanly when the port finds no loaded device for the id', () => {
        hydrationMocks.getToasterDeviceControls.mockReturnValue(undefined);
        hydrationMocks.readToasterStore.mockReturnValue({ 'toast-1': { kit: createDefaultKit() } });

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
