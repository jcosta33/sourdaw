import { getPreferredRendererBackend, type TimelineRenderer } from '../models/RendererBackend';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- initTimelineRenderer is a factory that must select between renderers; it is the coordination boundary between domain and presentation
import { createCanvasRenderer } from '../presentations/renderers/createCanvasRenderer';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- same as above
import { createWebGpuRenderer } from '../presentations/renderers/createWebGpuRenderer';

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
