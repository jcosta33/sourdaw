import { type ReactElement, useRef, useEffect } from "react";
import { createCanvasRenderer } from "../../repositories/createCanvasRenderer";
import { createWebGpuRenderer } from "../../repositories/createWebGpuRenderer";
import { getPreferredRendererBackend, type TimelineRenderer } from "../../models/RendererBackend";
import { buildTimelineRenderModel } from "../../useCases/buildTimelineRenderModel";
import { zoomTimeline, scrollTimeline } from "../../stores/timelineViewStore";

export const TimelineSurface = (): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<TimelineRenderer | null>(null);
    const rafRef = useRef<number>(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;

        let disposed = false;

        const initRenderer = async () => {
            const backend = getPreferredRendererBackend();
            let renderer: TimelineRenderer | null = null;

            if (backend === "webgpu") {
                renderer = await createWebGpuRenderer(canvas);
            }

            if (!renderer) {
                renderer = createCanvasRenderer(canvas);
            }

            if (disposed) {
                renderer.dispose();
                return;
            }

            rendererRef.current = renderer;

            const rect = container.getBoundingClientRect();
            renderer.resize(rect.width, rect.height);

            const renderLoop = () => {
                if (disposed) return;
                const model = buildTimelineRenderModel();
                renderer!.render(model);
                rafRef.current = requestAnimationFrame(renderLoop);
            };

            rafRef.current = requestAnimationFrame(renderLoop);
        };

        initRenderer();

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                rendererRef.current?.resize(width, height);
            }
        });
        resizeObserver.observe(container);

        return () => {
            disposed = true;
            cancelAnimationFrame(rafRef.current);
            resizeObserver.disconnect();
            rendererRef.current?.dispose();
            rendererRef.current = null;
        };
    }, []);

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
            zoomTimeline(-e.deltaY * 0.05);
        } else {
            scrollTimeline(e.deltaX || e.deltaY);
        }
    };

    return (
        <div ref={containerRef} className="relative flex-1 overflow-hidden">
            <canvas
                ref={canvasRef}
                className="absolute inset-0"
                aria-label="Timeline editor surface"
                aria-description="Arrangement timeline showing tracks, clips, and playhead position. Scroll to pan, Ctrl+scroll to zoom."
                tabIndex={0}
                onWheel={handleWheel}
            />
        </div>
    );
};
