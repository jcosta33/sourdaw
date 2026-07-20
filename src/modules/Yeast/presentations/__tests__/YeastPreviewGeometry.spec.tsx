import { describe, expect, it, vi } from 'vitest';

import { createYeastPreviewCanvasRenderer, createYeastPreviewGeometry } from '../createYeastPreviewCanvasRenderer';
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

    it('invalidates stale events on a processor revision before the first 16 ms frame', () => {
        const frames: FrameRequestCallback[] = [];
        const render = vi.fn();
        const feedback = vi.fn();
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
            onFeedback: feedback,
        });

        presenter.acceptSnapshot(createPreviewSnapshot([createPreviewEvent()]), 0);
        frames.shift()!(0);
        presenter.beginProcessorRevision(1);
        expect(frames).toHaveLength(1);
        frames.shift()!(16);

        expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ events: [] }));
        expect(feedback).toHaveBeenLastCalledWith(expect.objectContaining({ active: false, visibleEvents: 0 }));

        const staleSnapshot = {
            ...createPreviewSnapshot([createPreviewEvent({ eventId: 2 })]),
            captureEpoch: 1,
        };
        presenter.acceptSnapshot(staleSnapshot, 17);
        expect(frames).toHaveLength(0);
        expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ events: [] }));

        presenter.acknowledgeProcessorRevision(1, 2);
        presenter.acceptSnapshot(staleSnapshot, 18);
        expect(frames).toHaveLength(0);

        const currentSnapshot = {
            ...createPreviewSnapshot([createPreviewEvent({ eventId: 3 })]),
            captureEpoch: 2,
        };
        presenter.acceptSnapshot(currentSnapshot, 33);
        frames.shift()!(48);
        expect(render).toHaveBeenLastCalledWith(
            expect.objectContaining({ events: [expect.objectContaining({ eventId: 3 })] })
        );
    });

    it('reallocates the Canvas backing store when only device pixel ratio changes', () => {
        const context = {
            clearRect: vi.fn(),
            save: vi.fn(),
            scale: vi.fn(),
            fillStyle: '',
            fillRect: vi.fn(),
            strokeStyle: '',
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            stroke: vi.fn(),
            restore: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'getContext', { value: () => context });
        vi.stubGlobal('devicePixelRatio', 1);
        const renderer = createYeastPreviewCanvasRenderer(canvas);

        renderer?.resize(200, 100);
        expect(canvas.width).toBe(200);
        expect(canvas.height).toBe(100);

        vi.stubGlobal('devicePixelRatio', 2);
        renderer?.render({ events: [], playheadBeat: 0, lookaheadBeats: 4, width: 200, height: 100 });

        expect(canvas.width).toBe(400);
        expect(canvas.height).toBe(200);
        expect(context.scale).toHaveBeenLastCalledWith(2, 2);
    });
});
