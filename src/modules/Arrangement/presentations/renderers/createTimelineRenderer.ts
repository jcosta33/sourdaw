import { getPreferredRendererBackend, type TimelineRenderer } from '../../models/RendererBackend';

import { createCanvasRenderer } from './createCanvasRenderer';
import { createWebGpuRenderer } from './createWebGpuRenderer';

export async function createTimelineRenderer(canvas: HTMLCanvasElement): Promise<TimelineRenderer> {
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
