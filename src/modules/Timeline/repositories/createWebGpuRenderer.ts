import { type TimelineRenderer } from '../models/RendererBackend';
import { type TimelineRenderModel } from '../models/TimelineRenderModel';

export async function createWebGpuRenderer(canvas: HTMLCanvasElement): Promise<TimelineRenderer | null> {
    if (!navigator.gpu) {
        return null;
    }

    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            return null;
        }

        const device = await adapter.requestDevice();
        const gpuContext = canvas.getContext('webgpu');
        if (!gpuContext) {
            return null;
        }

        const format = navigator.gpu.getPreferredCanvasFormat();
        gpuContext.configure({ device, format, alphaMode: 'premultiplied' });

        let width = canvas.width;
        let height = canvas.height;

        function render(_model: TimelineRenderModel): void {
            const encoder = device.createCommandEncoder();
            const textureView = gpuContext!.getCurrentTexture().createView();

            const renderPass = encoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: textureView,
                        clearValue: { r: 0.07, g: 0.07, b: 0.07, a: 1.0 },
                        loadOp: 'clear' as GPULoadOp,
                        storeOp: 'store' as GPUStoreOp,
                    },
                ],
            });

            renderPass.end();
            device.queue.submit([encoder.finish()]);
        }

        function resize(w: number, h: number): void {
            const dpr = window.devicePixelRatio || 1;
            width = w;
            height = h;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
            gpuContext!.configure({ device, format, alphaMode: 'premultiplied' });
        }

        function dispose(): void {
            device.destroy();
        }

        void width;
        void height;

        return { backend: 'webgpu', render, resize, dispose };
    } catch {
        return null;
    }
}
