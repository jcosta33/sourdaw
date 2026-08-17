import { describe, expect, it, vi } from 'vitest';

import { createYeastPreviewPresenter } from '../createYeastPreviewPresenter';

import { createPreviewEvent, createPreviewSnapshot } from './yeastPreviewFixtures';

import type { YeastPreviewFeedback } from '../YeastPreviewTypes';

const FRAME_INTERVAL_MS = 1000 / 60;
const SAMPLE_INTERVAL_MS = 1000 / 30;

type ScheduledCallback = Readonly<{
    dueAt: number;
    callback: () => void;
}>;

function createControlledClock() {
    const callbacks = new Map<number, ScheduledCallback>();
    const frameTimes: number[] = [];
    let currentTime = 0;
    let nextHandle = 1;

    function schedule(callback: () => void, delayMs: number): number {
        const handle = nextHandle;
        nextHandle += 1;
        callbacks.set(handle, { dueAt: currentTime + Math.max(0, delayMs), callback });
        return handle;
    }

    function cancel(handle: number): void {
        callbacks.delete(handle);
    }

    function advanceTo(targetTime: number): void {
        while (callbacks.size > 0) {
            let next: Readonly<{ handle: number; scheduled: ScheduledCallback }> | null = null;
            for (const [handle, scheduled] of callbacks) {
                if (scheduled.dueAt > targetTime) {
                    continue;
                }
                if (!next) {
                    next = { handle, scheduled };
                    continue;
                }
                if (scheduled.dueAt < next.scheduled.dueAt) {
                    next = { handle, scheduled };
                }
            }
            if (!next) {
                break;
            }
            callbacks.delete(next.handle);
            currentTime = next.scheduled.dueAt;
            next.scheduled.callback();
        }
        currentTime = targetTime;
    }

    function requestFrame(callback: FrameRequestCallback): number {
        const frameAt = (Math.floor(currentTime / FRAME_INTERVAL_MS) + 1) * FRAME_INTERVAL_MS;
        return schedule(() => {
            frameTimes.push(frameAt);
            callback(frameAt);
        }, frameAt - currentTime);
    }

    return {
        advanceTo,
        cancel,
        frameTimes,
        now: () => currentTime,
        requestFrame,
        setTimer: schedule,
    };
}

describe('Yeast preview performance', () => {
    it('keeps 30 Hz sampling within the frame budget and becomes silent only after 500 ms', () => {
        const clock = createControlledClock();
        const feedback = vi.fn<(value: YeastPreviewFeedback) => void>();
        const presenter = createYeastPreviewPresenter({
            renderer: { backend: 'canvas2d', render: vi.fn(), resize: vi.fn(), dispose: vi.fn() },
            requestFrame: clock.requestFrame,
            cancelFrame: clock.cancel,
            setTimer: clock.setTimer,
            clearTimer: clock.cancel,
            now: clock.now,
            readPlayheadBeat: () => 0,
            onFeedback: feedback,
        });

        const sampleTimes = Array.from({ length: 10 }, (_, index) => index * SAMPLE_INTERVAL_MS);
        for (let index = 0; index < sampleTimes.length; index++) {
            const sampleAt = sampleTimes[index]!;
            clock.advanceTo(sampleAt);
            presenter.acceptSnapshot(
                createPreviewSnapshot([createPreviewEvent({ eventId: index, beatTime: 1 + index / 64 })]),
                sampleAt
            );
        }
        const lastSampleAt = sampleTimes.at(-1)!;
        clock.advanceTo(lastSampleAt + FRAME_INTERVAL_MS + 0.01);

        const activeFeedback = feedback.mock.calls.at(-1)?.[0];
        expect(activeFeedback).toEqual(expect.objectContaining({ active: true, droppedFrames: 0 }));
        expect(activeFeedback?.latencyP95Ms).not.toBeNull();
        expect(activeFeedback?.latencyP95Ms ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
            FRAME_INTERVAL_MS + SAMPLE_INTERVAL_MS
        );
        for (const sampleAt of sampleTimes) {
            const nextFrame = clock.frameTimes.find((frameAt) => frameAt >= sampleAt);
            expect(nextFrame).toBeDefined();
            expect((nextFrame ?? Number.POSITIVE_INFINITY) - sampleAt).toBeLessThanOrEqual(FRAME_INTERVAL_MS + 0.01);
        }

        clock.advanceTo(lastSampleAt + 499.99);
        expect(feedback).toHaveBeenLastCalledWith(expect.objectContaining({ active: true }));
        clock.advanceTo(lastSampleAt + 500);
        expect(feedback).toHaveBeenLastCalledWith(expect.objectContaining({ active: true }));
        clock.advanceTo(lastSampleAt + 500 + FRAME_INTERVAL_MS + 0.01);
        expect(feedback).toHaveBeenLastCalledWith(expect.objectContaining({ active: false }));
    });

    it('coalesces an overload burst without backpressuring preview production', () => {
        const clock = createControlledClock();
        const feedback = vi.fn();
        const presenter = createYeastPreviewPresenter({
            renderer: { backend: 'canvas2d', render: vi.fn(), resize: vi.fn(), dispose: vi.fn() },
            requestFrame: clock.requestFrame,
            cancelFrame: clock.cancel,
            setTimer: clock.setTimer,
            clearTimer: clock.cancel,
            now: clock.now,
            readPlayheadBeat: () => 0,
            onFeedback: feedback,
        });

        for (let index = 0; index < 32; index++) {
            presenter.acceptSnapshot(createPreviewSnapshot([createPreviewEvent({ eventId: index })]), 0);
        }
        clock.advanceTo(FRAME_INTERVAL_MS + 0.01);

        expect(feedback).toHaveBeenLastCalledWith(expect.objectContaining({ active: true, droppedFrames: 31 }));
    });

    it('never grows the visual event field beyond the fixed tap capacity', () => {
        const frames: FrameRequestCallback[] = [];
        const feedback = vi.fn();
        const presenter = createYeastPreviewPresenter({
            renderer: { backend: 'canvas2d', render: vi.fn(), resize: vi.fn(), dispose: vi.fn() },
            requestFrame: (callback) => {
                frames.push(callback);
                return frames.length;
            },
            cancelFrame: vi.fn(),
            setTimer: vi.fn(() => 1),
            clearTimer: vi.fn(),
            now: () => 0,
            readPlayheadBeat: () => 0,
            onFeedback: feedback,
        });

        presenter.acceptSnapshot(
            createPreviewSnapshot(
                Array.from({ length: 512 }, (_, eventId) => createPreviewEvent({ eventId, beatTime: 1 }))
            ),
            0
        );
        presenter.acceptSnapshot(createPreviewSnapshot([createPreviewEvent({ eventId: 999, beatTime: 1 })]), 0);
        frames.shift()!(16);

        expect(feedback).toHaveBeenLastCalledWith(
            expect.objectContaining({ visibleEvents: 512, droppedVisualEvents: 1 })
        );
    });

    it('clears scope-local work and metrics before publishing a blank frame', () => {
        const frames: FrameRequestCallback[] = [];
        const render = vi.fn();
        const feedback = vi.fn();
        const cancelFrame = vi.fn();
        const clearTimer = vi.fn();
        const presenter = createYeastPreviewPresenter({
            renderer: { backend: 'canvas2d', render, resize: vi.fn(), dispose: vi.fn() },
            requestFrame: (callback) => {
                frames.push(callback);
                return frames.length;
            },
            cancelFrame,
            setTimer: vi.fn(() => 7),
            clearTimer,
            now: () => 0,
            readPlayheadBeat: () => 0,
            onFeedback: feedback,
        });

        presenter.acceptSnapshot(createPreviewSnapshot([createPreviewEvent()], { droppedEvents: 4 }), 0);
        frames.shift()!(32);
        presenter.acceptSnapshot(createPreviewSnapshot([createPreviewEvent({ eventId: 2 })]), 40);
        presenter.acceptSnapshot(createPreviewSnapshot([createPreviewEvent({ eventId: 3 })]), 40);

        presenter.resetForScope();

        expect(cancelFrame).toHaveBeenCalledOnce();
        expect(clearTimer).toHaveBeenCalledWith(7);
        expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ events: [] }));
        expect(feedback).toHaveBeenLastCalledWith({
            hasSample: false,
            active: false,
            latencyP95Ms: null,
            visibleEvents: 0,
            droppedEvents: 0,
            droppedFrames: 0,
            droppedVisualEvents: 0,
            processorActivity: [],
            summary: '0 upcoming events',
            soundingPitches: [],
        });
    });
});
