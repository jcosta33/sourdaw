export type RendererBackend = "webgpu" | "canvas2d";

export type TimelineRenderer = {
    readonly backend: RendererBackend;
    render(model: import("./TimelineRenderModel").TimelineRenderModel): void;
    resize(width: number, height: number): void;
    dispose(): void;
};

export const getPreferredRendererBackend = (): RendererBackend => {
    if (typeof navigator !== "undefined" && "gpu" in navigator) {
        return "webgpu";
    }
    return "canvas2d";
};
