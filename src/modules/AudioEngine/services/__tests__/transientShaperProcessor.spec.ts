import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { getPluginById } from '#/modules/Arrangement/useCases';

import { TransientShaperInstance } from '../../wasm/daw_dsp.js';

import { installWorkletGlobals } from './wasmViewGrowthHarness';

type Processor = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process: (input: Float32Array[][], output: Float32Array[][], params: Record<string, Float32Array>) => boolean;
};
const { registry } = installWorkletGlobals<Processor>();
const module = new WebAssembly.Module(readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm')));
afterAll(() => vi.unstubAllGlobals());
async function processor(initialize = true) {
    await import('../transientShaperProcessor');
    const Constructor = registry.get('transient-shaper-processor');
    if (!Constructor) throw new Error('Shipping processor was not registered');
    const instance = new Constructor({ processorOptions: { wasmModule: module } });
    if (initialize) instance.port.onmessage?.({ data: { type: 'init' } });
    return { instance, Constructor };
}
function render(
    instance: Processor,
    frames: number,
    input = [new Float32Array(frames).fill(0.5)],
    attack = new Float32Array([1]),
    sustain = new Float32Array([1]),
    epoch = 0
) {
    const output = [new Float32Array(frames).fill(9), new Float32Array(frames).fill(9)];
    const running = instance.process([input], [output], {
        attackGain: attack,
        sustainGain: sustain,
        _resetEpoch: new Float32Array([epoch]),
    });
    return { output, running };
}

describe('shipping Transient Shaper processor with the actual compiled WASM', () => {
    it('stays pending until initialization and pins catalog, AudioParam and actual unity defaults', async () => {
        const { instance, Constructor } = await processor(false);
        expect(instance.port.postMessage).not.toHaveBeenCalled();
        expect(render(instance, 17).output.map((channel) => Array.from(channel))).toEqual([
            Array(17).fill(0),
            Array(17).fill(0),
        ]);
        expect(Constructor).toHaveProperty('parameterDescriptors', [
            { name: 'attackGain', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'a-rate' },
            { name: 'sustainGain', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'a-rate' },
            { name: '_resetEpoch', defaultValue: 0, minValue: 0, maxValue: 16777215, automationRate: 'k-rate' },
        ]);
        expect(getPluginById('transient-shaper')?.parameters.map((p) => p.defaultValue)).toEqual([1, 1]);
        instance.port.onmessage?.({ data: { type: 'init' } });
        expect(instance.port.postMessage).toHaveBeenCalledWith({ type: 'ready', latency: 0 });
        for (const frames of [1, 17, 128, 257, 4103]) {
            expect(render(instance, frames).output.map((channel) => Array.from(channel))).toEqual([
                Array(frames).fill(0.5),
                Array(frames).fill(0.5),
            ]);
        }
    });
    it('consumes every a-rate value and keeps asymmetric channel detector state independent', async () => {
        const { instance } = await processor();
        const left = new Float32Array(257).fill(0.5);
        const right = new Float32Array(257).fill(0.001);
        const attack = Float32Array.from({ length: 257 }, (_, frame) => (frame < 61 ? 1.5 : 2));
        const sustain = Float32Array.from({ length: 257 }, (_, frame) => (frame < 129 ? 0.25 : 0.5));
        const { output } = render(instance, 257, [left, right], attack, sustain);
        expect(Array.from(output[0])).toEqual(Array.from(attack, (gain) => 0.5 * gain));
        expect(output[1][0]).toBeCloseTo(0.00025, 9);
        expect(output[1][129]).toBeCloseTo(0.0005, 9);
        expect(output[0][61]).toBe(1);
    });
    it('resets before the first re-entry sample and terminal epoch emits silence without render messages', async () => {
        const { instance } = await processor();
        for (let block = 0; block < 375; block++) render(instance, 128);
        const attack = new Float32Array([2]);
        const sustain = new Float32Array([0.25]);
        expect(render(instance, 1, undefined, attack, sustain).output[0][0]).toBe(0.125);
        expect(render(instance, 1, undefined, attack, sustain, 2).output[0][0]).toBe(1);
        const messages = instance.port.postMessage.mock.calls.length;
        const terminal = render(instance, 17, undefined, attack, sustain, 16777215);
        expect(terminal.running).toBe(false);
        expect(terminal.output.map((channel) => Array.from(channel))).toEqual([Array(17).fill(0), Array(17).fill(0)]);
        expect(instance.port.postMessage).toHaveBeenCalledTimes(messages);
    });
    it('scrubs nonfinite PCM and gains without poisoning later audio, fills missing channels and disposes once', async () => {
        const { instance } = await processor();
        const source = new Float32Array([Number.NaN, Number.POSITIVE_INFINITY, 0.5]);
        const before = Array.from(source);
        const { output } = render(instance, 5, [source], new Float32Array([2]), new Float32Array([0.25]));
        expect(output.map((channel) => Array.from(channel))).toEqual([
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
        ]);
        expect(Array.from(source)).toEqual(before);
        expect(
            render(
                instance,
                3,
                [],
                new Float32Array([Number.NaN]),
                new Float32Array([Number.POSITIVE_INFINITY])
            ).output.map((channel) => Array.from(channel))
        ).toEqual([
            [0, 0, 0],
            [0, 0, 0],
        ]);
        const free = vi.spyOn(TransientShaperInstance.prototype, 'free');
        instance.port.onmessage?.({ data: { type: 'dispose' } });
        instance.port.onmessage?.({ data: { type: 'dispose' } });
        expect(free).toHaveBeenCalledTimes(1);
        expect(render(instance, 1).running).toBe(false);
        free.mockRestore();
    });
    it('reports failed initialization without successful readiness or successful audio', async () => {
        const { Constructor } = await processor();
        const instance = new Constructor();
        instance.port.onmessage?.({ data: { type: 'init' } });
        expect(instance.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
        expect(instance.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ready' }));
        expect(render(instance, 17).running).toBe(false);
        expect(render(instance, 17).output[0]).toEqual(new Float32Array(17));
    });
});
