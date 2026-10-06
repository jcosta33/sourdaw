import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({
    context: { currentTime: 2, sampleRate: 48_000 },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: engine,
}));

const { resolveInputDispatchFrame } = await import('../resolveInputDispatchFrame');
const { resolveInputEventTime } = await import('../resolveInputEventTime');
const { resetLiveInputDispatchFrameFloor } = await import('../../../services/liveInputDispatchFrameFloor');

/** One render quantum, the scheduling budget `resolveInputDispatchFrame` adds to an arrival. */
const SCHEDULING_OFFSET_FRAMES = 128;
const PERFORMANCE_NOW_MS = 10_000;

function dispatchFrameFor(timeStamp: number): number {
    return resolveInputDispatchFrame({ eventTime: resolveInputEventTime({ timeStamp }) });
}

describe('resolveInputDispatchFrame', () => {
    beforeEach(() => {
        resetLiveInputDispatchFrameFloor();
        engine.context = { currentTime: 2, sampleRate: 48_000 };
        vi.spyOn(performance, 'now').mockReturnValue(PERFORMANCE_NOW_MS);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('places an event after the render position by one scheduling quantum when it arrived just now', () => {
        expect(dispatchFrameFor(PERFORMANCE_NOW_MS)).toBe(96_000 + SCHEDULING_OFFSET_FRAMES);
    });

    it('never gives a newer event an earlier frame than an older one that waited out a stall', () => {
        // 1.2 s past MAX_CREDIBLE_INPUT_WAIT_SECONDS: the arrival falls back to now.
        const stalledFrame = dispatchFrameFor(PERFORMANCE_NOW_MS - 1_200);
        // 0.3 s credible wait: the arrival is genuinely earlier than now.
        const laterFrame = dispatchFrameFor(PERFORMANCE_NOW_MS - 300);

        expect(stalledFrame).toBe(96_000 + SCHEDULING_OFFSET_FRAMES);
        expect(laterFrame).toBeGreaterThanOrEqual(stalledFrame);
    });

    it('follows a new AudioContext whose clock restarted instead of the old maximum', () => {
        engine.context = { currentTime: 2, sampleRate: 48_000 };
        const beforeRestart = dispatchFrameFor(PERFORMANCE_NOW_MS);
        expect(beforeRestart).toBe(96_128);

        engine.context = { currentTime: 0.01, sampleRate: 48_000 };
        const afterRestart = dispatchFrameFor(PERFORMANCE_NOW_MS);

        expect(afterRestart).toBe(480 + SCHEDULING_OFFSET_FRAMES);
        expect(afterRestart).toBeLessThan(beforeRestart);
    });
});
