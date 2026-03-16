import { type ReactElement, type MouseEvent as ReactMouseEvent, useRef, useEffect, useSyncExternalStore } from "react";
import { trackStore } from "#/modules/Track/stores/trackStore";
import { timelineViewStore } from "../../stores/timelineViewStore";
import { scrollTimeline } from "../../stores/timelineViewStore";

const MINIMAP_HEIGHT = 28;
const MIN_PROJECT_BEATS = 64;
const VIEWPORT_MIN_WIDTH = 6;

export const TimelineMinimap = (): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const isDraggingRef = useRef(false);
    const dragOffsetRef = useRef(0);

    const trackState = useSyncExternalStore(
        (cb) => trackStore.subscribe(() => cb()),
        () => trackStore.value,
        () => trackStore.value,
    );

    const viewState = useSyncExternalStore(
        (cb) => timelineViewStore.subscribe(() => cb()),
        () => timelineViewStore.value,
        () => timelineViewStore.value,
    );

    const tracks = trackState?.tracks ?? [];
    const pixelsPerBeat = viewState?.pixelsPerBeat ?? 12;
    const scrollX = viewState?.scrollX ?? 0;

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) {
            return;
        }

        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = MINIMAP_HEIGHT * dpr;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
            return;
        }
        ctx.scale(dpr, dpr);

        const canvasWidth = rect.width;
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
        const trackLaneHeight = trackCount > 0 ? (MINIMAP_HEIGHT - 2) / trackCount : MINIMAP_HEIGHT - 2;
        const clampedLaneHeight = Math.min(trackLaneHeight, 8);

        ctx.clearRect(0, 0, canvasWidth, MINIMAP_HEIGHT);

        ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
        ctx.fillRect(0, 0, canvasWidth, MINIMAP_HEIGHT);

        if (trackCount > 0) {
            const laneOffset = (MINIMAP_HEIGHT - trackCount * clampedLaneHeight) / 2;

            for (let i = 0; i < tracks.length; i++) {
                const track = tracks[i]!;
                const y = laneOffset + i * clampedLaneHeight;

                for (const clip of track.clips) {
                    const x = clip.startBeat * beatsToPixels;
                    const w = Math.max(1, (clip.endBeat - clip.startBeat) * beatsToPixels);
                    const color = clip.color || track.color || "oklch(0.65 0.15 260)";

                    ctx.fillStyle = color;
                    ctx.globalAlpha = 0.85;
                    ctx.fillRect(x, y, w, Math.max(1, clampedLaneHeight - 1));
                }
            }
            ctx.globalAlpha = 1;
        }

        const viewportStartPx = (scrollX / pixelsPerBeat) * beatsToPixels;
        const containerWidth = rect.width;
        const visibleBeats = containerWidth / pixelsPerBeat;
        const viewportWidthPx = Math.max(VIEWPORT_MIN_WIDTH, visibleBeats * beatsToPixels);

        ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        ctx.fillRect(viewportStartPx, 0, viewportWidthPx, MINIMAP_HEIGHT);

        ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
        ctx.lineWidth = 1;
        ctx.strokeRect(viewportStartPx + 0.5, 0.5, viewportWidthPx - 1, MINIMAP_HEIGHT - 1);
    }, [tracks, pixelsPerBeat, scrollX]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) {
            return;
        }

        const observer = new ResizeObserver(() => {
            const canvas = canvasRef.current;
            if (!canvas) {
                return;
            }
            const rect = container.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            canvas.width = rect.width * dpr;
            canvas.height = MINIMAP_HEIGHT * dpr;
        });

        observer.observe(container);
        return () => observer.disconnect();
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

    const scrollToBeat = (beat: number) => {
        const newScrollX = beat * pixelsPerBeat;
        const current = scrollX;
        scrollTimeline(newScrollX - current);
    };

    const handleMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) {
            return;
        }
        e.preventDefault();

        const metrics = getMinimapMetrics();
        if (!metrics) {
            return;
        }

        const rect = containerRef.current!.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const { viewportStartPx, viewportWidthPx, beatsToPixels } = metrics;

        if (clickX >= viewportStartPx && clickX <= viewportStartPx + viewportWidthPx) {
            isDraggingRef.current = true;
            dragOffsetRef.current = clickX - viewportStartPx;
        } else {
            const containerWidth = rect.width;
            const visibleBeats = containerWidth / pixelsPerBeat;
            const clickedBeat = clickX / beatsToPixels;
            const targetBeat = clickedBeat - visibleBeats / 2;
            scrollToBeat(Math.max(0, targetBeat));
            isDraggingRef.current = true;
            const newViewportStart = Math.max(0, targetBeat) * pixelsPerBeat / pixelsPerBeat * beatsToPixels;
            dragOffsetRef.current = clickX - newViewportStart;
        }

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!isDraggingRef.current) {
                return;
            }
            const currentMetrics = getMinimapMetrics();
            if (!currentMetrics) {
                return;
            }
            const moveX = moveEvent.clientX - rect.left;
            const newViewportStart = moveX - dragOffsetRef.current;
            const beat = newViewportStart / currentMetrics.beatsToPixels;
            scrollToBeat(Math.max(0, beat));
        };

        const handleMouseUp = () => {
            isDraggingRef.current = false;
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
    };

    return (
        <div
            ref={containerRef}
            className="relative w-full shrink-0 cursor-pointer border-b border-border/30 bg-surface-base"
            style={{ height: MINIMAP_HEIGHT }}
            onMouseDown={handleMouseDown}
            aria-label="Timeline minimap — drag the viewport to scroll, click to jump"
            role="slider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((scrollX / Math.max(1, pixelsPerBeat * MIN_PROJECT_BEATS)) * 100)}
        >
            <canvas
                ref={canvasRef}
                className="absolute inset-0"
                style={{ width: "100%", height: MINIMAP_HEIGHT }}
            />
        </div>
    );
};
