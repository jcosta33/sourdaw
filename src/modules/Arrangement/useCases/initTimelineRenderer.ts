import { inject } from '#/infra/di/inject';
import { createCanvasRenderer } from '../presentations/renderers/createCanvasRenderer';
import { createWebGpuRenderer } from '../presentations/renderers/createWebGpuRenderer';
import { getPreferredRendererBackend, type TimelineRenderer } from '../models/RendererBackend';

export const initTimelineRendererDependencies = {
    getPreferredRendererBackend,
    createWebGpuRenderer,
    createCanvasRenderer,
} as const;

/**
 * Initialize the timeline renderer, preferring WebGPU when available
 * and falling back to Canvas 2D.
 */
export const initTimelineRenderer = inject(initTimelineRendererDependencies)(
    ({ getPreferredRendererBackend, createWebGpuRenderer, createCanvasRenderer }) =>
        async function initTimelineRenderer(canvas: HTMLCanvasElement): Promise<TimelineRenderer> {
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
);
