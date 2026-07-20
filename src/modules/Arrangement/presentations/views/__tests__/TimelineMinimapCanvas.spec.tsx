import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimelineMinimap } from '../TimelineMinimap';

const stores = vi.hoisted(() => ({
    trackStore: { kind: 'tracks' },
    timelineViewStore: { kind: 'view' },
    tracks: {
        tracks: [
            {
                id: 'track-1',
                color: '#112233',
                clips: [{ id: 'clip-1', startBeat: 8, endBeat: 24, color: '#445566' }],
            },
        ],
        selectedTrackId: null,
    },
    view: { scrollX: 48, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true },
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: unknown, fallback: unknown) => {
        if (store === stores.trackStore) {
            return stores.tracks;
        }
        if (store === stores.timelineViewStore) {
            return stores.view;
        }
        return fallback;
    }),
}));

vi.mock('#/modules/Transport/stores', () => ({
    transportStore: { value: { isPlaying: false } },
}));

vi.mock('../../../stores/trackStore', () => ({ trackStore: stores.trackStore }));
vi.mock('../../../stores/timelineViewStore', () => ({ timelineViewStore: stores.timelineViewStore }));
vi.mock('../../../useCases/setTimelineMinimapScrollX', () => ({ setTimelineMinimapScrollX: vi.fn() }));
vi.mock('../../../useCases/setTimelineMinimapAutoScroll', () => ({ setTimelineMinimapAutoScroll: vi.fn() }));
vi.mock('../TimelineChromeSurface', () => ({
    TimelineChromeSurface: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
        <div {...props}>{children}</div>
    ),
}));

type ResizeObserverHarness = {
    callback: ResizeObserverCallback | null;
};

const resizeObserverHarness: ResizeObserverHarness = { callback: null };

type DensityObserverHarness = {
    query: MediaQueryList | null;
};

const densityObserverHarness: DensityObserverHarness = { query: null };

class MockResizeObserver {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
        resizeObserverHarness.callback = callback;
        this.callback = callback;
    }
    observe(): void {
        this.callback([], this);
    }
    unobserve(): void {}
    disconnect(): void {}
}

const context = {
    setTransform: vi.fn(),
    scale: vi.fn(),
    clearRect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
};

describe('TimelineMinimap canvas sizing and drawing', () => {
    let cssWidth = 200;

    beforeEach(() => {
        vi.clearAllMocks();
        resizeObserverHarness.callback = null;
        densityObserverHarness.query = null;
        cssWidth = 200;
        global.ResizeObserver = MockResizeObserver;
        vi.stubGlobal(
            'matchMedia',
            vi.fn((query: string) => {
                const mediaQueryList = {
                    matches: true,
                    media: query,
                    onchange: null,
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                    addListener: vi.fn(),
                    removeListener: vi.fn(),
                    dispatchEvent: vi.fn(),
                };
                densityObserverHarness.query = mediaQueryList;
                return densityObserverHarness.query;
            })
        );
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
            () => new DOMRect(0, 0, cssWidth, 160)
        );
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (contextId: string) {
            if (contextId === '2d') {
                return context as unknown as CanvasRenderingContext2D;
            }
            return null;
        } as typeof HTMLCanvasElement.prototype.getContext);
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1.5 });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('rounds backing dimensions from live CSS size and DPR and resets the transform before drawing', () => {
        const { container } = render(<TimelineMinimap height={160} />);
        const canvas = container.querySelector('canvas');

        expect(canvas).toHaveAttribute('width', '300');
        expect(canvas).toHaveAttribute('height', '240');
        expect(context.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
        expect(context.setTransform).toHaveBeenCalledWith(1.5, 0, 0, 1.5, 0, 0);
        expect(context.clearRect).toHaveBeenCalledWith(0, 0, 200, 160);
    });

    it('redraws after width and height changes without cumulative scaling', () => {
        const { container, rerender } = render(<TimelineMinimap height={28} />);
        const canvas = container.querySelector('canvas');

        cssWidth = 120;
        act(() => {
            resizeObserverHarness.callback?.(
                [{ contentRect: new DOMRectReadOnly(0, 0, 120, 80) } as ResizeObserverEntry],
                {} as ResizeObserver
            );
        });
        rerender(<TimelineMinimap height={80} />);

        expect(canvas).toHaveAttribute('width', '180');
        expect(canvas).toHaveAttribute('height', '120');
        expect(context.scale).not.toHaveBeenCalled();
        expect(context.setTransform).toHaveBeenLastCalledWith(1.5, 0, 0, 1.5, 0, 0);
    });

    it('redraws for a DPR-only change without a geometry or window resize signal', () => {
        const { container } = render(<TimelineMinimap height={160} />);
        const canvas = container.querySelector('canvas');

        expect(canvas).toHaveAttribute('width', '300');
        expect(canvas).toHaveAttribute('height', '240');

        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2.25 });
        act(() => {
            densityObserverHarness.query?.onchange?.({} as MediaQueryListEvent);
        });

        expect(canvas).toHaveAttribute('width', '450');
        expect(canvas).toHaveAttribute('height', '360');
        expect(context.setTransform).toHaveBeenLastCalledWith(2.25, 0, 0, 2.25, 0, 0);
    });

    it('uses added height for track density while preserving horizontal clip mapping', () => {
        const { rerender } = render(<TimelineMinimap height={28} />);
        const compactClip = context.roundRect.mock.calls.at(-1);
        if (!compactClip) {
            throw new Error('Expected a compact-height clip draw');
        }

        rerender(<TimelineMinimap height={160} />);
        const expandedClip = context.roundRect.mock.calls.at(-1);
        if (!expandedClip) {
            throw new Error('Expected an expanded-height clip draw');
        }

        expect(expandedClip[0]).toBe(compactClip[0]);
        expect(expandedClip[2]).toBe(compactClip[2]);
        expect(Number(expandedClip[3])).toBeGreaterThan(Number(compactClip[3]));
        for (const value of expandedClip.slice(0, 4)) {
            expect(Number.isFinite(Number(value))).toBe(true);
        }
    });

    it('survives a zero-to-positive width transition with finite geometry', () => {
        cssWidth = 0;
        const { container } = render(<TimelineMinimap height={64} />);
        const canvas = container.querySelector('canvas');
        expect(canvas).toHaveAttribute('width', '0');

        cssWidth = 90;
        act(() => {
            resizeObserverHarness.callback?.(
                [{ contentRect: new DOMRectReadOnly(0, 0, 90, 64) } as ResizeObserverEntry],
                {} as ResizeObserver
            );
        });

        expect(canvas).toHaveAttribute('width', '135');
        const drawArguments = [...context.fillRect.mock.calls, ...context.strokeRect.mock.calls].flat();
        for (const value of drawArguments) {
            expect(Number.isFinite(Number(value))).toBe(true);
        }
    });
});
