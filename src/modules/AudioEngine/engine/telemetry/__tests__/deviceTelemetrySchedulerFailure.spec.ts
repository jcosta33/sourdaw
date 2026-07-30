import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { animationScheduler } from '#/utils/DOM/AnimationScheduler';

import {
    getDeviceTelemetrySchedulerDiagnostics,
    registerDeviceTelemetrySource,
    subscribeDeviceTelemetryDemand,
} from '../deviceTelemetryScheduler';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        warn: vi.fn(),
    },
}));

vi.mock('#/utils/DOM/AnimationScheduler', () => ({
    animationScheduler: {
        register: vi.fn(),
        unregister: vi.fn(),
    },
}));

type FrameCallback = (time: DOMHighResTimeStamp, deltaMs: number) => void;

const cleanups: Array<() => void> = [];

function trackCleanup(cleanup: () => void): () => void {
    cleanups.push(cleanup);
    return cleanup;
}

function registeredTick(): FrameCallback {
    const callback = vi.mocked(animationScheduler.register).mock.calls.at(-1)?.[1];
    if (!callback) {
        throw new Error('Device telemetry scheduler did not register its frame callback.');
    }
    return callback;
}

describe('deviceTelemetryScheduler advanced behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    it('starts when a source arrives for pre-existing demand', () => {
        const poll = vi.fn();
        trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'device-1' }));

        expect(animationScheduler.register).not.toHaveBeenCalled();

        trackCleanup(registerDeviceTelemetrySource({ deviceId: 'device-1', poll }));
        registeredTick()(200, 17);

        expect(poll).toHaveBeenCalledWith(200, 17);
        expect(animationScheduler.register).toHaveBeenCalledTimes(1);
    });

    it('owns duplicate demand subscriptions independently', () => {
        const poll = vi.fn();
        trackCleanup(registerDeviceTelemetrySource({ deviceId: 'device-1', poll }));
        const unsubscribeFirst = trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'device-1' }));
        const unsubscribeSecond = trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'device-1' }));

        unsubscribeFirst();
        registeredTick()(300, 18);

        expect(poll).toHaveBeenCalledTimes(1);
        expect(animationScheduler.unregister).not.toHaveBeenCalled();

        unsubscribeSecond();
        expect(animationScheduler.unregister).toHaveBeenCalledTimes(1);
    });

    it('does not keep the scheduler alive for demand without a source', () => {
        const unregisterSource = trackCleanup(registerDeviceTelemetrySource({ deviceId: 'device-1', poll: vi.fn() }));
        trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'device-1' }));
        trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'missing-device' }));

        unregisterSource();

        expect(animationScheduler.unregister).toHaveBeenCalledWith('audio-engine-device-telemetry');
        expect(getDeviceTelemetrySchedulerDiagnostics()).toEqual({
            activeDemandSubscriptions: 2,
            activeSources: 0,
            eligibleSources: 0,
            pendingMutations: 0,
            schedulerRegistered: false,
        });
    });

    it('applies reentrant changes after a fixed frame cohort', () => {
        const secondPoll = vi.fn();
        let unregisterFirst: () => void = vi.fn();
        const firstPoll = vi.fn(() => {
            unregisterFirst();
            trackCleanup(registerDeviceTelemetrySource({ deviceId: 'device-2', poll: secondPoll }));
            trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'device-2' }));
        });
        unregisterFirst = trackCleanup(registerDeviceTelemetrySource({ deviceId: 'device-1', poll: firstPoll }));
        trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'device-1' }));

        registeredTick()(400, 16);

        expect(firstPoll).toHaveBeenCalledTimes(1);
        expect(secondPoll).not.toHaveBeenCalled();
        expect(animationScheduler.register).toHaveBeenCalledTimes(1);
        expect(animationScheduler.unregister).not.toHaveBeenCalled();

        registeredTick()(416, 16);

        expect(firstPoll).toHaveBeenCalledTimes(1);
        expect(secondPoll).toHaveBeenCalledTimes(1);
    });

    it('keeps a replacement source when the prior owner cleans up', () => {
        const firstPoll = vi.fn();
        const secondPoll = vi.fn();
        const unregisterFirst = trackCleanup(registerDeviceTelemetrySource({ deviceId: 'device-1', poll: firstPoll }));
        trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'device-1' }));
        trackCleanup(registerDeviceTelemetrySource({ deviceId: 'device-1', poll: secondPoll }));

        unregisterFirst();
        registeredTick()(500, 16);

        expect(firstPoll).not.toHaveBeenCalled();
        expect(secondPoll).toHaveBeenCalledTimes(1);
        expect(animationScheduler.unregister).not.toHaveBeenCalled();
    });

    it('quarantines a failing source while the remaining frame cohort continues', () => {
        const brokenPoll = vi.fn(() => {
            throw new Error('telemetry read failed');
        });
        const healthyPoll = vi.fn();
        trackCleanup(registerDeviceTelemetrySource({ deviceId: 'broken-device', poll: brokenPoll }));
        trackCleanup(registerDeviceTelemetrySource({ deviceId: 'healthy-device', poll: healthyPoll }));
        trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'broken-device' }));
        trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'healthy-device' }));

        expect(() => registeredTick()(600, 16)).not.toThrow();
        expect(() => registeredTick()(616, 16)).not.toThrow();

        expect(brokenPoll).toHaveBeenCalledTimes(1);
        expect(healthyPoll).toHaveBeenNthCalledWith(1, 600, 16);
        expect(healthyPoll).toHaveBeenNthCalledWith(2, 616, 16);
        expect(logger.warn).toHaveBeenCalledWith(
            '[DeviceTelemetryScheduler] Source for "broken-device" threw:',
            expect.any(Error)
        );
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('stops the scheduler when its only eligible source fails', () => {
        trackCleanup(
            registerDeviceTelemetrySource({
                deviceId: 'broken-device',
                poll: () => {
                    throw new Error('telemetry read failed');
                },
            })
        );
        trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'broken-device' }));

        registeredTick()(650, 16);

        expect(animationScheduler.unregister).toHaveBeenCalledWith('audio-engine-device-telemetry');
        expect(getDeviceTelemetrySchedulerDiagnostics()).toMatchObject({
            eligibleSources: 0,
            schedulerRegistered: false,
        });
    });
});
