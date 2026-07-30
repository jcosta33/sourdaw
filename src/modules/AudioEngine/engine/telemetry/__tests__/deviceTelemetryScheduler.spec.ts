import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { animationScheduler } from '#/utils/DOM/AnimationScheduler';

import {
    getDeviceTelemetrySchedulerDiagnostics,
    registerDeviceTelemetrySource,
    subscribeDeviceTelemetryDemand,
} from '../deviceTelemetryScheduler';

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

describe('deviceTelemetryScheduler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    it('polls a source only while its device has demand', () => {
        const poll = vi.fn();
        trackCleanup(registerDeviceTelemetrySource({ deviceId: 'device-1', poll }));

        expect(animationScheduler.register).not.toHaveBeenCalled();

        const unsubscribe = trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'device-1' }));
        registeredTick()(100, 16);

        expect(poll).toHaveBeenCalledWith(100, 16);
        expect(animationScheduler.register).toHaveBeenCalledTimes(1);

        unsubscribe();
        expect(animationScheduler.unregister).toHaveBeenCalledWith('audio-engine-device-telemetry');
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

    it('settles scheduler state when an unregister transition is reentrant', () => {
        const secondPoll = vi.fn();
        trackCleanup(registerDeviceTelemetrySource({ deviceId: 'device-1', poll: vi.fn() }));
        const unsubscribeFirst = trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'device-1' }));
        vi.mocked(animationScheduler.unregister).mockImplementationOnce(() => {
            trackCleanup(registerDeviceTelemetrySource({ deviceId: 'device-2', poll: secondPoll }));
            trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'device-2' }));
        });

        unsubscribeFirst();
        registeredTick()(700, 16);

        expect(animationScheduler.unregister).toHaveBeenCalledTimes(1);
        expect(animationScheduler.register).toHaveBeenCalledTimes(2);
        expect(secondPoll).toHaveBeenCalledTimes(1);
        expect(getDeviceTelemetrySchedulerDiagnostics().schedulerRegistered).toBe(true);
    });

    it('rolls back a failed scheduler start and permits a clean retry', () => {
        const poll = vi.fn();
        trackCleanup(registerDeviceTelemetrySource({ deviceId: 'device-1', poll }));
        vi.mocked(animationScheduler.register).mockImplementationOnce(() => {
            throw new Error('scheduler unavailable');
        });

        expect(() => subscribeDeviceTelemetryDemand({ deviceId: 'device-1' })).toThrow('scheduler unavailable');
        expect(getDeviceTelemetrySchedulerDiagnostics()).toEqual({
            activeDemandSubscriptions: 0,
            activeSources: 1,
            eligibleSources: 0,
            pendingMutations: 0,
            schedulerRegistered: false,
        });

        trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'device-1' }));
        registeredTick()(800, 16);

        expect(poll).toHaveBeenCalledTimes(1);
        expect(animationScheduler.register).toHaveBeenCalledTimes(2);
    });

    it('recovers from a throwing stop when eligible demand returns', () => {
        const poll = vi.fn();
        trackCleanup(registerDeviceTelemetrySource({ deviceId: 'device-1', poll }));
        const unsubscribe = trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'device-1' }));
        vi.mocked(animationScheduler.unregister).mockImplementationOnce(() => {
            throw new Error('stop failed');
        });

        expect(() => unsubscribe()).toThrow('stop failed');

        trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'device-1' }));
        registeredTick()(900, 16);

        expect(animationScheduler.register).toHaveBeenCalledTimes(2);
        expect(poll).toHaveBeenCalledTimes(1);
    });

    it('reconciles surviving reentrant state after a failed start', () => {
        const survivingPoll = vi.fn();
        trackCleanup(registerDeviceTelemetrySource({ deviceId: 'device-1', poll: vi.fn() }));
        vi.mocked(animationScheduler.register).mockImplementationOnce(() => {
            trackCleanup(registerDeviceTelemetrySource({ deviceId: 'device-2', poll: survivingPoll }));
            trackCleanup(subscribeDeviceTelemetryDemand({ deviceId: 'device-2' }));
            throw new Error('start failed');
        });

        expect(() => subscribeDeviceTelemetryDemand({ deviceId: 'device-1' })).toThrow('start failed');
        registeredTick()(950, 16);

        expect(animationScheduler.register).toHaveBeenCalledTimes(2);
        expect(survivingPoll).toHaveBeenCalledTimes(1);
        expect(getDeviceTelemetrySchedulerDiagnostics()).toMatchObject({
            activeDemandSubscriptions: 1,
            eligibleSources: 1,
            schedulerRegistered: true,
        });
    });
});
