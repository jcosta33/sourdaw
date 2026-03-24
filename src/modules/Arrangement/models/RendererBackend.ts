export type RendererBackend = 'webgpu' | 'canvas2d';

export type TimelineRenderer = {
    readonly backend: RendererBackend;
    render(model: import('./TimelineRenderModel').TimelineRenderModel): void;
    resize(width: number, height: number): void;
    dispose(): void;
};

export function getPreferredRendererBackend(): RendererBackend {
    return typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'canvas2d';
}
