import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../repositories/factorySynthesisWorkerClient', () => ({
    runFactorySynthesisWorker: vi.fn(),
}));

import { type RenderedFactorySample } from '../../models/RenderedFactorySample';
import { runFactorySynthesisWorker } from '../../repositories/factorySynthesisWorkerClient';
import { renderFactorySamples } from '../renderFactorySamples';

function createMockAudioContext() {
    return {
        createBuffer: vi.fn((numberOfChannels: number, length: number, sampleRate: number) => {
            const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
            return {
                numberOfChannels,
                length,
                sampleRate,
                duration: length / sampleRate,
                getChannelData: (index: number) => channels[index]!,
            };
        }),
    };
}

function rendered(index: number): RenderedFactorySample {
    const stereo = index % 3 === 0;
    const length = 16 + index;
    const channel = (offset: number): Float32Array =>
        Float32Array.from({ length }, (_, frame) => (frame + offset + index) / 1000);
    return {
        id: `factory-test-${index}`,
        name: `Test ${index}`,
        category: stereo ? 'fx' : 'bass',
        tags: ['test', String(index)],
        pitch: stereo ? undefined : 24,
        channels: stereo ? [channel(0), channel(1)] : [channel(0)],
        sampleRate: 44100,
    };
}

describe('renderFactorySamples', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('builds one AudioBuffer per rendered sample with its metadata and exact PCM, in order', async () => {
        const samples = Array.from({ length: 20 }, (_, index) => rendered(index));
        vi.mocked(runFactorySynthesisWorker).mockResolvedValue({ status: 'complete', samples });
        const ctx = createMockAudioContext();

        const result = await renderFactorySamples(ctx as unknown as AudioContext);

        expect(result.map((sample) => sample.id)).toEqual(samples.map((sample) => sample.id));
        result.forEach((sample, index) => {
            const source = samples[index]!;
            expect(sample).toMatchObject({
                id: source.id,
                name: source.name,
                category: source.category,
                tags: source.tags,
                pitch: source.pitch,
            });
            expect(sample).not.toHaveProperty('channels');
            expect(sample.buffer.numberOfChannels).toBe(source.channels.length);
            expect(sample.buffer.sampleRate).toBe(44100);
            source.channels.forEach((channel, channelIndex) => {
                expect(Array.from(sample.buffer.getChannelData(channelIndex))).toEqual(Array.from(channel));
            });
        });
    });

    it('yields to the event loop between buffer chunks so no single task builds them all', async () => {
        const samples = Array.from({ length: 20 }, (_, index) => rendered(index));
        vi.mocked(runFactorySynthesisWorker).mockResolvedValue({ status: 'complete', samples });
        const ctx = createMockAudioContext();
        const yields = vi.spyOn(globalThis, 'setTimeout');

        await renderFactorySamples(ctx as unknown as AudioContext);

        // invocationCallOrder is global across mocks, so it orders each yield
        // against the buffers built before it.
        const buildOrder = ctx.createBuffer.mock.invocationCallOrder;
        const builtAtEachYield = yields.mock.invocationCallOrder.map(
            (yieldOrder) => buildOrder.filter((order) => order < yieldOrder).length
        );
        expect(ctx.createBuffer).toHaveBeenCalledTimes(20);
        expect(builtAtEachYield).toEqual([8, 16]);
    });

    it('rejects with the worker failure code and builds nothing when synthesis fails', async () => {
        vi.mocked(runFactorySynthesisWorker).mockResolvedValue({ status: 'failed', code: 'render-timed-out' });
        const ctx = createMockAudioContext();

        await expect(renderFactorySamples(ctx as unknown as AudioContext)).rejects.toThrow('render-timed-out');
        expect(ctx.createBuffer).not.toHaveBeenCalled();
    });
});
