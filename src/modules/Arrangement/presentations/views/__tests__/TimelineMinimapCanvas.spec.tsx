import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyDocumentTheme } from '#/utils/UI/applyDocumentTheme';
import { resetResolvedTokenCache, resolveToken } from '#/utils/UI/resolveToken';

import { type ArrangementSection } from '../../../models/Marker';
import { TimelineMinimap } from '../TimelineMinimap';

const stores = vi.hoisted(() => ({
    trackStore: { kind: 'tracks' },
    markerStore: { kind: 'markers' },
    timelineViewStore: { kind: 'view' },
    markers: { markers: [], sections: [] as ArrangementSection[] },
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
        if (store === stores.markerStore) {
            return stores.markers;
        }
        if (store === stores.timelineViewStore) {
            return stores.view;
        }
        return fallback;
    }),
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: { value: { isPlaying: false } },
}));

vi.mock('../../../stores/trackStore', () => ({ trackStore: stores.trackStore }));
vi.mock('../../../stores/markerStore', () => ({
    markerStore: stores.markerStore,
    defaultMarkerStoreState: { markers: [], sections: [] },
}));
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
    font: '',
    textBaseline: '',
    fillText: vi.fn(),
    measureText: vi.fn(),
};

const labelFillStyles: string[] = [];
const measuredLabelFonts: string[] = [];

describe('TimelineMinimap canvas sizing and drawing', () => {
    let cssWidth = 200;

    beforeEach(() => {
        vi.clearAllMocks();
        resetResolvedTokenCache();
        document.documentElement.style.removeProperty('--color-text-primary');
        labelFillStyles.length = 0;
        measuredLabelFonts.length = 0;
        context.fillStyle = '';
        context.font = '10px sans-serif';
        context.fillText.mockImplementation(() => {
            labelFillStyles.push(context.fillStyle);
        });
        context.measureText.mockImplementation((text: string) => {
            measuredLabelFonts.push(context.font);
            return { width: text.length * 5 };
        });
        stores.markers = { markers: [], sections: [] };
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
        cleanup();
        document.documentElement.style.removeProperty('--color-text-primary');
        resetResolvedTokenCache();
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

    it('draws sparse section labels above clips and keeps the viewport overlay last', () => {
        stores.markers.sections = [
            { id: 'intro', name: 'Intro', startBeat: 0, endBeat: 16, color: '#aa3300' },
            { id: 'verse', name: 'Verse', startBeat: 16, endBeat: 32, color: '#00aa33' },
        ];

        render(<TimelineMinimap height={28} />);

        expect(context.fillText.mock.calls.map(([text]) => text)).toEqual(['Intro', 'Verse']);
        const clip = context.roundRect.mock.calls[0];
        if (!clip) {
            throw new Error('Expected the clip to be drawn');
        }
        expect(Number(clip[1])).toBeGreaterThanOrEqual(11);
        expect(context.strokeRect).toHaveBeenCalledTimes(1);
        expect(context.strokeRect.mock.invocationCallOrder[0]).toBeGreaterThan(
            context.fillText.mock.invocationCallOrder.at(-1)!
        );
    });

    it('resolves label color from the theme and sets the font before every measurement', () => {
        document.documentElement.style.setProperty('--color-text-primary', '#123456');
        stores.markers.sections = [
            { id: 'intro', name: 'Intro', startBeat: 0, endBeat: 16, color: '#aa3300' },
            { id: 'verse', name: 'Verse', startBeat: 16, endBeat: 32, color: '#00aa33' },
        ];

        render(<TimelineMinimap height={28} />);

        expect(labelFillStyles).toEqual(['#123456', '#123456']);
        expect(measuredLabelFonts).toEqual(['9px sans-serif', '9px sans-serif']);
    });

    it('repaints section labels on a document theme change without resizing', async () => {
        const root = document.documentElement;
        const originalClass = root.className;
        const originalStyle = root.getAttribute('style');
        const themeColor = document.querySelector('meta[name="theme-color"]');
        const originalThemeColor = themeColor?.getAttribute('content');
        const style = document.createElement('style');
        style.textContent =
            ':root.dark { --color-text-primary: #eeeeee; } :root.light { --color-text-primary: #111111; }';
        let unmount = (): void => {};

        try {
            document.head.append(style);
            applyDocumentTheme('dark');
            stores.markers.sections = [{ id: 'intro', name: 'Intro', startBeat: 0, endBeat: 16, color: '#aa3300' }];
            const view = render(<TimelineMinimap height={28} />);
            unmount = view.unmount;
            expect(labelFillStyles.at(-1)).toBe('#eeeeee');

            await act(async () => {
                await new Promise<void>((resolve) => {
                    const observer = new MutationObserver(() => {
                        observer.disconnect();
                        resolve();
                    });
                    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
                    applyDocumentTheme('light');
                });
            });

            expect(resolveToken('--color-text-primary', 'missing')).toBe('#111111');
            expect(labelFillStyles.at(-1)).toBe('#111111');

            cssWidth = 201;
            act(() => {
                resizeObserverHarness.callback?.([], {} as ResizeObserver);
            });
            expect(labelFillStyles.at(-1)).toBe('#111111');
        } finally {
            unmount();
            style.remove();
            root.className = originalClass;
            if (originalStyle === null) {
                root.removeAttribute('style');
            } else {
                root.setAttribute('style', originalStyle);
            }
            if (themeColor) {
                if (originalThemeColor === null) {
                    themeColor.removeAttribute('content');
                } else if (originalThemeColor !== undefined) {
                    themeColor.setAttribute('content', originalThemeColor);
                }
            }
            resetResolvedTokenCache();
        }
    });

    it('suppresses labels at dense landmark spacing without dropping boundaries or the viewport', () => {
        stores.markers.sections = Array.from({ length: 24 }, (_, index) => ({
            id: `section-${index}`,
            name: `Section ${index}`,
            startBeat: index * 2,
            endBeat: index * 2 + 2,
            color: '#778899',
        }));

        render(<TimelineMinimap height={28} />);

        expect(context.fillText).not.toHaveBeenCalled();
        expect(context.moveTo).toHaveBeenCalledTimes(49);
        expect(context.strokeRect).toHaveBeenCalledTimes(1);
    });

    it('redraws labels from the current section snapshot after an edit', () => {
        stores.markers.sections = [{ id: 'intro', name: 'Intro', startBeat: 0, endBeat: 16, color: '#aa3300' }];
        const { rerender } = render(<TimelineMinimap height={28} />);
        expect(context.fillText).toHaveBeenCalledWith('Intro', expect.any(Number), expect.any(Number));

        stores.markers.sections = [{ id: 'intro', name: 'Opening', startBeat: 0, endBeat: 16, color: '#aa3300' }];
        rerender(<TimelineMinimap height={28} />);

        expect(context.fillText).toHaveBeenCalledWith('Opening', expect.any(Number), expect.any(Number));
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
