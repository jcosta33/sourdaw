import { type ReactElement, useEffect, useRef, useState } from 'react';

/** String-vibration visualiser (§8). WebGPU compute shader with Canvas2D fallback. */

const NUM_STRINGS = 88;
const PTS = 128;
const DECAY = 0.985;
const SYM_RANGE = 3;
const SYM_GAIN = 0.15;

type StringVibrationViewProps = {
    activeNotes: ReadonlyMap<number, number>;
    className?: string;
};

// ── WGSL shaders ──────────────────────────────────────────────────────

const COMPUTE_WGSL = /* wgsl */ `
struct SP { amplitude: f32, frequency: f32, phase: f32, decay: f32 }
@group(0) @binding(0) var<storage, read> params: array<SP, ${NUM_STRINGS}>;
@group(0) @binding(1) var<storage, read_write> disp: array<f32>;
@group(0) @binding(2) var<uniform> time: f32;
@compute @workgroup_size(${PTS})
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let p = params[gid.y];
    let t = f32(gid.x) / f32(${PTS});
    let env = p.amplitude * exp(-p.decay * time) * (1.0 - t * 0.4);
    disp[gid.y * ${PTS}u + gid.x] = env * sin(p.frequency * t * 6.283185 + p.phase + time * 5.0);
}`;

const RENDER_WGSL = /* wgsl */ `
struct U { width: f32, height: f32 }
@group(0) @binding(0) var<storage, read> disp: array<f32>;
@group(0) @binding(1) var<uniform> u: U;
struct V { @builtin(position) pos: vec4f, @location(0) intensity: f32 }
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) si: u32) -> V {
    let rowH = u.height / f32(${NUM_STRINGS});
    let y0 = rowH * (f32(${NUM_STRINGS}) - f32(si) - 0.5);
    let d = disp[si * ${PTS}u + vi];
    let x = f32(vi) / f32(${PTS} - 1) * u.width;
    let y = y0 + d * rowH * 3.0;
    var o: V;
    o.pos = vec4f((x / u.width) * 2.0 - 1.0, 1.0 - (y / u.height) * 2.0, 0.0, 1.0);
    o.intensity = clamp(abs(d) * 4.0, 0.0, 1.0);
    return o;
}
@fragment fn fs(@location(0) i: f32) -> @location(0) vec4f {
    let c = mix(vec3f(0.78), vec3f(0.984, 0.749, 0.141), i);
    let a = mix(0.15, 1.0, i);
    return vec4f(c * a, a);
}`;

// ── Canvas2D fallback ─────────────────────────────────────────────────

type StringState = { amplitude: number; phase: number; frequency: number };

function runCanvas2DFallback(
    canvas: HTMLCanvasElement,
    activeNotes: ReadonlyMap<number, number>,
    states: StringState[],
    frameRef: { current: number },
): () => void {
    const ctx = canvas.getContext('2d');
    if (ctx === null) return () => {};
    let cancelled = false;

    const render = (): void => {
        if (cancelled) return;
        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);

        for (let i = 0; i < NUM_STRINGS; i += 1) states[i]!.amplitude *= DECAY;
        for (const [midi, velocity] of activeNotes) {
            const key = midi - 21;
            if (key >= 0 && key < NUM_STRINGS) {
                states[key]!.amplitude = Math.max(states[key]!.amplitude, velocity);
                states[key]!.frequency = 4 + key * 0.25;
                for (let d = -SYM_RANGE; d <= SYM_RANGE; d += 1) {
                    const neighbor = key + d;
                    if (d !== 0 && neighbor >= 0 && neighbor < NUM_STRINGS) {
                        const boost = velocity * SYM_GAIN * (1 - Math.abs(d) / (SYM_RANGE + 1));
                        states[neighbor]!.amplitude = Math.max(states[neighbor]!.amplitude, boost);
                        states[neighbor]!.frequency = 4 + neighbor * 0.25;
                    }
                }
            }
        }

        const rowH = height / NUM_STRINGS;
        const phaseAdv = frameRef.current * 0.08;
        ctx.lineWidth = 1;
        for (let i = 0; i < NUM_STRINGS; i += 1) {
            const s = states[i]!;
            const y0 = rowH * (NUM_STRINGS - i - 0.5);
            const amp = s.amplitude * rowH * 3;
            if (amp < 0.5) {
                ctx.strokeStyle = 'rgba(200,200,200,0.15)';
                ctx.beginPath();
                ctx.moveTo(0, y0);
                ctx.lineTo(width, y0);
                ctx.stroke();
                continue;
            }
            const intensity = Math.min(1, s.amplitude);
            ctx.strokeStyle = `rgba(251,191,36,${0.3 + intensity * 0.7})`;
            ctx.beginPath();
            for (let x = 0; x <= width; x += 2) {
                const t = x / width;
                const y = y0 + Math.sin(t * s.frequency * Math.PI * 2 + phaseAdv) * amp * (1 - t * 0.4);
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        frameRef.current += 1;
        requestAnimationFrame(render);
    };
    render();
    return () => { cancelled = true; };
}

// ── WebGPU path ───────────────────────────────────────────────────────

async function initWebGPU(canvas: HTMLCanvasElement) {
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter === null) return null;
    const device = await adapter.requestDevice();
    const gpuCtx = canvas.getContext('webgpu');
    if (gpuCtx === null) return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    gpuCtx.configure({ device, format, alphaMode: 'premultiplied' });

    const SC = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const UC = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    const paramsBuf = device.createBuffer({ size: NUM_STRINGS * 16, usage: SC });
    const dispBuf = device.createBuffer({ size: NUM_STRINGS * PTS * 4, usage: GPUBufferUsage.STORAGE });
    const timeBuf = device.createBuffer({ size: 4, usage: UC });
    const uniformBuf = device.createBuffer({ size: 8, usage: UC });

    const computeModule = device.createShaderModule({ code: COMPUTE_WGSL });
    const renderModule = device.createShaderModule({ code: RENDER_WGSL });

    const blend = { srcFactor: 'src-alpha' as GPUBlendFactor, dstFactor: 'one-minus-src-alpha' as GPUBlendFactor, operation: 'add' as GPUBlendOperation };
    const computePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: computeModule, entryPoint: 'main' } });
    const renderPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: renderModule, entryPoint: 'vs' },
        fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format, blend: {
            color: blend, alpha: { ...blend, srcFactor: 'one' },
        }}] },
        primitive: { topology: 'line-strip', stripIndexFormat: undefined },
    });

    const bg = (p: GPUComputePipeline | GPURenderPipeline, bufs: GPUBuffer[]) =>
        device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: bufs.map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const computeBG = bg(computePipeline, [paramsBuf, dispBuf, timeBuf]);
    const renderBG = bg(renderPipeline, [dispBuf, uniformBuf]);

    device.queue.writeBuffer(uniformBuf, 0, new Float32Array([canvas.width, canvas.height]));

    return { device, gpuCtx, paramsBuf, timeBuf, computePipeline, renderPipeline, computeBG, renderBG };
}

// ── Component ─────────────────────────────────────────────────────────

export const StringVibrationView = ({
    activeNotes,
    className,
}: StringVibrationViewProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [gpuSupported, setGpuSupported] = useState<boolean | null>(null);
    const statesRef = useRef<StringState[]>(
        Array.from({ length: NUM_STRINGS }, () => ({ amplitude: 0, phase: 0, frequency: 0 })),
    );
    const frameRef = useRef(0);

    // WebGPU path
    useEffect(() => {
        if (gpuSupported !== true) return;
        const canvas = canvasRef.current;
        if (canvas === null) return;
        let cancelled = false;
        let device: GPUDevice | undefined;

        const run = async () => {
            const gpu = await initWebGPU(canvas);
            if (gpu === null || cancelled) { setGpuSupported(false); return; }
            device = gpu.device;
            const paramsData = new Float32Array(NUM_STRINGS * 4);
            const timeData = new Float32Array(1);
            let t = 0;

            const frame = (): void => {
                if (cancelled) return;
                t += 0.016;
                for (let i = 0; i < NUM_STRINGS; i += 1) {
                    paramsData[i * 4]! *= DECAY;
                    // keep existing frequency/phase
                }
                for (const [midi, velocity] of activeNotes) {
                    const key = midi - 21;
                    if (key >= 0 && key < NUM_STRINGS) {
                        const off = key * 4;
                        paramsData[off] = Math.max(paramsData[off]!, velocity);
                        paramsData[off + 1] = 4 + key * 0.25;
                        paramsData[off + 3] = 0.3 + key * 0.008;
                        for (let d = -SYM_RANGE; d <= SYM_RANGE; d += 1) {
                            const n = key + d;
                            if (d !== 0 && n >= 0 && n < NUM_STRINGS) {
                                const nOff = n * 4;
                                const boost = velocity * SYM_GAIN * (1 - Math.abs(d) / (SYM_RANGE + 1));
                                paramsData[nOff] = Math.max(paramsData[nOff]!, boost);
                                paramsData[nOff + 1] = 4 + n * 0.25;
                                paramsData[nOff + 3] = 0.3 + n * 0.008;
                            }
                        }
                    }
                }
                timeData[0] = t;
                gpu.device.queue.writeBuffer(gpu.paramsBuf, 0, paramsData);
                gpu.device.queue.writeBuffer(gpu.timeBuf, 0, timeData);

                const encoder = gpu.device.createCommandEncoder();
                const computePass = encoder.beginComputePass();
                computePass.setPipeline(gpu.computePipeline);
                computePass.setBindGroup(0, gpu.computeBG);
                computePass.dispatchWorkgroups(1, NUM_STRINGS);
                computePass.end();

                const textureView = gpu.gpuCtx.getCurrentTexture().createView();
                const renderPass = encoder.beginRenderPass({
                    colorAttachments: [{
                        view: textureView,
                        clearValue: { r: 0, g: 0, b: 0, a: 0 },
                        loadOp: 'clear' as GPULoadOp,
                        storeOp: 'store' as GPUStoreOp,
                    }],
                });
                renderPass.setPipeline(gpu.renderPipeline);
                renderPass.setBindGroup(0, gpu.renderBG);
                renderPass.draw(PTS, NUM_STRINGS, 0, 0);
                renderPass.end();

                gpu.device.queue.submit([encoder.finish()]);
                requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
        };
        run();
        return () => { cancelled = true; device?.destroy(); };
    }, [gpuSupported, activeNotes]);

    // Canvas2D fallback path
    useEffect(() => {
        if (gpuSupported !== false) return;
        const canvas = canvasRef.current;
        if (canvas === null) return;
        return runCanvas2DFallback(canvas, activeNotes, statesRef.current, frameRef);
    }, [gpuSupported, activeNotes]);

    // Feature-detect WebGPU at mount
    useEffect(() => {
        setGpuSupported(typeof navigator !== 'undefined' && navigator.gpu !== undefined);
    }, []);

    return (
        <canvas
            ref={canvasRef}
            width={640}
            height={440}
            className={className}
            aria-label="Grand Boule string vibration visualisation"
        />
    );
};
