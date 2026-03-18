export type RendererBackend = 'webgpu' | 'canvas2d';

export type TimelineRenderer = {
    readonly backend: RendererBackend;
    render(model: import('./TimelineRenderModel').TimelineRenderModel): void;
    resize(width: number, height: number): void;
    dispose(): void;
};

export function getPreferredRendererBackend(): RendererBackend {
    // TODO: re-enable once the WebGPU renderer draws more than a clear screen
    return 'canvas2d';
}
