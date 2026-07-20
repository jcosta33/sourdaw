import { describe, expect, it, vi } from 'vitest';

import { createYeastPreviewGeometry } from '../createYeastPreviewCanvasRenderer';
import { createYeastPreviewPresenter } from '../createYeastPreviewPresenter';

import { createPreviewEvent, createPreviewSnapshot } from './yeastPreviewFixtures';

describe('Yeast preview geometry', () => {
    it('maps time, pitch, duration, and velocity without losing monotonic order', () => {
        const frame = createYeastPreviewGeometry({
            events: [
                createPreviewEvent({ eventId: 1, beatTime: 1, durationBeats: 0.25, pitch: 48, velocity: 0.2 }),
                createPreviewEvent({ eventId: 2, beatTime: 2, durationBeats: 1, pitch: 72, velocity: 0.9 }),
            ],
            playheadBeat: 0,
            lookaheadBeats: 4,
            width: 400,
            height: 100,
        });

        expect(frame.events[0]!.x).toBeLessThan(frame.events[1]!.x);
        expect(frame.events[0]!.y).toBeGreaterThan(frame.events[1]!.y);
        expect(frame.events[0]!.width).toBeLessThan(frame.events[1]!.width);
        expect(frame.events[0]!.brightness).toBeLessThan(frame.events[1]!.brightness);
        expect(frame.pitchRange).toEqual({ minimum: 48, maximum: 72 });
    });

    it('renders a lookahead or processor revision change on the next animation frame', () => {
        const frames: FrameRequestCallback[] = [];
        const render = vi.fn();
        const presenter = createYeastPreviewPresenter({
            renderer: { backend: 'canvas2d', render, resize: vi.fn(), dispose: vi.fn() },
            requestFrame: (callback) => {
                frames.push(callback);
                return frames.length;
            },
            cancelFrame: vi.fn(),
            setTimer: vi.fn(() => 1),
            clearTimer: vi.fn(),
            now: () => 0,
            readPlayheadBeat: () => 0,
            onFeedback: vi.fn(),
        });

        presenter.acceptSnapshot(createPreviewSnapshot([createPreviewEvent()]), 0);
        frames.shift()!(16);
        presenter.updateView({ lookaheadBeats: 8 });
        expect(frames).toHaveLength(1);
        frames.shift()!(32);

        expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ lookaheadBeats: 8 }));
    });
});
