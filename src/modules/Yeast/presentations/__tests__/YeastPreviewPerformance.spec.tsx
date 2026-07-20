import { describe, expect, it, vi } from 'vitest';

import { createYeastPreviewPresenter } from '../createYeastPreviewPresenter';

import { createPreviewEvent, createPreviewSnapshot } from './yeastPreviewFixtures';

describe('Yeast preview performance', () => {
    it('coalesces overload, reports bounded p95 age, and becomes silent on the first frame after 500 ms', () => {
        const frames: FrameRequestCallback[] = [];
        const timers: Array<() => void> = [];
        const feedback = vi.fn();
        const presenter = createYeastPreviewPresenter({
            renderer: { backend: 'canvas2d', render: vi.fn(), resize: vi.fn(), dispose: vi.fn() },
            requestFrame: (callback) => {
                frames.push(callback);
                return frames.length;
            },
            cancelFrame: vi.fn(),
            setTimer: (callback) => {
                timers.push(callback);
                return timers.length;
            },
            clearTimer: vi.fn(),
            now: () => 0,
            readPlayheadBeat: () => 0,
            onFeedback: feedback,
        });

        for (let index = 0; index < 32; index++) {
            presenter.acceptSnapshot(
                createPreviewSnapshot([createPreviewEvent({ eventId: index, beatTime: 1 + index / 64 })]),
                0
            );
        }

        expect(frames).toHaveLength(1);
        frames.shift()!(48);
        expect(feedback).toHaveBeenLastCalledWith(
            expect.objectContaining({ active: true, latencyP95Ms: 48, droppedFrames: 31 })
        );

        timers.at(-1)!();
        expect(frames).toHaveLength(1);
        frames.shift()!(516);
        expect(feedback).toHaveBeenLastCalledWith(expect.objectContaining({ active: false }));
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
});
