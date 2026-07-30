import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { animationScheduler } from '#/utils/DOM/AnimationScheduler';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { subscribePeakMeter } from '../subscribePeakMeter';

vi.mock('#/utils/DOM/AnimationScheduler', () => ({
    animationScheduler: {
        register: vi.fn(),
        unregister: vi.fn(),
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        warn: vi.fn(),
    },
}));

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        getMasterPeakLevel: vi.fn(() => 0.8),
        getTrackPeakLevel: vi.fn(() => 0.4),
    },
}));

type FrameCallback = (time: DOMHighResTimeStamp, deltaMs: number) => void;

const cleanups: Array<() => void> = [];

function subscribe(input: Parameters<typeof subscribePeakMeter>[0]): void {
    cleanups.push(subscribePeakMeter(input));
}

function registeredTick(): FrameCallback {
    const callback = vi.mocked(animationScheduler.register).mock.calls[0]?.[1];
    if (!callback) {
        throw new Error('Peak meter coordinator did not register its frame callback.');
    }
    return callback;
}

describe('subscribePeakMeter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        while (cleanups.length > 0) {
            cleanups.pop()?.();
        }
    });

    it('reads each unique meter once and shares the frame with all of its subscribers', () => {
        const first = vi.fn();
        const second = vi.fn();
        const master = vi.fn();
        subscribe({ trackId: 'track-1', onFrame: first });
        subscribe({ trackId: 'track-1', onFrame: second });
        subscribe({ trackId: null, onFrame: master });

        registeredTick()(123, 16);

        expect(audioEngine.getTrackPeakLevel).toHaveBeenCalledTimes(1);
        expect(audioEngine.getTrackPeakLevel).toHaveBeenCalledWith('track-1');
        expect(audioEngine.getMasterPeakLevel).toHaveBeenCalledTimes(1);
        expect(first).toHaveBeenCalledWith(0.4, 123, 16);
        expect(second).toHaveBeenCalledWith(0.4, 123, 16);
        expect(master).toHaveBeenCalledWith(0.8, 123, 16);
        expect(animationScheduler.register).toHaveBeenCalledTimes(1);
    });

    it('keeps the shared scheduler alive until the final subscription leaves', () => {
        const unsubscribeFirst = subscribePeakMeter({ trackId: 'track-1', onFrame: vi.fn() });
        const unsubscribeSecond = subscribePeakMeter({ trackId: 'track-2', onFrame: vi.fn() });

        unsubscribeFirst();
        expect(animationScheduler.unregister).not.toHaveBeenCalled();

        unsubscribeSecond();
        expect(animationScheduler.unregister).toHaveBeenCalledWith('audio-engine-peak-meters');
    });

    it('owns duplicate callback subscriptions independently', () => {
        const callback = vi.fn();
        const unsubscribeFirst = subscribePeakMeter({ trackId: 'track-1', onFrame: callback });
        const unsubscribeSecond = subscribePeakMeter({ trackId: 'track-1', onFrame: callback });

        registeredTick()(100, 16);
        expect(callback).toHaveBeenCalledTimes(2);

        unsubscribeFirst();
        registeredTick()(116, 16);
        expect(callback).toHaveBeenCalledTimes(3);

        unsubscribeSecond();
        expect(animationScheduler.unregister).toHaveBeenCalledTimes(1);
    });

    it('applies reentrant subscription changes after the current frame without restarting the scheduler', () => {
        const replacement = vi.fn();
        let unsubscribeReplacement: (() => void) | undefined;
        let unsubscribeFirst: () => void = vi.fn();
        const first = vi.fn(() => {
            unsubscribeFirst();
            unsubscribeReplacement = subscribePeakMeter({ trackId: 'track-1', onFrame: replacement });
        });
        unsubscribeFirst = subscribePeakMeter({ trackId: 'track-1', onFrame: first });

        registeredTick()(100, 16);
        expect(first).toHaveBeenCalledTimes(1);
        expect(replacement).not.toHaveBeenCalled();
        expect(animationScheduler.register).toHaveBeenCalledTimes(1);
        expect(animationScheduler.unregister).not.toHaveBeenCalled();

        registeredTick()(116, 16);
        expect(first).toHaveBeenCalledTimes(1);
        expect(replacement).toHaveBeenCalledTimes(1);

        unsubscribeReplacement?.();
    });

    it('isolates a failing subscriber from the other meter consumers', () => {
        const healthy = vi.fn();
        subscribe({
            trackId: 'track-1',
            onFrame: () => {
                throw new Error('consumer failed');
            },
        });
        subscribe({ trackId: 'track-1', onFrame: healthy });

        expect(() => registeredTick()(200, 17)).not.toThrow();
        expect(healthy).toHaveBeenCalledWith(0.4, 200, 17);
        expect(logger.warn).toHaveBeenCalledWith(
            '[PeakMeterCoordinator] Subscriber for "track:track-1" threw:',
            expect.any(Error)
        );
    });

    it('isolates a failed meter read from other meters', () => {
        vi.mocked(audioEngine.getTrackPeakLevel).mockImplementation(() => {
            throw new Error('meter failed');
        });
        const master = vi.fn();
        subscribe({ trackId: 'track-1', onFrame: vi.fn() });
        subscribe({ trackId: null, onFrame: master });

        registeredTick()(200, 17);

        expect(master).toHaveBeenCalledWith(0.8, 200, 17);
        expect(logger.warn).toHaveBeenCalledWith(
            '[PeakMeterCoordinator] Failed to read "track:track-1":',
            expect.any(Error)
        );
    });
});
