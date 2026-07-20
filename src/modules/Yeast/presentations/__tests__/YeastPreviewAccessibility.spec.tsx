import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
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
});
