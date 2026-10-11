import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installWorkletGlobals, makeChannels } from './wasmViewGrowthHarness';

type DisposalEngine = {
    __wbg_ptr: number;
    has_retired_bank: () => boolean;
    release_retired_bank: (maxEntries: number) => boolean;
    retire_sample_bank: () => boolean;
    sample_bank_bytes: () => number;
    free: () => void;
};

type LevainProcessorLike = {
    port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: ReturnType<typeof vi.fn> };
    process: (inputs: unknown[], outputs: unknown[]) => boolean;
    _instance: unknown;
};

type Posted = { type?: string; loadToken?: number; done?: boolean };

const FRAMES = 128;
const SAMPLE_FRAMES = 64;
const LARGE_BANK_SAMPLES = 600;
const SMALL_BANK_SAMPLES = 40;
const MESSAGE_LIMIT = 10_000;
const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'));
const wasmModule = new WebAssembly.Module(wasmBytes);

function send(processor: LevainProcessorLike, data: unknown): void {
    processor.port.onmessage?.({ data });
}

function posted(processor: LevainProcessorLike): Posted[] {
    return processor.port.postMessage.mock.calls.map(([message]) => message as Posted);
}

async function startProcessor(): Promise<LevainProcessorLike> {
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

function engineOf(processor: LevainProcessorLike): DisposalEngine {
    if (!processor._instance) {
        throw new TypeError('Expected an initialised engine');
    }
    return processor._instance as DisposalEngine;
}

/** Commit a bank of `samples` one-note zones. */
function loadBank(processor: LevainProcessorLike, loadToken: number, instrumentId: string, samples: number): void {
    send(processor, { type: 'beginSampleBank', bankKey: `bank-${loadToken}`, instrumentId, loadToken });
    const data = new Float32Array(SAMPLE_FRAMES).map((_, frame) => Math.sin(frame * 0.05) * 0.5);
    for (let sampleId = 0; sampleId < samples; sampleId++) {
        send(processor, {
            type: 'beginSample',
            loadToken,
            sampleId,
            frameCount: SAMPLE_FRAMES,
            channels: 1,
            sampleRate: 48_000,
        });
        send(processor, { type: 'sampleChunk', loadToken, sampleId, data });
        send(processor, { type: 'sealSample', loadToken, sampleId });
        send(processor, {
            type: 'addZone',
            loadToken,
            zoneId: sampleId,
            sampleId,
            articulationId: 0,
            rootNote: 60,
            loKey: sampleId % 128,
            hiKey: sampleId % 128,
            loVel: 0,
            hiVel: 127,
            rrPos: 0,
            rrLen: 1,
            micId: 0,
            loopMode: 'forward',
            loopStart: 0,
            loopEnd: SAMPLE_FRAMES,
            loopCrossfade: 0,
            gainDb: 0,
            attack: 0.005,
            decay: 0.1,
            sustain: 1,
            release: 0.3,
        });
    }
    send(processor, { type: 'buildZoneMap', loadToken, numArticulations: 1, numMics: 1 });
    expect(posted(processor)).toContainEqual({ type: 'sampleBankLoaded', loadToken });
}

/** What the host's release loop does after a commit: free the bank it displaced. */
function releaseRetired(processor: LevainProcessorLike, loadToken: number): void {
    for (let step = 0; step < MESSAGE_LIMIT; step++) {
        processor.port.postMessage.mockClear();
        send(processor, { type: 'releaseRetiredBank', loadToken });
        if (posted(processor).some((message) => message.type === 'retiredBankReleased' && message.done === true)) {
            return;
        }
    }
    throw new Error('the retired bank never finished releasing');
}

/** What the node does after `disposed`: one `releaseDisposedBanks` per answer until done. */
function drainDisposed(processor: LevainProcessorLike): boolean[] {
    const answers: boolean[] = [];
    for (let step = 0; step < MESSAGE_LIMIT; step++) {
        processor.port.postMessage.mockClear();
        send(processor, { type: 'releaseDisposedBanks' });
        const answer = posted(processor).find((message) => message.type === 'disposedBanksReleased');
        if (answer?.done === undefined) {
            throw new Error('a disposal release step went unanswered');
        }
        answers.push(answer.done);
        if (answer.done) {
            return answers;
        }
    }
    throw new Error('the disposed bank never finished releasing');
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
});

describe('shipped LevainProcessor disposal release', () => {
    it('frees nothing in dispose and frees a large bank over several paced steps', async () => {
        const processor = await startProcessor();
        loadBank(processor, 1, 'violin-1', LARGE_BANK_SAMPLES);
        releaseRetired(processor, 1);
        const engine = engineOf(processor);
        expect(engine.sample_bank_bytes()).toBeGreaterThan(0);

        send(processor, { type: 'dispose' });

        expect(posted(processor)).toContainEqual({ type: 'disposed' });
        expect(engine.__wbg_ptr, 'dispose must not free the engine').not.toBe(0);
        expect(engine.sample_bank_bytes(), 'dispose must not release the bank').toBeGreaterThan(0);

        const answers = drainDisposed(processor);

        expect(answers.filter((done) => !done).length).toBeGreaterThanOrEqual(3);
        expect(answers.at(-1)).toBe(true);
        expect(engine.__wbg_ptr).toBe(0);
    });

    it('drains the retired bank and the sounding bank before freeing the engine', async () => {
        const processor = await startProcessor();
        loadBank(processor, 1, 'violin-1', SMALL_BANK_SAMPLES);
        loadBank(processor, 2, 'cello', LARGE_BANK_SAMPLES);
        const engine = engineOf(processor);
        expect(engine.has_retired_bank(), 'the first bank is still retired').toBe(true);
        const retires: boolean[] = [];
        const retire = engine.retire_sample_bank.bind(engine);
        engine.retire_sample_bank = () => {
            const retired = retire();
            retires.push(retired);
            return retired;
        };
        const left: { retired: boolean; bytes: number }[] = [];
        const free = engine.free.bind(engine);
        engine.free = () => {
            left.push({ retired: engine.has_retired_bank(), bytes: engine.sample_bank_bytes() });
            free();
        };

        send(processor, { type: 'dispose' });
        const answers = drainDisposed(processor);

        expect(answers.at(-1)).toBe(true);
        expect(retires, 'the retired slot drains first, then the sounding bank retires, then nothing is left').toEqual([
            true,
            false,
        ]);
        expect(left, 'the engine is freed once, holding no bank').toEqual([{ retired: false, bytes: 0 }]);
        expect(engine.__wbg_ptr).toBe(0);
    });

    it('answers done at once when no engine was ever created', async () => {
        const processor = await startProcessor();
        processor._instance = null;
        send(processor, { type: 'dispose' });
        processor.port.postMessage.mockClear();

        send(processor, { type: 'releaseDisposedBanks' });

        expect(posted(processor)).toEqual([{ type: 'disposedBanksReleased', done: true }]);
    });

    it('ignores a release request until the processor is disposed', async () => {
        const processor = await startProcessor();
        loadBank(processor, 1, 'violin-1', SMALL_BANK_SAMPLES);
        const engine = engineOf(processor);
        processor.port.postMessage.mockClear();

        send(processor, { type: 'releaseDisposedBanks' });

        expect(posted(processor)).toEqual([]);
        expect(engine.__wbg_ptr).not.toBe(0);
    });

    it('drains a faulted processor too', async () => {
        const processor = await startProcessor();
        loadBank(processor, 1, 'violin-1', SMALL_BANK_SAMPLES);
        releaseRetired(processor, 1);
        const engine = engineOf(processor);
        const trappingChannel = {
            length: FRAMES,
            set: () => {
                throw new Error('output channel trapped');
            },
        };
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        processor.process([], [[trappingChannel, makeChannels(1, FRAMES)[0]]]);
        expect(posted(processor)).toContainEqual({ type: 'error', message: 'output channel trapped' });

        send(processor, { type: 'dispose' });
        const answers = drainDisposed(processor);

        expect(answers.at(-1)).toBe(true);
        expect(engine.__wbg_ptr).toBe(0);
    });

    it('drops the bank messages a faulted processor would answer once it is disposed', async () => {
        const processor = await startProcessor();
        loadBank(processor, 1, 'violin-1', SMALL_BANK_SAMPLES);
        releaseRetired(processor, 1);
        const engine = engineOf(processor);
        const trappingChannel = {
            length: FRAMES,
            set: () => {
                throw new Error('output channel trapped');
            },
        };
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        processor.process([], [[trappingChannel, makeChannels(1, FRAMES)[0]]]);
        expect(posted(processor)).toContainEqual({ type: 'error', message: 'output channel trapped' });
        send(processor, { type: 'dispose' });
        processor.port.postMessage.mockClear();

        send(processor, { type: 'beginSampleBank', bankKey: 'bank-2', instrumentId: 'cello', loadToken: 2 });
        send(processor, { type: 'releaseRetiredBank', loadToken: 1 });

        expect(posted(processor), 'a disposed processor must not re-post the fault').toEqual([]);

        const answers = drainDisposed(processor);

        expect(answers.at(-1)).toBe(true);
        expect(engine.__wbg_ptr).toBe(0);
    });

    it('stays silent to bank messages once disposed without a fault, and still drains', async () => {
        const processor = await startProcessor();
        loadBank(processor, 1, 'violin-1', SMALL_BANK_SAMPLES);
        releaseRetired(processor, 1);
        const engine = engineOf(processor);
        send(processor, { type: 'dispose' });
        processor.port.postMessage.mockClear();

        send(processor, { type: 'beginSampleBank', bankKey: 'bank-2', instrumentId: 'cello', loadToken: 2 });
        send(processor, { type: 'releaseRetiredBank', loadToken: 1 });

        expect(posted(processor), 'a disposed processor answers neither bank message').toEqual([]);

        const answers = drainDisposed(processor);

        expect(answers.at(-1)).toBe(true);
        expect(engine.__wbg_ptr).toBe(0);
    });

    it('answers done and never frees an engine whose release step threw', async () => {
        const processor = await startProcessor();
        const free = vi.fn();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        // The fake models a step that throws once and later succeeds, a JS-side
        // failure: after the first throw it reports no retired bank and no
        // sounding bank, so only the poison flag keeps a later request from
        // reaching free(). A real wasm trap would throw on every later call.
        let trapped = false;
        processor._instance = {
            all_notes_off: () => undefined,
            abort_sample_bank: () => false,
            has_retired_bank: () => !trapped,
            release_retired_bank: () => {
                trapped = true;
                throw new Error('unreachable');
            },
            retire_sample_bank: () => false,
            free,
        };
        send(processor, { type: 'dispose' });
        processor.port.postMessage.mockClear();

        send(processor, { type: 'releaseDisposedBanks' });

        expect(posted(processor)).toEqual([{ type: 'disposedBanksReleased', done: true }]);
        expect(free).not.toHaveBeenCalled();

        processor.port.postMessage.mockClear();
        send(processor, { type: 'releaseDisposedBanks' });

        expect(posted(processor)).toEqual([{ type: 'disposedBanksReleased', done: true }]);
        expect(free).not.toHaveBeenCalled();
    });

    it('never frees an engine whose retire step threw', async () => {
        const processor = await startProcessor();
        const free = vi.fn();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        // The fake models a retire step that throws once and later succeeds, a
        // JS-side failure: it then reports nothing left to retire, so only the
        // poison flag keeps a later request from reaching free(). A real wasm
        // trap would throw on every later call.
        let trapped = false;
        processor._instance = {
            all_notes_off: () => undefined,
            abort_sample_bank: () => false,
            has_retired_bank: () => false,
            release_retired_bank: () => true,
            retire_sample_bank: () => {
                if (trapped) {
                    return false;
                }
                trapped = true;
                throw new Error('unreachable');
            },
            free,
        };
        send(processor, { type: 'dispose' });
        processor.port.postMessage.mockClear();

        send(processor, { type: 'releaseDisposedBanks' });

        expect(posted(processor)).toEqual([{ type: 'disposedBanksReleased', done: true }]);
        expect(free).not.toHaveBeenCalled();

        processor.port.postMessage.mockClear();
        send(processor, { type: 'releaseDisposedBanks' });

        expect(posted(processor)).toEqual([{ type: 'disposedBanksReleased', done: true }]);
        expect(free).not.toHaveBeenCalled();
    });
});
