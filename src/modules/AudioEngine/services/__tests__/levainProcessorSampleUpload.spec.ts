import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LEVAIN_SAMPLE_CHUNK_FLOATS } from '#/infra/audioWorklet/levainSampleChunk';

import { installWorkletGlobals, makeChannels } from './wasmViewGrowthHarness';

// The shipped engine, driven through the shipped processor: a sample uploads in
// bounded chunks into storage the engine reserved when the sample began.

type Engine = {
    has_retired_bank: () => boolean;
    sample_write_ptr: (sampleId: number) => number;
    sample_write_floats: (sampleId: number) => number;
    commit_sample_frames: (sampleId: number, floatCount: number) => boolean;
};

type LevainProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process: (inputs: unknown[], outputs: unknown[]) => boolean;
    _instance: Engine | null;
    _memory: WebAssembly.Memory | null;
};

type Posted = { type?: string; loadToken?: number; message?: string; done?: boolean };

const FRAMES = 128;
const SAMPLE_RATE = 48_000;
const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'));
const wasmModule = new WebAssembly.Module(wasmBytes);

/**
 * Violin-1's shape: 161 samples of varied length. The bank is scaled down by
 * `LEVAIN_UPLOAD_SCALE` so the spec stays fast; set it to 1 to upload the full
 * ~124 MiB bank and print the handler times.
 */
const BANK_SAMPLES = 161;
const FULL_BANK_FLOATS = Math.round((124 * 1024 * 1024) / Float32Array.BYTES_PER_ELEMENT);
const SCALE = Number(process.env.LEVAIN_UPLOAD_SCALE ?? '0.25');

function bankSampleLengths(): number[] {
    const weights = Array.from({ length: BANK_SAMPLES }, (_, index) => 0.3 + ((index * 7919) % 101) / 100);
    const sum = weights.reduce((total, weight) => total + weight, 0);
    return weights.map((weight) => Math.max(1, Math.round((FULL_BANK_FLOATS * SCALE * weight) / sum)));
}

function pcm(length: number, seed = 0): Float32Array {
    return new Float32Array(length).map((_, index) => Math.sin((index + seed) * 0.0137) * 0.6);
}

function send(processor: LevainProcessorLike, data: unknown): void {
    processor.port.onmessage?.({ data });
}

function posted(processor: LevainProcessorLike): Posted[] {
    return processor.port.postMessage.mock.calls.map(([message]) => message as Posted);
}

function errors(processor: LevainProcessorLike): string[] {
    return posted(processor)
        .filter((message) => message.type === 'sampleBankError' || message.type === 'error')
        .map((message) => message.message ?? '');
}

async function createProcessor(): Promise<LevainProcessorLike> {
    // A fresh module per processor: its in-flight bank registry is module state.
    vi.resetModules();
    const { registry } = installWorkletGlobals<LevainProcessorLike>();
    await import('../levainProcessor');
    const Processor = registry.get('levain-processor');
    if (!Processor) {
        throw new TypeError('Expected levain-processor registration');
    }
    const processor = new Processor({ processorOptions: { wasmModule } });
    send(processor, { type: 'init' });
    vi.stubGlobal('currentFrame', 0);
    return processor;
}

function engineOf(processor: LevainProcessorLike): Engine {
    if (!processor._instance) {
        throw new TypeError('Expected an initialised engine');
    }
    return processor._instance;
}

function beginBank(processor: LevainProcessorLike, loadToken: number): void {
    send(processor, { type: 'beginSampleBank', bankKey: `bank-${loadToken}`, instrumentId: 'violin-1', loadToken });
}

function beginSample(processor: LevainProcessorLike, loadToken: number, sampleId: number, frames: number): void {
    send(processor, {
        type: 'beginSample',
        loadToken,
        sampleId,
        frameCount: frames,
        channels: 1,
        sampleRate: SAMPLE_RATE,
    });
}

function sendChunk(processor: LevainProcessorLike, loadToken: number, sampleId: number, data: Float32Array): void {
    send(processor, { type: 'sampleChunk', loadToken, sampleId, data });
}

/** A whole sample as the loader posts it, in chunks of `chunkFloats`. */
function uploadSample(
    processor: LevainProcessorLike,
    loadToken: number,
    sampleId: number,
    data: Float32Array,
    chunkFloats = LEVAIN_SAMPLE_CHUNK_FLOATS
): void {
    beginSample(processor, loadToken, sampleId, data.length);
    for (let offset = 0; offset < data.length; offset += chunkFloats) {
        sendChunk(processor, loadToken, sampleId, data.slice(offset, offset + chunkFloats));
    }
    send(processor, { type: 'sealSample', loadToken, sampleId });
}

function addLoopingZone(processor: LevainProcessorLike, loadToken: number, sampleId: number, frames: number): void {
    send(processor, {
        type: 'addZone',
        loadToken,
        zoneId: sampleId,
        sampleId,
        articulationId: 0,
        rootNote: sampleId % 128,
        loKey: sampleId % 128,
        hiKey: sampleId % 128,
        loVel: 0,
        hiVel: 127,
        rrPos: 0,
        rrLen: 1,
        micId: 0,
        loopMode: 'forward',
        loopStart: 0,
        loopEnd: frames,
        loopCrossfade: 0,
        gainDb: 0,
        attack: 0.005,
        decay: 0.1,
        sustain: 1,
        release: 0.3,
    });
}

function buildBank(processor: LevainProcessorLike, loadToken: number): void {
    send(processor, { type: 'buildZoneMap', loadToken, numArticulations: 1, numMics: 1 });
}

/** Sound a held note and return `quanta` quanta of left output. */
function renderNote(processor: LevainProcessorLike, note: number, quanta: number): number[] {
    send(processor, { type: 'noteOn', note, velocity: 100 });
    const rendered: number[] = [];
    for (let quantum = 0; quantum < quanta; quantum++) {
        const output = makeChannels(2, FRAMES);
        processor.process([], [output]);
        rendered.push(...output[0]!);
    }
    return rendered;
}

function peak(samples: number[]): number {
    return samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
}

/** Index of the first sample the two renders disagree on, or -1: a failure reads as one number, not a diff of thousands. */
function firstMismatch(actual: number[], expected: number[]): number {
    return actual.findIndex((sample, index) => !Object.is(sample, expected[index]));
}

function memoryBytes(processor: LevainProcessorLike, address: number, byteLength: number): number[] {
    if (!processor._memory) {
        throw new TypeError('Expected the engine memory');
    }
    return [...new Uint8Array(processor._memory.buffer, address, byteLength)];
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('shipped LevainProcessor sample upload', () => {
    it('uploads a violin-shaped bank with no message copying more than one chunk, and the bank sounds', async () => {
        const processor = await createProcessor();
        const engine = engineOf(processor);
        const committed: number[] = [];
        const commit = engine.commit_sample_frames.bind(engine);
        engine.commit_sample_frames = (sampleId, floatCount) => {
            committed.push(floatCount);
            return commit(sampleId, floatCount);
        };
        const handlerMs: { type: string; ms: number }[] = [];
        const timed = (data: Record<string, unknown> & { type: string }): void => {
            const started = performance.now();
            send(processor, data);
            handlerMs.push({ type: data.type, ms: performance.now() - started });
        };
        const lengths = bankSampleLengths();

        timed({ type: 'beginSampleBank', bankKey: 'violin', instrumentId: 'violin-1', loadToken: 1 });
        for (const [sampleId, length] of lengths.entries()) {
            const data = pcm(length, sampleId);
            timed({
                type: 'beginSample',
                loadToken: 1,
                sampleId,
                frameCount: length,
                channels: 1,
                sampleRate: SAMPLE_RATE,
            });
            for (let offset = 0; offset < length; offset += LEVAIN_SAMPLE_CHUNK_FLOATS) {
                timed({
                    type: 'sampleChunk',
                    loadToken: 1,
                    sampleId,
                    data: data.slice(offset, offset + LEVAIN_SAMPLE_CHUNK_FLOATS),
                });
            }
            timed({ type: 'sealSample', loadToken: 1, sampleId });
            addLoopingZone(processor, 1, sampleId, length);
        }
        timed({ type: 'buildZoneMap', loadToken: 1, numArticulations: 1, numMics: 1 });

        expect(errors(processor)).toEqual([]);
        expect(posted(processor)).toContainEqual({ type: 'sampleBankLoaded', loadToken: 1 });
        expect(Math.max(...committed)).toBe(LEVAIN_SAMPLE_CHUNK_FLOATS);
        expect(committed.reduce((total, floats) => total + floats, 0)).toBe(
            lengths.reduce((total, length) => total + length, 0)
        );
        expect(peak(renderNote(processor, 69, 8))).toBeGreaterThan(1e-6);

        if (process.env.LEVAIN_UPLOAD_SCALE !== undefined) {
            const byType = new Map<string, number>();
            for (const { type, ms } of handlerMs) {
                byType.set(type, Math.max(byType.get(type) ?? 0, ms));
            }
            console.info(
                JSON.stringify({
                    kind: 'levain-chunked-upload',
                    scale: SCALE,
                    messages: handlerMs.length,
                    maxMsByType: Object.fromEntries(byType),
                    maxMs: Math.max(...handlerMs.map(({ ms }) => ms)),
                    totalMs: handlerMs.reduce((total, { ms }) => total + ms, 0),
                })
            );
        }
    }, 600_000);

    it('answers each accepted chunk once, after it is written, and a refused chunk not at all', async () => {
        const processor = await createProcessor();
        const engine = engineOf(processor);
        const committedWhenAnswered: number[] = [];
        let committed = 0;
        const commit = engine.commit_sample_frames.bind(engine);
        engine.commit_sample_frames = (sampleId, floatCount) => {
            const accepted = commit(sampleId, floatCount);
            if (accepted) {
                committed++;
            }
            return accepted;
        };
        processor.port.postMessage.mockImplementation((message: Posted) => {
            if (message.type === 'sampleChunkWritten') {
                committedWhenAnswered.push(committed);
            }
        });
        const frames = 3 * LEVAIN_SAMPLE_CHUNK_FLOATS + 5;
        beginBank(processor, 1);

        uploadSample(processor, 1, 0, pcm(frames));

        expect(posted(processor).filter((message) => message.type === 'sampleChunkWritten')).toEqual(
            Array.from({ length: 4 }, () => ({ type: 'sampleChunkWritten', loadToken: 1, sampleId: 0 }))
        );
        expect(committedWhenAnswered).toEqual([1, 2, 3, 4]);

        beginSample(processor, 1, 1, 100);
        sendChunk(processor, 1, 1, pcm(200));

        expect(posted(processor).filter((message) => message.type === 'sampleChunkWritten')).toHaveLength(4);
        expect(errors(processor)).toEqual(['Levain sample chunk does not fit the open sample']);
    });

    it('renders a sample the same whatever the chunk boundaries fall on', async () => {
        const frames = 2 * LEVAIN_SAMPLE_CHUNK_FLOATS + 1_231;
        const data = pcm(frames);

        async function render(chunkFloats: number): Promise<number[]> {
            const processor = await createProcessor();
            beginBank(processor, 1);
            uploadSample(processor, 1, 0, data, chunkFloats);
            addLoopingZone(processor, 1, 0, frames);
            buildBank(processor, 1);
            expect(errors(processor)).toEqual([]);
            const quanta = Math.ceil(frames / FRAMES) + 4;
            return renderNote(processor, 0, quanta);
        }

        const wholeChunks = await render(LEVAIN_SAMPLE_CHUNK_FLOATS);
        const oddChunks = await render(5_003);

        expect(peak(wholeChunks)).toBeGreaterThan(1e-6);
        expect(oddChunks).toHaveLength(wholeChunks.length);
        expect(firstMismatch(oddChunks, wholeChunks)).toBe(-1);
    });

    it('offers a window of exactly the loader chunk size, and no more, for a large sample', async () => {
        const processor = await createProcessor();
        beginBank(processor, 1);
        beginSample(processor, 1, 0, 5 * LEVAIN_SAMPLE_CHUNK_FLOATS);

        expect(engineOf(processor).sample_write_floats(0)).toBe(LEVAIN_SAMPLE_CHUNK_FLOATS);
    });

    it('rejects the load when a sample is sealed short, and never commits the bank', async () => {
        const processor = await createProcessor();
        beginBank(processor, 1);
        beginSample(processor, 1, 0, 1_000);
        sendChunk(processor, 1, 0, pcm(999));

        send(processor, { type: 'sealSample', loadToken: 1, sampleId: 0 });

        expect(errors(processor)).toEqual(['Levain DSP could not seal a sample whose PCM is incomplete']);
        addLoopingZone(processor, 1, 0, 1_000);
        buildBank(processor, 1);
        expect(posted(processor).filter((message) => message.type === 'sampleBankLoaded')).toEqual([]);
    });

    it('refuses an oversized chunk before writing a byte of it', async () => {
        const processor = await createProcessor();
        beginBank(processor, 1);
        beginSample(processor, 1, 0, 3 * LEVAIN_SAMPLE_CHUNK_FLOATS);
        const address = engineOf(processor).sample_write_ptr(0);
        const watched = 2 * LEVAIN_SAMPLE_CHUNK_FLOATS * Float32Array.BYTES_PER_ELEMENT;
        const before = memoryBytes(processor, address, watched);

        sendChunk(processor, 1, 0, pcm(2 * LEVAIN_SAMPLE_CHUNK_FLOATS).fill(1));

        expect(errors(processor)).toEqual(['Levain sample chunk does not fit the open sample']);
        expect(memoryBytes(processor, address, watched)).toEqual(before);
    });

    it('refuses a chunk for another sample before writing a byte of it', async () => {
        const processor = await createProcessor();
        beginBank(processor, 1);
        beginSample(processor, 1, 0, 4_000);
        const address = engineOf(processor).sample_write_ptr(0);
        const before = memoryBytes(processor, address, 4_000 * Float32Array.BYTES_PER_ELEMENT);

        sendChunk(processor, 1, 1, pcm(100).fill(1));

        expect(errors(processor)).toHaveLength(1);
        expect(memoryBytes(processor, address, 4_000 * Float32Array.BYTES_PER_ELEMENT)).toEqual(before);
    });

    it('refuses a chunk past the sample capacity before writing a byte of it', async () => {
        const processor = await createProcessor();
        beginBank(processor, 1);
        beginSample(processor, 1, 0, 1_000);
        sendChunk(processor, 1, 0, pcm(900));
        const address = engineOf(processor).sample_write_ptr(0);
        const before = memoryBytes(processor, address, 400 * Float32Array.BYTES_PER_ELEMENT);

        sendChunk(processor, 1, 0, pcm(200).fill(1));

        expect(errors(processor)).toEqual(['Levain sample chunk does not fit the open sample']);
        expect(memoryBytes(processor, address, 400 * Float32Array.BYTES_PER_ELEMENT)).toEqual(before);
    });

    it('retires a sample caught mid-upload by an abort, frees it by message, and loads the next bank', async () => {
        const processor = await createProcessor();
        beginBank(processor, 1);
        uploadSample(processor, 1, 0, pcm(2_000));
        addLoopingZone(processor, 1, 0, 2_000);
        buildBank(processor, 1);
        send(processor, { type: 'releaseRetiredBank', loadToken: 1 });
        expect(errors(processor)).toEqual([]);

        beginBank(processor, 2);
        beginSample(processor, 2, 0, 3 * LEVAIN_SAMPLE_CHUNK_FLOATS);
        sendChunk(processor, 2, 0, pcm(LEVAIN_SAMPLE_CHUNK_FLOATS));
        send(processor, { type: 'abortSampleBank', loadToken: 2 });

        expect(engineOf(processor).has_retired_bank()).toBe(true);
        send(processor, { type: 'releaseRetiredBank', loadToken: 2 });
        expect(posted(processor)).toContainEqual({ type: 'retiredBankReleased', loadToken: 2, done: true });
        expect(engineOf(processor).has_retired_bank()).toBe(false);

        beginBank(processor, 3);
        uploadSample(processor, 3, 0, pcm(2_000, 7));
        addLoopingZone(processor, 3, 0, 2_000);
        buildBank(processor, 3);
        expect(posted(processor)).toContainEqual({ type: 'sampleBankLoaded', loadToken: 3 });
        expect(peak(renderNote(processor, 0, 8))).toBeGreaterThan(1e-6);
    });
});
