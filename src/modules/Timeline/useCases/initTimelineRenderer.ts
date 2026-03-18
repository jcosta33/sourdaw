import { createCanvasRenderer } from '../repositories/createCanvasRenderer';
import { createWebGpuRenderer } from '../repositories/createWebGpuRenderer';
import { getPreferredRendererBackend, type TimelineRenderer } from '../models/RendererBackend';

/**
 * Initialize the timeline renderer, preferring WebGPU when available
 * and falling back to Canvas 2D.
 */
export async function initTimelineRenderer(canvas: HTMLCanvasElement): Promise<TimelineRenderer> {
    const backend = getPreferredRendererBackend();
    let renderer: TimelineRenderer | null = null;

    if (backend === 'webgpu') {
        renderer = await createWebGpuRenderer(canvas);
    }

    if (!renderer) {
        renderer = createCanvasRenderer(canvas);
    }

    return renderer;
}
