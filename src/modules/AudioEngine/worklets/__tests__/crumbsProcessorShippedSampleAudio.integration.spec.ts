import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installWorkletGlobals, makeChannels } from '../../testing/wasmViewGrowthHarness';

type CrumbsProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
};

const SAMPLE_RATE = 48_000;
const FRAMES = 128;
const SAMPLE_FRAMES = 512;
const wasmModule = new WebAssembly.Module(readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm')));
let processor: CrumbsProcessorLike | undefined;

function send(target: CrumbsProcessorLike, data: unknown): void {
    const listener = target.port.onmessage;
    if (!listener) {
        throw new Error('The real Crumbs processor has no message listener');
    }
    listener({ data });
}

function stereoFixture() {
    const left = new Float32Array(SAMPLE_FRAMES);
    const right = new Float32Array(SAMPLE_FRAMES);
    const interleaved = new Float32Array(SAMPLE_FRAMES * 2);
    for (let frame = 0; frame < SAMPLE_FRAMES; frame++) {
        // The left follows the irregular native Rust sample oracle; the right
        // is independently shaped so mono fanout or a channel swap cannot pass.
        const leftValue = 0.6 * Math.sin(frame * 0.11) + 0.3 * Math.cos(frame * 0.037) + 0.1 * Math.sin(frame * 0.29);
        const rightValue = 0.3 * Math.sin(frame * 0.071) - 0.2 * Math.cos(frame * 0.133);
        left[frame] = leftValue;
        right[frame] = rightValue;
        interleaved[frame * 2] = leftValue;
        interleaved[frame * 2 + 1] = rightValue;
    }
    return { left, right, interleaved };
}

function expectSourceFrames(rendered: Float32Array, expected: Float32Array): void {
    expect(rendered.length).toBe(FRAMES);
    expect(rendered.every(Number.isFinite)).toBe(true);
    let strongestFrame = 0;
    for (let frame = 1; frame < expected.length; frame++) {
        if (Math.abs(expected[frame]!) > Math.abs(expected[strongestFrame]!)) {
            strongestFrame = frame;
        }
    }
    // Velocity and centre-pan gain may scale the source; neither may change
    // its frame identity. Silence cannot satisfy this positive scale bound.
    const scale = rendered[strongestFrame]! / expected[strongestFrame]!;
    expect(scale).toBeGreaterThan(0.05);
    expect(scale).toBeLessThan(2);
    for (let frame = 0; frame < FRAMES; frame++) {
        expect(Math.abs(rendered[frame]! - expected[frame]! * scale)).toBeLessThan(1e-4);
    }
}

afterEach(() => {
    try {
        if (processor?.port.onmessage) {
            send(processor, { type: 'dispose' });
        }
    } finally {
        processor = undefined;
        vi.unstubAllGlobals();
        vi.resetModules();
    }
});

describe('shipped Crumbs sample commit and audio', () => {
    it('acknowledges actual stereo sample storage and renders its next source frames through committed WASM', async () => {
        // Only the worklet construction, message-port endpoint and frame clock
        // are hosted here. The processor, generated glue and DSP are real.
        const { registry } = installWorkletGlobals<CrumbsProcessorLike>();
        await import('../crumbsProcessor');
        const Processor = registry.get('crumbs-processor');
        if (!Processor) {
            throw new Error('The production Crumbs processor did not register');
        }
        processor = new Processor({ processorOptions: { wasmModule } });
        send(processor, { type: 'init' });
        expect(processor.port.postMessage).toHaveBeenCalledWith({ type: 'ready' });

        send(processor, { type: 'noteOn', note: 60, velocity: 100 });
        const emptyOutput = makeChannels(2, FRAMES);
        expect(processor.process([], [emptyOutput])).toBe(true);
        expect(emptyOutput).toEqual(makeChannels(2, FRAMES));

        const source = stereoFixture();
        const originalLeft = source.left.slice();
        const originalRight = source.right.slice();
        const originalInterleaved = source.interleaved.slice();
        const upload = source.interleaved.slice();
        send(processor, { type: 'mode', mode: 'quick' });
        send(processor, { type: 'param', name: 'attack', value: 0 });
        send(processor, { type: 'loadSample', loadToken: 7, data: upload, channels: 2, sampleRate: SAMPLE_RATE });
        expect(processor.port.postMessage).toHaveBeenCalledWith({
            type: 'sampleLoaded',
            loadToken: 7,
            droppedWrites: 0,
        });
        send(processor, { type: 'noteOn', note: 60, velocity: 100 });

        for (let block = 0; block < 2; block++) {
            vi.stubGlobal('currentFrame', (block + 1) * FRAMES);
            const output = makeChannels(2, FRAMES);
            expect(processor.process([], [output])).toBe(true);
            const left = output[0];
            const right = output[1];
            if (!left || !right) {
                throw new Error('Expected both processor output channels');
            }
            const start = block * FRAMES;
            expectSourceFrames(left, source.left.slice(start, start + FRAMES));
            expectSourceFrames(right, source.right.slice(start, start + FRAMES));
            expect(right).not.toEqual(left);
        }
        expect(processor.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
        expect(processor.port.postMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'sampleLoadError' })
        );
        expect(upload).toEqual(originalInterleaved);
        expect(source.interleaved).toEqual(originalInterleaved);
        expect(source.left).toEqual(originalLeft);
        expect(source.right).toEqual(originalRight);
    });
});
