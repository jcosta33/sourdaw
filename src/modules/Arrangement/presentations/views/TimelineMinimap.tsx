import {
    type ReactElement,
    type MouseEvent,
    type KeyboardEvent,
    useEffect,
    useRef,
    useLayoutEffect,
    useState,
} from 'react';

import { useStore } from '#/infra/store/useStore';
import { transportStore } from '#/modules/Transport/stores';
import {
    normalizeTimelineMinimapHeight,
    TIMELINE_MINIMAP_DEFAULT_HEIGHT,
} from '#/utils/TimelineMinimap/timelineMinimapHeight';

import { timelineViewStore, type TimelineViewState } from '../../stores/timelineViewStore';
import { trackStore, type TrackStoreState } from '../../stores/trackStore';
import { setTimelineMinimapAutoScroll } from '../../useCases/setTimelineMinimapAutoScroll';
import { setTimelineMinimapScrollX } from '../../useCases/setTimelineMinimapScrollX';

import { TimelineChromeSurface } from './TimelineChromeSurface';

const MIN_PROJECT_BEATS = 64;
const VIEWPORT_MIN_WIDTH = 6;

type TimelineMinimapProps = {
    height?: number;
};

type CanvasMetrics = {
    width: number;
    dpr: number;
};

function getDevicePixelRatio(): number {
    const dpr = window.devicePixelRatio;
    if (!Number.isFinite(dpr) || dpr <= 0) {
        return 1;
    }

    return dpr;
}

const defaultTrackState: TrackStoreState = { tracks: [], selectedTrackId: null };
const defaultTimelineView: TimelineViewState = {
    scrollX: 0,
    scrollY: 0,
    pixelsPerBeat: 12,
    autoScrollEnabled: true,
};

export const TimelineMinimap = ({ height = TIMELINE_MINIMAP_DEFAULT_HEIGHT }: TimelineMinimapProps): ReactElement => {
    const activeHeight = normalizeTimelineMinimapHeight(height);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const isDraggingRef = useRef(false);
    const dragOffsetRef = useRef(0);
    // Holds the teardown for the in-flight drag's global listeners so an unmount
    // mid-drag can detach them; null when no drag is active.
    const dragCleanupRef = useRef<(() => void) | null>(null);
    const [canvasMetrics, setCanvasMetrics] = useState<CanvasMetrics>({ width: 0, dpr: 1 });

    const trackState = useStore(trackStore, defaultTrackState);
    const viewState = useStore(timelineViewStore, defaultTimelineView);

    const tracks = trackState.tracks;
    const pixelsPerBeat = viewState.pixelsPerBeat;
    const scrollX = viewState.scrollX;

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        const canvasWidth = canvasMetrics.width;
        const dpr = canvasMetrics.dpr;
        const backingWidth = Math.round(canvasWidth * dpr);
        const backingHeight = Math.round(activeHeight * dpr);
        canvas.width = backingWidth;
        canvas.height = backingHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, backingWidth, backingHeight);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvasWidth, activeHeight);

        if (canvasWidth <= 0) {
            return;
        }

        const trackCount = tracks.length;

        let maxEndBeat = 0;
        for (const track of tracks) {
            for (const clip of track.clips) {
                if (clip.endBeat > maxEndBeat) {
                    maxEndBeat = clip.endBeat;
                }
            }
        }
        const totalBeats = Math.max(MIN_PROJECT_BEATS, maxEndBeat * 1.1);
        const beatsToPixels = canvasWidth / totalBeats;
        const drawableHeight = Math.max(1, activeHeight - 2);
        const laneStep = trackCount > 0 ? drawableHeight / trackCount : drawableHeight;

        // Dark background with subtle gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, activeHeight);
        bgGrad.addColorStop(0, 'rgba(255, 255, 255, 0.035)');
        bgGrad.addColorStop(1, 'rgba(0, 0, 0, 0.02)');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, canvasWidth, activeHeight);

        if (trackCount > 0) {
            for (let index = 0; index < tracks.length; index++) {
                const track = tracks[index]!;
                const y = 1 + index * laneStep;
                const availableHeight = Math.max(1, activeHeight - 1 - y);
                const clipHeight = Math.min(Math.max(1, laneStep - 1), availableHeight);

                for (const clip of track.clips) {
                    const x = clip.startBeat * beatsToPixels;
                    const w = Math.max(1, (clip.endBeat - clip.startBeat) * beatsToPixels);
                    const color = clip.color || track.color || 'oklch(0.40 0.08 250)';

                    ctx.fillStyle = color;
                    ctx.globalAlpha = 0.8;
                    if (w > 3 && clipHeight > 2) {
                        ctx.beginPath();
                        ctx.roundRect(x, y, w, clipHeight, 1);
                        ctx.fill();
                    } else {
                        ctx.fillRect(x, y, w, clipHeight);
                    }
                }
            }
            ctx.globalAlpha = 1;
        }

        const safePixelsPerBeat = pixelsPerBeat > 0 && Number.isFinite(pixelsPerBeat) ? pixelsPerBeat : 12;
        const viewportStartPx = (scrollX / safePixelsPerBeat) * beatsToPixels;
        const visibleBeats = canvasWidth / safePixelsPerBeat;
        const viewportWidthPx = Math.max(VIEWPORT_MIN_WIDTH, visibleBeats * beatsToPixels);
        const boundedViewportStart = Math.max(0, Math.min(canvasWidth, viewportStartPx));
        const boundedViewportWidth = Math.max(0, Math.min(viewportWidthPx, canvasWidth - boundedViewportStart));

        // Viewport indicator with gradient fill
        const vpGrad = ctx.createLinearGradient(0, 0, 0, activeHeight);
        vpGrad.addColorStop(0, 'rgba(255, 255, 255, 0.10)');
        vpGrad.addColorStop(1, 'rgba(255, 255, 255, 0.04)');
        ctx.fillStyle = vpGrad;
        ctx.fillRect(boundedViewportStart, 0, boundedViewportWidth, activeHeight);

        // Viewport border — brighter top edge for dimensionality
        if (boundedViewportWidth > 1) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
            ctx.lineWidth = 1;
            ctx.strokeRect(boundedViewportStart + 0.5, 0.5, boundedViewportWidth - 1, activeHeight - 1);

            // Brighter top edge on viewport
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(boundedViewportStart + 0.5, 0.5);
            ctx.lineTo(boundedViewportStart + boundedViewportWidth - 0.5, 0.5);
            ctx.stroke();
        }
    }, [tracks, pixelsPerBeat, scrollX, canvasMetrics, activeHeight]);

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return undefined;
        }

        const measure = (): void => {
            const rect = container.getBoundingClientRect();
            const dpr = getDevicePixelRatio();
            const width = Math.max(0, rect.width);
            setCanvasMetrics((current) => {
                if (current.width === width && current.dpr === dpr) {
                    return current;
                }
                return { width, dpr };
            });
        };

        const observer = new ResizeObserver(measure);
        let densityQuery: MediaQueryList | null = null;

        const stopObservingDensity = (): void => {
            if (!densityQuery) {
                return;
            }

            densityQuery.onchange = null;
            densityQuery = null;
        };

        const observeDensity = (): void => {
            stopObservingDensity();
            if (typeof window.matchMedia !== 'function') {
                return;
            }

            densityQuery = window.matchMedia(`(resolution: ${getDevicePixelRatio()}dppx)`);
            densityQuery.onchange = handleDensityChange;
        };

        function handleDensityChange(): void {
            measure();
            observeDensity();
        }

        observer.observe(container);
        observeDensity();
        window.addEventListener('resize', measure);

        return () => {
            observer.disconnect();
            stopObservingDensity();
            window.removeEventListener('resize', measure);
        };
    }, []);

    // Detach any global drag listeners still attached when the minimap unmounts.
    useEffect(() => {
        return () => {
            dragCleanupRef.current?.();
            dragCleanupRef.current = null;
        };
    }, []);

    const getMinimapMetrics = () => {
        const container = containerRef.current;
        if (!container) {
            return null;
        }
        const rect = container.getBoundingClientRect();
        const canvasWidth = rect.width;

        let maxEndBeat = 0;
        for (const track of tracks) {
            for (const clip of track.clips) {
                if (clip.endBeat > maxEndBeat) {
                    maxEndBeat = clip.endBeat;
                }
            }
        }
        const totalBeats = Math.max(MIN_PROJECT_BEATS, maxEndBeat * 1.1);
        const beatsToPixels = canvasWidth / totalBeats;
        const visibleBeats = canvasWidth / pixelsPerBeat;
        const viewportWidthPx = Math.max(VIEWPORT_MIN_WIDTH, visibleBeats * beatsToPixels);
        const viewportStartPx = (scrollX / pixelsPerBeat) * beatsToPixels;

        return { canvasWidth, totalBeats, beatsToPixels, viewportWidthPx, viewportStartPx };
    };

    const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();

        const metrics = getMinimapMetrics();
        if (!metrics) {
            return;
        }

        if (transportStore.value?.isPlaying) {
            setTimelineMinimapAutoScroll(false);
        }

        const rect = containerRef.current!.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const { viewportStartPx, viewportWidthPx, beatsToPixels } = metrics;

        let dragOffsetInMinimapPx: number;

        if (clickX >= viewportStartPx && clickX <= viewportStartPx + viewportWidthPx) {
            // Click inside viewport — drag from current offset within it
            dragOffsetInMinimapPx = clickX - viewportStartPx;
        } else {
            // Click outside viewport — jump to center on that point
            const visibleBeats = rect.width / pixelsPerBeat;
            const clickedBeat = clickX / beatsToPixels;
            const targetBeat = Math.max(0, clickedBeat - visibleBeats / 2);
            const newScrollX = targetBeat * pixelsPerBeat;
            setTimelineMinimapScrollX(newScrollX);
            // After jump, the viewport starts at newScrollX in minimap coords
            dragOffsetInMinimapPx = clickX - (newScrollX / pixelsPerBeat) * beatsToPixels;
        }

        isDraggingRef.current = true;
        dragOffsetRef.current = dragOffsetInMinimapPx;

        const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
            if (!isDraggingRef.current) {
                return;
            }
            const container = containerRef.current;
            if (!container) {
                return;
            }
            const currentMetrics = getMinimapMetrics();
            if (!currentMetrics) {
                return;
            }
            // Re-read the rect each move so a remount/resize mid-drag computes
            // against current geometry rather than the rect captured on mousedown.
            const currentRect = container.getBoundingClientRect();
            const moveX = moveEvent.clientX - currentRect.left;
            const newViewportStartPx = moveX - dragOffsetRef.current;
            const targetScrollX = Math.max(0, (newViewportStartPx / currentMetrics.beatsToPixels) * pixelsPerBeat);
            setTimelineMinimapScrollX(targetScrollX);
        };

        const detachListeners = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        const handleMouseUp = () => {
            isDraggingRef.current = false;
            detachListeners();
            dragCleanupRef.current = null;
        };

        dragCleanupRef.current = detachListeners;
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        // Keyboard scrolling for the slider: a small step on the arrows, a full
        // visible page on Page keys, and Home jumps to the start.
        const stepBeats = 4;
        const stepPx = stepBeats * pixelsPerBeat;
        const pageBeats = canvasMetrics.width > 0 ? canvasMetrics.width / pixelsPerBeat : 16;
        const pagePx = pageBeats * pixelsPerBeat;

        if (transportStore.value?.isPlaying) {
            setTimelineMinimapAutoScroll(false);
        }

        switch (event.key) {
            case 'ArrowLeft':
            case 'ArrowDown':
                event.preventDefault();
                setTimelineMinimapScrollX(scrollX - stepPx);
                break;
            case 'ArrowRight':
            case 'ArrowUp':
                event.preventDefault();
                setTimelineMinimapScrollX(scrollX + stepPx);
                break;
            case 'PageUp':
                event.preventDefault();
                setTimelineMinimapScrollX(scrollX - pagePx);
                break;
            case 'PageDown':
                event.preventDefault();
                setTimelineMinimapScrollX(scrollX + pagePx);
                break;
            case 'Home':
                event.preventDefault();
                setTimelineMinimapScrollX(0);
                break;
            default:
                break;
        }
    };

    return (
        <TimelineChromeSurface
            tone="subtle"
            ref={containerRef}
            className="cursor-pointer"
            style={{ height: activeHeight }}
            onMouseDown={handleMouseDown}
            onKeyDown={handleKeyDown}
            tabIndex={0}
            aria-label="Timeline minimap — drag the viewport to scroll, click to jump, or use arrow keys"
            data-testid="timeline-minimap"
            role="slider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((scrollX / Math.max(1, pixelsPerBeat * MIN_PROJECT_BEATS)) * 100)}
        >
            <canvas ref={canvasRef} className="absolute inset-0" style={{ width: '100%', height: activeHeight }} />
        </TimelineChromeSurface>
    );
};
