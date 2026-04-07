import { type ReactElement, useEffect, useRef, useState } from 'react';

/**
 * Rolling spectrogram waterfall (§8).
 *
 * When WebGPU is available, a compute shader shifts the history buffer and
 * colour-maps on the GPU; a render shader draws the result as a textured
 * full-screen quad with slight perspective tilt.  Falls back to Canvas2D.
 */

const BIN_COUNT = 256;
const HISTORY_FRAMES = 128;

type SpectralWaterfallProps = {
    /** Latest FFT magnitude frame, normalised to [0, 1]. Length == BIN_COUNT. */
    fftFrame: Float32Array | null;
    className?: string;
};

const COMPUTE_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> history: array<f32>;
@group(0) @binding(1) var<storage, read>       newFrame: array<f32>;
@group(0) @binding(2) var<storage, read_write> pixels: array<u32>;
const BINS: u32 = ${BIN_COUNT}u;
const ROWS: u32 = ${HISTORY_FRAMES}u;

fn colorMap(mag: f32) -> vec4f {
    let lo = vec3f(0.102, 0.039, 0.227);
    let mid = vec3f(0.984, 0.749, 0.141);
    let hi = vec3f(1.0, 0.96, 0.88);
    var c: vec3f;
    if (mag < 0.5) { c = mix(lo, mid, mag * 2.0); }
    else { c = mix(mid, hi, (mag - 0.5) * 2.0); }
    let r = u32(clamp(c.x, 0.0, 1.0) * 255.0);
    let g = u32(clamp(c.y, 0.0, 1.0) * 255.0);
    let b = u32(clamp(c.z, 0.0, 1.0) * 255.0);
    let a = u32(clamp(mag * 2.0, 0.0, 1.0) * 255.0);
    return vec4f(f32(r), f32(g), f32(b), f32(a));
}

@compute @workgroup_size(${BIN_COUNT})
fn updateHistory(@builtin(global_invocation_id) gid: vec3u) {
    let bin = gid.x;
    if (bin >= BINS) { return; }
    for (var row = ROWS - 1u; row >= 1u; row = row - 1u) {
        history[row * BINS + bin] = history[(row - 1u) * BINS + bin];
    }
    let mag = clamp(newFrame[bin], 0.0, 1.0);
    history[bin] = mag;
    for (var row = 0u; row < ROWS; row = row + 1u) {
        let m = history[row * BINS + bin];
        let col = colorMap(m);
        let idx = row * BINS + bin;
        pixels[idx] = u32(col.x) | (u32(col.y) << 8u) | (u32(col.z) << 16u) | (u32(col.w) << 24u);
    }
}
`;

const RENDER_WGSL = /* wgsl */ `
struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
    var positions = array<vec2f, 6>(
        vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
        vec2f(-1, 1),  vec2f(1, -1), vec2f(1, 1),
    );
    let p = positions[vi];
    let tilt = 0.06;
    let y01 = (p.y + 1.0) * 0.5;
    let scale = 1.0 - tilt * (1.0 - y01);
    var out: VSOut;
    out.pos = vec4f(p.x * scale, p.y, 0.0, 1.0);
    out.uv = vec2f((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5);
    return out;
}

@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@fragment fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
    return textureSample(tex, samp, uv);
}
`;

type GpuState = {
    device: GPUDevice;
    context: GPUCanvasContext;
    computePipeline: GPUComputePipeline;
    renderPipeline: GPURenderPipeline;
    historyBuf: GPUBuffer;
    frameBuf: GPUBuffer;
    pixelBuf: GPUBuffer;
    texture: GPUTexture;
    computeBG: GPUBindGroup;
    renderBG: GPUBindGroup;
};

async function initWebGPU(canvas: HTMLCanvasElement): Promise<GpuState | null> {
    if (navigator.gpu === undefined) return null;
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter === null) return null;
    const device = await adapter.requestDevice();
    const ctx = canvas.getContext('webgpu');
    if (ctx === null) return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'premultiplied' });

    const totalFloats = BIN_COUNT * HISTORY_FRAMES;
    const historyBuf = device.createBuffer({ size: totalFloats * 4, usage: GPUBufferUsage.STORAGE });
    const frameBuf = device.createBuffer({ size: BIN_COUNT * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const pixelBuf = device.createBuffer({ size: totalFloats * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const texture = device.createTexture({
        size: [BIN_COUNT, HISTORY_FRAMES],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const computeModule = device.createShaderModule({ code: COMPUTE_WGSL });
    const computePipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: computeModule, entryPoint: 'updateHistory' },
    });
    const renderModule = device.createShaderModule({ code: RENDER_WGSL });
    const renderPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: renderModule, entryPoint: 'vs' },
        fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
    });
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    const computeBG = device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: historyBuf } },
            { binding: 1, resource: { buffer: frameBuf } },
            { binding: 2, resource: { buffer: pixelBuf } },
        ],
    });
    const renderBG = device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: texture.createView() },
            { binding: 1, resource: sampler },
        ],
    });

    return { device, context: ctx, computePipeline, renderPipeline, historyBuf, frameBuf, pixelBuf, texture, computeBG, renderBG };
}

export const SpectralWaterfall = ({ fftFrame, className }: SpectralWaterfallProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const gpuRef = useRef<GpuState | null>(null);
    const [useGpu, setUseGpu] = useState<boolean | null>(null);

    // Keep fftFrame in a ref so the render loops read fresh data without
    // tearing down the GPU pipeline on every new frame.
    const frameRef = useRef(fftFrame);
    frameRef.current = fftFrame;

    // Canvas2D fallback refs
    const historyRef = useRef<Float32Array[]>(
        Array.from({ length: HISTORY_FRAMES }, () => new Float32Array(BIN_COUNT)),
    );
    const headRef = useRef<number>(0);

    // Feature-detect + init WebGPU once
    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas === null) return;
        let cancelled = false;
        if (navigator.gpu === undefined) { setUseGpu(false); return; }
        void initWebGPU(canvas).then((state) => {
            if (cancelled) { state?.device.destroy(); return; }
            if (state === null) { setUseGpu(false); }
            else { gpuRef.current = state; setUseGpu(true); }
        });
        return () => { cancelled = true; };
    }, []);

    // WebGPU render loop
    useEffect(() => {
        if (useGpu !== true) return;
        const gpu = gpuRef.current;
        if (gpu === null) return;
        let raf = 0;
        const render = (): void => {
            const frame = frameRef.current;
            if (frame !== null) {
                const staging = new Float32Array(BIN_COUNT);
                const n = Math.min(BIN_COUNT, frame.length);
                for (let i = 0; i < n; i += 1) staging[i] = frame[i] ?? 0;
                gpu.device.queue.writeBuffer(gpu.frameBuf, 0, staging);
            }
            const encoder = gpu.device.createCommandEncoder();
            const computePass = encoder.beginComputePass();
            computePass.setPipeline(gpu.computePipeline);
            computePass.setBindGroup(0, gpu.computeBG);
            computePass.dispatchWorkgroups(1);
            computePass.end();
            encoder.copyBufferToTexture(
                { buffer: gpu.pixelBuf, bytesPerRow: BIN_COUNT * 4 },
                { texture: gpu.texture },
                [BIN_COUNT, HISTORY_FRAMES],
            );
            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: gpu.context.getCurrentTexture().createView(),
                    loadOp: 'clear' as GPULoadOp,
                    storeOp: 'store' as GPUStoreOp,
                    clearValue: { r: 0.102, g: 0.039, b: 0.227, a: 1 },
                }],
            });
            pass.setPipeline(gpu.renderPipeline);
            pass.setBindGroup(0, gpu.renderBG);
            pass.draw(6);
            pass.end();
            gpu.device.queue.submit([encoder.finish()]);
            raf = requestAnimationFrame(render);
        };
        render();
        return () => cancelAnimationFrame(raf);
    }, [useGpu]);

    // Canvas2D fallback render loop
    useEffect(() => {
        if (useGpu !== false) return;
        const canvas = canvasRef.current;
        if (canvas === null) return;
        const ctx = canvas.getContext('2d');
        if (ctx === null) return;
        const width = canvas.width;
        const height = canvas.height;
        const rowHeight = height / HISTORY_FRAMES;
        const binWidth = width / BIN_COUNT;
        let raf = 0;
        const render = (): void => {
            // Ingest new frame into history ring
            const frame = frameRef.current;
            if (frame !== null) {
                const head = headRef.current;
                const slot = historyRef.current[head]!;
                const n = Math.min(BIN_COUNT, frame.length);
                for (let i = 0; i < n; i += 1) slot[i] = frame[i] ?? 0;
                headRef.current = (head + 1) % HISTORY_FRAMES;
            }

            ctx.clearRect(0, 0, width, height);
            const history = historyRef.current;
            const head = headRef.current;
            for (let row = 0; row < HISTORY_FRAMES; row += 1) {
                const frameIdx = (head - row - 1 + HISTORY_FRAMES) % HISTORY_FRAMES;
                const rowData = history[frameIdx]!;
                const y = row * rowHeight;
                for (let bin = 0; bin < BIN_COUNT; bin += 1) {
                    const mag = Math.min(1, Math.max(0, rowData[bin] ?? 0));
                    if (mag <= 0.01) continue;
                    const hue = 260 - mag * 200;
                    ctx.fillStyle = `hsl(${hue}, 85%, ${20 + mag * 55}%)`;
                    ctx.fillRect(bin * binWidth, y, binWidth, rowHeight);
                }
            }
            raf = requestAnimationFrame(render);
        };
        render();
        return () => cancelAnimationFrame(raf);
    }, [useGpu]);

    return (
        <canvas
            ref={canvasRef}
            width={640}
            height={256}
            className={className}
            aria-label="Grand Boule spectral waterfall"
        />
    );
};
