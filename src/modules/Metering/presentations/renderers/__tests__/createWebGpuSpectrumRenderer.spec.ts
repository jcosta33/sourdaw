import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebGpuSpectrumRenderer } from '../createWebGpuSpectrumRenderer';

/**
 * `createWebGpuSpectrumRenderer` owns exactly one piece of non-trivial logic:
 * the heatmap history ring buffer. Each render with `showHeatmap=true` copies
 * `freqData` into `heatmapHistory` at `currentHistoryHead * numBins`, then
 * advances the head modulo `HISTORY_COUNT` (120). The spec stubs the WebGPU
 * device so it can capture each `writeBuffer` call's payload and assert exactly
 * which slice of the ring received the new frame.
 */

const NUM_BINS = 8;
const HISTORY_COUNT = 120;

type RenderHandles = {
    writeBuffer: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    submit: ReturnType<typeof vi.fn>;
    draw: ReturnType<typeof vi.fn>;
};

function install_webgpu(canvas: HTMLCanvasElement): {
    handles: RenderHandles;
    deviceRef: { current: { destroy: ReturnType<typeof vi.fn> } | null };
} {
    const writeBuffer = vi.fn();
    const destroy = vi.fn();
    const draw = vi.fn();
    const submit = vi.fn();

    const device = {
        createShaderModule: vi.fn(() => ({})),
        createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
        createBuffer: vi.fn(({ size }: { size: number }) => ({ id: `buf-${size}`, size })),
        createBindGroup: vi.fn(() => ({ id: 'bindgroup' })),
        queue: {
            writeBuffer,
            submit,
        },
        createCommandEncoder: vi.fn(() => ({
            beginRenderPass: vi.fn(() => ({
                setPipeline: vi.fn(),
                setBindGroup: vi.fn(),
                draw,
                end: vi.fn(),
            })),
            finish: vi.fn(() => ({})),
        })),
        destroy,
    };

    const adapter = {
        requestDevice: vi.fn().mockResolvedValue(device),
    };

    const gpu = {
        requestAdapter: vi.fn().mockResolvedValue(adapter),
        getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm'),
    };

    const context = {
        configure: vi.fn(),
        getCurrentTexture: vi.fn(() => ({
            createView: vi.fn(() => ({ id: 'view' })),
        })),
    };

    Object.defineProperty(canvas, 'getContext', {
        configurable: true,
        value: vi.fn((contextId: string) => (contextId === 'webgpu' ? context : null)),
    });
    Object.defineProperty(navigator, 'gpu', {
        configurable: true,
        value: gpu,
    });
    vi.stubGlobal('GPUBufferUsage', {
        STORAGE: 4,
        COPY_DST: 2,
        UNIFORM: 16,
    });

    return {
        handles: { writeBuffer, destroy, submit, draw },
        deviceRef: { current: device },
    };
}

describe('createWebGpuSpectrumRenderer', () => {
    let canvas: HTMLCanvasElement;
    const originalDevicePixelRatio = window.devicePixelRatio;

    beforeEach(() => {
        canvas = document.createElement('canvas');
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    });

    afterEach(() => {
        Reflect.deleteProperty(navigator, 'gpu');
        vi.unstubAllGlobals();
        Object.defineProperty(window, 'devicePixelRatio', {
            configurable: true,
            value: originalDevicePixelRatio,
        });
    });

    it('returns null when navigator.gpu is unavailable', async () => {
        // No gpu property set on navigator.
        const renderer = await createWebGpuSpectrumRenderer(canvas, NUM_BINS, 48000);

        expect(renderer).toBeNull();
    });

    it('returns null when requestAdapter resolves to null', async () => {
        Object.defineProperty(navigator, 'gpu', {
            configurable: true,
            value: {
                requestAdapter: vi.fn().mockResolvedValue(null),
                getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm'),
            },
        });

        const renderer = await createWebGpuSpectrumRenderer(canvas, NUM_BINS, 48000);

        expect(renderer).toBeNull();
    });

    it('returns null when requestDevice rejects (try/catch)', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const adapter = {
            requestDevice: vi.fn().mockRejectedValue(new Error('device lost')),
        };
        Object.defineProperty(navigator, 'gpu', {
            configurable: true,
            value: {
                requestAdapter: vi.fn().mockResolvedValue(adapter),
                getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm'),
            },
        });

        const renderer = await createWebGpuSpectrumRenderer(canvas, NUM_BINS, 48000);

        expect(renderer).toBeNull();
        consoleError.mockRestore();
    });

    it('returns a renderer with render/resize/dispose when the device is available', async () => {
        install_webgpu(canvas);

        const renderer = await createWebGpuSpectrumRenderer(canvas, NUM_BINS, 48000);

        expect(renderer).not.toBeNull();
        expect(typeof renderer?.render).toBe('function');
        expect(typeof renderer?.resize).toBe('function');
        expect(typeof renderer?.dispose).toBe('function');
    });

    it('writes freq data and params on a non-heatmap render, but skips the heatmap buffer', async () => {
        const { handles } = install_webgpu(canvas);
        const renderer = await createWebGpuSpectrumRenderer(canvas, NUM_BINS, 48000);
        if (!renderer) {
            throw new Error('renderer was null');
        }

        const freq = new Float32Array(NUM_BINS);
        renderer.render(freq, false);

        // Two writeBuffer calls: freqBuf and paramBuf. Heatmap buffer is skipped.
        expect(handles.writeBuffer).toHaveBeenCalledTimes(2);
        // First write is the freq data into buf of size NUM_BINS * 4.
        expect(handles.writeBuffer.mock.calls[0]?.[1]).toBe(0);
        expect(handles.writeBuffer.mock.calls[0]?.[2]).toBe(freq);
    });

    it('writes the heatmap buffer and rotates the history head on each heatmap render', async () => {
        const { handles } = install_webgpu(canvas);
        const renderer = await createWebGpuSpectrumRenderer(canvas, NUM_BINS, 48000);
        if (!renderer) {
            throw new Error('renderer was null');
        }

        // Frame A: freqData all 0.1.
        const frameA = new Float32Array(NUM_BINS).fill(0.1);
        renderer.render(frameA, true);

        // On a heatmap render: 3 writeBuffer calls (heatmap, freq, params).
        const heatmapCallsA = handles.writeBuffer.mock.calls.filter((call: unknown[]) => {
            const data = call[2] as Float32Array;
            // The heatmap buffer is the largest: NUM_BINS * HISTORY_COUNT.
            return data.length === NUM_BINS * HISTORY_COUNT;
        });
        expect(heatmapCallsA).toHaveLength(1);
        const heatmapPayloadA = heatmapCallsA[0]?.[2] as Float32Array;

        // History head was 0 → frame A occupies indices [0..NUM_BINS-1].
        for (let i = 0; i < NUM_BINS; i += 1) {
            expect(heatmapPayloadA[i]).toBeCloseTo(0.1, 5);
        }
        // The next slot (head 1) should still be 0 (not yet written).
        expect(heatmapPayloadA[NUM_BINS]).toBe(0);

        // Frame B: freqData all 0.9 — head should have advanced to slot 1.
        const frameB = new Float32Array(NUM_BINS).fill(0.9);
        renderer.render(frameB, true);

        const heatmapCallsB = handles.writeBuffer.mock.calls.filter((call: unknown[]) => {
            const data = call[2] as Float32Array;
            return data.length === NUM_BINS * HISTORY_COUNT;
        });
        // Two heatmap writes now (one from frameA, one from frameB).
        expect(heatmapCallsB).toHaveLength(2);
        const heatmapPayloadB = heatmapCallsB[1]?.[2] as Float32Array;

        // Slot 1 (indices NUM_BINS..2*NUM_BINS-1) now holds frameB.
        for (let i = 0; i < NUM_BINS; i += 1) {
            expect(heatmapPayloadB[NUM_BINS + i]).toBeCloseTo(0.9, 5);
        }
        // Slot 0 still holds frameA.
        for (let i = 0; i < NUM_BINS; i += 1) {
            expect(heatmapPayloadB[i]).toBeCloseTo(0.1, 5);
        }
    });

    it('wraps the history head back to 0 after HISTORY_COUNT frames', async () => {
        const { handles } = install_webgpu(canvas);
        const renderer = await createWebGpuSpectrumRenderer(canvas, NUM_BINS, 48000);
        if (!renderer) {
            throw new Error('renderer was null');
        }

        // Fill HISTORY_COUNT frames so the head wraps from 119 → 0.
        for (let f = 0; f < HISTORY_COUNT; f += 1) {
            renderer.render(new Float32Array(NUM_BINS).fill(f / HISTORY_COUNT), true);
        }

        // The HISTORY_COUNT-th write put frame index 119 at slot 119, advancing
        // head to 0. The next render must land at slot 0, overwriting frame 0.
        const wrapFrame = new Float32Array(NUM_BINS).fill(0.777);
        renderer.render(wrapFrame, true);

        const heatmapWrites = handles.writeBuffer.mock.calls.filter((call: unknown[]) => {
            const data = call[2] as Float32Array;
            return data.length === NUM_BINS * HISTORY_COUNT;
        });
        const lastPayload = heatmapWrites[heatmapWrites.length - 1]?.[2] as Float32Array;

        // Slot 0 (the wrap target) must now hold 0.777, not frame-0's value (~0).
        for (let i = 0; i < NUM_BINS; i += 1) {
            expect(lastPayload[i]).toBeCloseTo(0.777, 5);
        }
    });

    it('resize sets canvas backing-store and CSS dimensions using devicePixelRatio', async () => {
        install_webgpu(canvas);
        const renderer = await createWebGpuSpectrumRenderer(canvas, NUM_BINS, 48000);
        if (!renderer) {
            throw new Error('renderer was null');
        }

        renderer.resize(400, 200);

        // dpr is 2 in this spec → backing store is 800x400, CSS is 400x200px.
        expect(canvas.width).toBe(800);
        expect(canvas.height).toBe(400);
        expect(canvas.style.width).toBe('400px');
        expect(canvas.style.height).toBe('200px');
    });

    it('dispose destroys the device', async () => {
        const { handles } = install_webgpu(canvas);
        const renderer = await createWebGpuSpectrumRenderer(canvas, NUM_BINS, 48000);
        if (!renderer) {
            throw new Error('renderer was null');
        }

        renderer.dispose();

        expect(handles.destroy).toHaveBeenCalledTimes(1);
    });
});
