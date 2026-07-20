import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { publishYeastPreviewRevision } from '../../stores/yeastPreviewRevision';
import { YeastPreviewSurface } from '../views/YeastPreviewSurface';

import { createPreviewEvent, createPreviewSnapshot } from './yeastPreviewFixtures';

import type { YeastPreviewSnapshot } from '../../models/YeastPreviewSnapshot';

const previewMocks = vi.hoisted(() => ({
    subscribe: vi.fn(),
    onSnapshot: undefined as undefined | ((snapshot: YeastPreviewSnapshot, sampledAt: number) => void),
    frames: [] as FrameRequestCallback[],
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
        createYeastPreviewCanvasRenderer: () => ({
            backend: 'canvas2d' as const,
            render: vi.fn(),
            resize: vi.fn(),
            dispose: vi.fn(),
        }),
    };
});

describe('Yeast preview accessibility', () => {
    beforeEach(() => {
        previewMocks.subscribe.mockClear();
        previewMocks.onSnapshot = undefined;
        previewMocks.frames.length = 0;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            previewMocks.frames.push(callback);
            return previewMocks.frames.length;
        });
        vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
            previewMocks.frames.splice(handle - 1, 1);
        });
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
            publishYeastPreviewRevision({
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
            publishYeastPreviewRevision({
                processorId: 'processor-1',
                parameterName: 'amount',
                transient: false,
            });
        });
        expect(previewMocks.frames).toHaveLength(0);
        expect(screen.getByRole('img', { name: /1 upcoming event/i })).toBeInTheDocument();

        act(() => {
            publishYeastPreviewRevision({
                processorId: 'processor-2',
                parameterName: 'amount',
                transient: true,
            });
        });
        expect(previewMocks.frames).toHaveLength(1);

        act(() => {
            previewMocks.frames.shift()?.(16);
        });
        expect(screen.getByRole('img', { name: '0 upcoming events' })).toBeInTheDocument();
    });
});
