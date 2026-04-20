/**
 * WebGPU Automation Renderer.
 * Renders all visible automation lanes in a single unified pipeline.
 * R-F1: Single unified draw call for all automation curves.
 */

const WGSL_SHADER = /* wgsl */ `
struct VertexOut {
    @builtin(position) pos : vec4f,
    @location(0)       col : vec4f,
}

@vertex
fn vs_main(
    @location(0) xy : vec2f,
    @location(1) col: vec4f,
) -> VertexOut {
    var out : VertexOut;
    out.pos = vec4f(xy, 0.0, 1.0);
    out.col = col;
    return out;
}

@fragment
fn fs_main(@location(0) col: vec4f) -> @location(0) vec4f {
    return col;
}
`;

export type AutomationRenderModel = {
    lanes: {
        points: { beat: number; value: number }[];
        ghostPoints?: { beat: number; value: number }[];
        y: number;
        height: number;
        color: string;
        minValue: number;
        maxValue: number;
    }[];
    viewportStartBeat: number;
    pixelsPerBeat: number;
    width: number;
    height: number;
};

export type AutomationRenderer = {
    render(model: AutomationRenderModel): void;
    dispose(): void;
};

function hexToRgb(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return isNaN(r) || isNaN(g) || isNaN(b) ? [0.6, 0.5, 1.0] : [r, g, b];
}

export async function createWebGpuAutomationRenderer(canvas: HTMLCanvasElement): Promise<AutomationRenderer | null> {
    if (!navigator.gpu) {
        return null;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        return null;
    }
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu')!;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'premultiplied' });

    const shader = device.createShaderModule({ code: WGSL_SHADER });
    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: shader,
            entryPoint: 'vs_main',
            buffers: [
                {
                    arrayStride: 6 * 4,
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x2' }, // xy
                        { shaderLocation: 1, offset: 2 * 4, format: 'float32x4' }, // rgba
                    ],
                },
            ],
        },
        fragment: {
            module: shader,
            entryPoint: 'fs_main',
            targets: [
                {
                    format,
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                    },
                },
            ],
        },
        primitive: { topology: 'triangle-list' },
    });

    const MAX_VERTICES = 100000;
    const vertexBuffer = device.createBuffer({
        size: MAX_VERTICES * 6 * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    const cpuBuf = new Float32Array(MAX_VERTICES * 6);

    function render(model: AutomationRenderModel) {
        let vIdx = 0;
        const { viewportStartBeat, pixelsPerBeat, width, height } = model;

        function addRect(x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number, a: number) {
            if (vIdx + 36 >= MAX_VERTICES * 6) {
                return;
            }
            const nx1 = (x1 / width) * 2 - 1;
            const nx2 = (x2 / width) * 2 - 1;
            const ny1 = 1 - (y1 / height) * 2;
            const ny2 = 1 - (y2 / height) * 2;

            const verts = [
                nx1,
                ny1,
                r,
                g,
                b,
                a,
                nx2,
                ny1,
                r,
                g,
                b,
                a,
                nx1,
                ny2,
                r,
                g,
                b,
                a,
                nx2,
                ny1,
                r,
                g,
                b,
                a,
                nx2,
                ny2,
                r,
                g,
                b,
                a,
                nx1,
                ny2,
                r,
                g,
                b,
                a,
            ];
            cpuBuf.set(verts, vIdx);
            vIdx += 36;
        }

        for (const lane of model.lanes) {
            const [r, g, b] = hexToRgb(lane.color.startsWith('#') ? lane.color : '#a78bfa');

            // Draw ghost points (faded)
            if (lane.ghostPoints && lane.ghostPoints.length >= 2) {
                for (let i = 0; i < lane.ghostPoints.length - 1; i++) {
                    const p1 = lane.ghostPoints[i]!;
                    const p2 = lane.ghostPoints[i + 1]!;
                    const x1 = (p1.beat - viewportStartBeat) * pixelsPerBeat;
                    const x2 = (p2.beat - viewportStartBeat) * pixelsPerBeat;
                    if (x2 < 0 || x1 > width) {
                        continue;
                    }
                    const v1 = (p1.value - lane.minValue) / (lane.maxValue - lane.minValue);
                    const v2 = (p2.value - lane.minValue) / (lane.maxValue - lane.minValue);
                    const y1 = lane.y + lane.height * (1 - v1);
                    const y2 = lane.y + lane.height * (1 - v2);
                    addRect(x1, y1 - 0.5, x2, y2 + 0.5, r, g, b, 0.25);
                }
            }

            if (lane.points.length < 2) {
                continue;
            }

            for (let i = 0; i < lane.points.length - 1; i++) {
                const p1 = lane.points[i]!;
                const p2 = lane.points[i + 1]!;

                const x1 = (p1.beat - viewportStartBeat) * pixelsPerBeat;
                const x2 = (p2.beat - viewportStartBeat) * pixelsPerBeat;

                if (x2 < 0 || x1 > width) {
                    continue;
                }

                const v1 = (p1.value - lane.minValue) / (lane.maxValue - lane.minValue);
                const v2 = (p2.value - lane.minValue) / (lane.maxValue - lane.minValue);

                const y1 = lane.y + lane.height * (1 - v1);
                const y2 = lane.y + lane.height * (1 - v2);

                // Simple version: draw 2px thick line
                addRect(x1, y1 - 1, x2, y2 + 1, r, g, b, 0.8);
            }
        }

        if (vIdx === 0) {
            return;
        }

        device.queue.writeBuffer(vertexBuffer, 0, cpuBuf, 0, vIdx);
        const encoder = device.createCommandEncoder();
        const view = context.getCurrentTexture().createView();
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view,
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        });
        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.draw(vIdx / 6);
        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    return { render, dispose: () => device.destroy() };
}
