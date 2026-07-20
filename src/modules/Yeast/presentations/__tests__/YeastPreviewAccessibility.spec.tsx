import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    publishAppliedYeastPreviewRevision,
    publishPendingYeastPreviewRevision,
} from '../../stores/yeastPreviewRevision';
import { YeastPreviewSurface } from '../views/YeastPreviewSurface';

import { createPreviewEvent, createPreviewSnapshot } from './yeastPreviewFixtures';

import type { YeastPreviewSnapshot } from '../../models/YeastPreviewSnapshot';

const previewMocks = vi.hoisted(() => ({
    subscribe: vi.fn(),
    resetCapture: vi.fn(() => 2),
    onSnapshot: undefined as undefined | ((snapshot: YeastPreviewSnapshot, sampledAt: number) => void),
    frames: [] as FrameRequestCallback[],
    rendererAvailable: true,
    rendererResize: vi.fn(),
    viewportWidth: 320,
    resizeObserverCallback: null as ResizeObserverCallback | null,
    resizeObserverTarget: null as Element | null,
}));

vi.mock('../../useCases/resetYeastPreviewCapture', () => ({
    resetYeastPreviewCapture: previewMocks.resetCapture,
}));

vi.mock('../../useCases/subscribeYeastPreview', () => ({
    subscribeYeastPreview: vi.fn(
        (input: { onSnapshot: (snapshot: YeastPreviewSnapshot, sampledAt: number) => void }) => {
            previewMocks.onSnapshot = input.onSnapshot;
            previewMocks.subscribe(input);
            return vi.fn();
        }
    ),
}));

vi.mock('../createYeastPreviewCanvasRenderer', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../createYeastPreviewCanvasRenderer')>();
    return {
        ...actual,
        createYeastPreviewCanvasRenderer: () => {
            if (!previewMocks.rendererAvailable) {
                return null;
            }
            return {
                backend: 'canvas2d' as const,
                render: vi.fn(),
                resize: previewMocks.rendererResize,
                dispose: vi.fn(),
            };
        },
    };
});

class MockResizeObserver {
    constructor(callback: ResizeObserverCallback) {
        previewMocks.resizeObserverCallback = callback;
    }

    observe(target: Element): void {
        previewMocks.resizeObserverTarget = target;
    }

    unobserve(): void {}

    disconnect(): void {}
}

describe('Yeast preview accessibility', () => {
    beforeEach(() => {
        previewMocks.subscribe.mockClear();
        previewMocks.resetCapture.mockClear();
        previewMocks.onSnapshot = undefined;
        previewMocks.frames.length = 0;
        previewMocks.rendererAvailable = true;
        previewMocks.rendererResize.mockClear();
        previewMocks.viewportWidth = 320;
        previewMocks.resizeObserverCallback = null;
        previewMocks.resizeObserverTarget = null;
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
            () => new DOMRect(0, 0, previewMocks.viewportWidth, 112)
        );
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            previewMocks.frames.push(callback);
            return previewMocks.frames.length;
        });
        vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
            previewMocks.frames.splice(handle - 1, 1);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('reports the actual renderer factory failure instead of trusting a throwaway probe', async () => {
        previewMocks.rendererAvailable = false;

        render(
            <YeastPreviewSurface
                scope={{ rackId: 'rack-1', routeId: 'track-1', trackId: 'track-1' }}
                processors={[]}
                runtimeStatus="ready"
            />
        );

        expect(await screen.findByText('Canvas preview is unavailable.')).toHaveAttribute(
            'data-reason-code',
            'renderer-unavailable'
        );
        expect(screen.getByText('Error')).toBeInTheDocument();
    });

    it('observes layout-owned parent width changes without pinning the Canvas size', () => {
        render(
            <YeastPreviewSurface
                scope={{ rackId: 'rack-1', routeId: 'track-1', trackId: 'track-1' }}
                processors={[]}
                runtimeStatus="ready"
            />
        );

        const canvas = screen.getByRole('img');
        expect(previewMocks.resizeObserverTarget).toBe(canvas.parentElement);
        expect(previewMocks.rendererResize).toHaveBeenCalledWith(320, 112);

        previewMocks.viewportWidth = 480;
        act(() => {
            previewMocks.resizeObserverCallback?.([], {} as ResizeObserver);
        });

        expect(previewMocks.rendererResize).toHaveBeenLastCalledWith(480, 112);
    });

    it('uses one Canvas surface and exposes a keyboard-readable event summary', () => {
        render(
            <YeastPreviewSurface
                scope={{ rackId: 'rack-1', routeId: 'track-1', trackId: 'track-1' }}
                processors={[]}
                runtimeStatus="ready"
            />
        );

        act(() => {
            previewMocks.onSnapshot?.(
                createPreviewSnapshot([
                    createPreviewEvent({ eventId: 1, pitch: 60, probability: null }),
                    createPreviewEvent({ eventId: 2, pitch: 72 }),
                ]),
                performance.now()
            );
            previewMocks.frames.shift()?.(performance.now());
        });

        const canvas = screen.getByRole('img', { name: /2 upcoming events/i });
        expect(canvas).toHaveAttribute('tabindex', '0');
        expect(canvas).toHaveAttribute('aria-label', expect.stringContaining('1 non-deterministic'));
        expect(document.querySelectorAll('canvas')).toHaveLength(1);
        expect(document.querySelectorAll('[data-preview-event]')).toHaveLength(0);
    });

    it('clears route activity before unbinding and rebinding the preview scope', () => {
        const { rerender } = render(
            <YeastPreviewSurface
                scope={{ rackId: 'rack-a', routeId: 'track-a', trackId: 'track-a' }}
                processors={[]}
                runtimeStatus="ready"
            />
        );

        act(() => {
            previewMocks.onSnapshot?.(
                createPreviewSnapshot([
                    createPreviewEvent({ rackId: 'rack-a', routeId: 'track-a', trackId: 'track-a' }),
                ]),
                performance.now()
            );
            previewMocks.frames.shift()?.(performance.now());
        });
        expect(screen.getByRole('img', { name: /1 upcoming event/i })).toBeInTheDocument();

        rerender(
            <YeastPreviewSurface
                scope={null}
                unavailableReason={{ code: 'no-track', message: 'Select a MIDI track.' }}
                processors={[]}
                runtimeStatus="ready"
            />
        );
        expect(screen.getByRole('img', { name: '0 upcoming events' })).toBeInTheDocument();

        rerender(
            <YeastPreviewSurface
                scope={{ rackId: 'rack-b', routeId: 'track-b', trackId: 'track-b' }}
                processors={[]}
                runtimeStatus="ready"
            />
        );
        expect(screen.getByRole('img', { name: '0 upcoming events' })).toBeInTheDocument();
        expect(previewMocks.subscribe).toHaveBeenLastCalledWith(expect.objectContaining({ rackId: 'rack-b' }));
    });

    it('ignores unrelated revisions and clears its processor before the next preview poll', () => {
        const { rerender } = render(
            <YeastPreviewSurface
                scope={{ rackId: 'rack-1', routeId: 'track-1', trackId: 'track-1' }}
                processors={[{ id: 'processor-1', bypassed: false }]}
                runtimeStatus="ready"
            />
        );

        act(() => {
            previewMocks.onSnapshot?.(createPreviewSnapshot([createPreviewEvent()]), performance.now());
            previewMocks.frames.shift()?.(0);
        });
        expect(screen.getByRole('img', { name: /1 upcoming event/i })).toBeInTheDocument();

        act(() => {
            publishPendingYeastPreviewRevision({
                processorId: 'another-processor',
                parameterName: 'amount',
                transient: false,
            });
        });
        expect(previewMocks.frames).toHaveLength(0);
        expect(screen.getByRole('img', { name: /1 upcoming event/i })).toBeInTheDocument();

        rerender(
            <YeastPreviewSurface
                scope={{ rackId: 'rack-1', routeId: 'track-1', trackId: 'track-1' }}
                processors={[{ id: 'processor-2', bypassed: false }]}
                runtimeStatus="ready"
            />
        );

        act(() => {
            publishPendingYeastPreviewRevision({
                processorId: 'processor-1',
                parameterName: 'amount',
                transient: false,
            });
        });
        expect(previewMocks.frames).toHaveLength(0);
        expect(screen.getByRole('img', { name: /1 upcoming event/i })).toBeInTheDocument();

        let supersededRevision = 0;
        let currentRevision = 0;
        act(() => {
            supersededRevision = publishPendingYeastPreviewRevision({
                processorId: 'processor-2',
                parameterName: 'amount',
                transient: true,
            });
            currentRevision = publishPendingYeastPreviewRevision({
                processorId: 'processor-2',
                parameterName: 'amount',
                transient: true,
            });
        });
        expect(previewMocks.frames).toHaveLength(1);
        expect(previewMocks.resetCapture).not.toHaveBeenCalled();

        act(() => {
            previewMocks.frames.shift()?.(16);
        });
        expect(screen.getByRole('img', { name: '0 upcoming events' })).toBeInTheDocument();

        rerender(
            <YeastPreviewSurface
                scope={{ rackId: 'rack-1', routeId: 'track-1', trackId: 'track-1' }}
                processors={[]}
                runtimeStatus="ready"
            />
        );

        act(() => {
            previewMocks.onSnapshot?.(
                createPreviewSnapshot([createPreviewEvent({ eventId: 10 })], { captureEpoch: 1 }),
                17
            );
        });
        expect(previewMocks.frames).toHaveLength(0);
        expect(screen.getByRole('img', { name: '0 upcoming events' })).toBeInTheDocument();

        act(() => {
            publishAppliedYeastPreviewRevision({
                processorId: 'processor-2',
                parameterName: 'amount',
                transient: true,
                revision: supersededRevision,
            });
        });
        expect(previewMocks.resetCapture).not.toHaveBeenCalled();

        act(() => {
            publishAppliedYeastPreviewRevision({
                processorId: 'processor-2',
                parameterName: 'amount',
                transient: true,
                revision: currentRevision,
            });
        });
        expect(previewMocks.resetCapture).toHaveBeenCalledWith({
            rackId: 'rack-1',
            routeId: 'track-1',
            trackId: 'track-1',
        });

        act(() => {
            previewMocks.onSnapshot?.(
                createPreviewSnapshot([createPreviewEvent({ eventId: 11 })], { captureEpoch: 1 }),
                18
            );
        });
        expect(previewMocks.frames).toHaveLength(0);

        act(() => {
            previewMocks.onSnapshot?.(
                createPreviewSnapshot([createPreviewEvent({ eventId: 12 })], { captureEpoch: 2 }),
                19
            );
            previewMocks.frames.shift()?.(32);
        });
        expect(screen.getByRole('img', { name: /1 upcoming event/i })).toBeInTheDocument();
    });
});
