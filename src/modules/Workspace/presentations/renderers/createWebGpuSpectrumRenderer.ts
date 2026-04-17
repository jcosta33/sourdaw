/**
 * WebGPU Spectrum Analyzer and Spectrogram Renderer.
 * Consolidates multiple implementations into a unified high-performance pipeline.
 * R-C2: Unified WebGPU pipeline for 2048-bin FFT data.
 * R-C3: Heatmap view using frequency history.
 */

const SHADER = /* wgsl */ `
struct VertexOut {
    @builtin(position) pos : vec4f,
    @location(0)       uv  : vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOut {
    var pos = array<vec2f, 4>(
        vec2f(-1.0, -1.0),
        vec2f( 1.0, -1.0),
        vec2f(-1.0,  1.0),
        vec2f( 1.0,  1.0)
    );
    var uv = array<vec2f, 4>(
        vec2f(0.0, 1.0),
        vec2f(1.0, 1.0),
        vec2f(0.0, 0.0),
        vec2f(1.0, 0.0)
    );
    var out: VertexOut;
    out.pos = vec4f(pos[idx], 0.0, 1.0);
    out.uv = uv[idx];
    return out;
}

@group(0) @binding(0) var<storage, read> freqData: array<f32>;
@group(0) @binding(1) var<storage, read> heatmapData: array<f32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    width: f32,
    height: f32,
    numBins: f32,
    sampleRate: f32,
    showHeatmap: f32, // 1.0 = heatmap, 0.0 = spectrum
    historyCount: f32,
}

fn freqToLogX(freq: f32, width: f32, maxFreq: f32) -> f32 {
    let minFreq = 20.0;
    if (freq <= minFreq) { return 0.0; }
    return (log2(freq / minFreq) / log2(maxFreq / minFreq)) * width;
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    let maxFreq = min(22000.0, params.sampleRate / 2.0);
    
    if (params.showHeatmap > 0.5) {
        // Heatmap rendering
        // uv.x = frequency (log), uv.y = time history
        let logFreq = pow(2.0, uv.x * log2(maxFreq / 20.0)) * 20.0;
        let binIdx = (logFreq / (params.sampleRate / 2.0)) * params.numBins;
        let historyIdx = floor(uv.y * params.historyCount);
        
        let val = heatmapData[u32(historyIdx * params.numBins + binIdx)];
        // Color mapping: black -> blue -> cyan -> yellow -> red
        return vec4f(
            smoothstep(0.5, 0.9, val) + smoothstep(0.8, 1.0, val),
            smoothstep(0.3, 0.7, val),
            smoothstep(0.0, 0.4, val) - smoothstep(0.6, 1.0, val),
            1.0
        );
    } else {
        // Spectrum rendering (line/area)
        let logFreq = pow(2.0, uv.x * log2(maxFreq / 20.0)) * 20.0;
        let binIdx = (logFreq / (params.sampleRate / 2.0)) * params.numBins;
        
        let db = freqData[u32(binIdx)];
        let tiltedDb = db + 3.0 * log2(max(1.0, logFreq / 1000.0));
        let normalizedY = (tiltedDb + 80.0) / 80.0;
        
        if (1.0 - uv.y < normalizedY) {
            return vec4f(uv.x, 0.5, 1.0 - uv.x, 0.3 * (normalizedY - (1.0 - uv.y)));
        }
        return vec4f(0.0, 0.0, 0.0, 0.0);
    }
}
`;

export type SpectrumRenderer = {
    render(freqData: Float32Array, showHeatmap: boolean): void;
    resize(width: number, height: number): void;
    dispose(): void;
};

export async function createWebGpuSpectrumRenderer(
    canvas: HTMLCanvasElement,
    numBins: number,
    sampleRate: number
): Promise<SpectrumRenderer | null> {
    if (!navigator.gpu) return null;

    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return null;
        const device = await adapter.requestDevice();
        const context = canvas.getContext('webgpu')!;
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format });

        const shader = device.createShaderModule({ code: SHADER });
        const pipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: { module: shader, entryPoint: 'vs_main' },
            fragment: {
                module: shader,
                entryPoint: 'fs_main',
                targets: [{
                    format,
                    blend: {
                        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
                    }
                }]
            },
            primitive: { topology: 'triangle-strip' }
        });

        const HISTORY_COUNT = 120;
        const freqBuf = device.createBuffer({
            size: numBins * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        const heatmapBuf = device.createBuffer({
            size: numBins * HISTORY_COUNT * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        const paramBuf = device.createBuffer({
            size: 32, // 6 floats
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: freqBuf } },
                { binding: 1, resource: { buffer: heatmapBuf } },
                { binding: 2, resource: { buffer: paramBuf } }
            ]
        });

        let currentHistoryHead = 0;
        const heatmapHistory = new Float32Array(numBins * HISTORY_COUNT);

        function render(freqData: Float32Array, showHeatmap: boolean): void {
            // Update heatmap history
            if (showHeatmap) {
                heatmapHistory.set(freqData, currentHistoryHead * numBins);
                currentHistoryHead = (currentHistoryHead + 1) % HISTORY_COUNT;
                device.queue.writeBuffer(heatmapBuf, 0, heatmapHistory);
            }
            
            device.queue.writeBuffer(freqBuf, 0, freqData);
            device.queue.writeBuffer(paramBuf, 0, new Float32Array([
                canvas.width, canvas.height, numBins, sampleRate, showHeatmap ? 1 : 0, HISTORY_COUNT
            ]));

            const encoder = device.createCommandEncoder();
            const view = context.getCurrentTexture().createView();
            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view,
                    clearValue: { r: 0.02, g: 0.02, b: 0.03, a: 1.0 },
                    loadOp: 'clear',
                    storeOp: 'store'
                }]
            });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.draw(4);
            pass.end();
            device.queue.submit([encoder.finish()]);
        }

        function resize(w: number, h: number): void {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
        }

        function dispose(): void {
            device.destroy();
        }

        return { render, resize, dispose };
    } catch (e) {
        console.error('Failed to create WebGPU Spectrum Renderer:', e);
        return null;
    }
}
