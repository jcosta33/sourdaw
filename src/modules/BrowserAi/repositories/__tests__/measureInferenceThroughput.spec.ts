/**
 * These tests pin the figure itself, not that "something was measured".
 *
 * The defect this replaces reported a confident tier derived from
 * `requestAdapter()` latency. So the assertions here are on the arithmetic that
 * turns a real render into a realtime factor, and on every path that must refuse
 * to produce one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

const loadOnnxSession = vi.hoisted(() =>
    vi.fn<(input: { modelId: string; modelData: ArrayBuffer }) => Promise<string[]>>()
);
const runKokoroTts = vi.hoisted(() =>
    vi.fn<(input: unknown) => Promise<{ type: 'tts-result'; audio: Float32Array; samplingRate: number }>>()
);
const releaseGate = vi.hoisted(() => ({ kokoro: true }));

vi.mock('#/infra/release/modelReleaseAdmission', () => ({ MODEL_RELEASE_ADMISSION: releaseGate }));

vi.mock('../inferenceWorkerBridge', () => ({
    inferenceWorkerBridge: { loadOnnxSession, runKokoroTts },
}));

import { KOKORO_MODEL_ARTIFACT } from '../../models/KokoroArtifactManifest';
import { measureInferenceThroughput } from '../measureInferenceThroughput';

type LoggerMock = {
    info: (message: string) => void;
    warn: (message: string) => void;
    debug: (message: string) => void;
};

function create_logger_mock(): LoggerMock {
    return { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

/** Kokoro emits 24 kHz, so 24 000 samples is exactly one second of audio. */
const ONE_SECOND_OF_AUDIO = 24_000;

function install_webgpu(): void {
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { gpu: { requestAdapter: vi.fn() } },
    });
}

function install_no_webgpu(): void {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
}

type InstallReadVerifiedModelInput = {
    result?: ArrayBuffer | null;
    error?: Error;
};

function install_read_verified_model({
    result = new ArrayBuffer(1024),
    error,
}: InstallReadVerifiedModelInput = {}): void {
    const readVerifiedModel = vi.fn(() => (error ? Promise.reject(error) : Promise.resolve(result)));
    injectDependencies(measureInferenceThroughput, { logger: create_logger_mock(), readVerifiedModel });
}

/**
 * Pin the timed window to an exact number of milliseconds. `performance.now()`
 * is read once before and once after the inference call, so two values are
 * enough and the resulting ratio is exact rather than machine-dependent.
 */
function pin_elapsed_ms(elapsedMs: number): void {
    vi.spyOn(performance, 'now')
        .mockReturnValueOnce(1000)
        .mockReturnValueOnce(1000 + elapsedMs);
}

function resolve_audio(sampleCount: number): void {
    runKokoroTts.mockResolvedValue({
        type: 'tts-result',
        audio: new Float32Array(sampleCount),
        samplingRate: 24_000,
    });
}

describe('measureInferenceThroughput', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        loadOnnxSession.mockReset().mockResolvedValue(['webgpu', 'wasm']);
        runKokoroTts.mockReset();
        releaseGate.kokoro = true;
        install_webgpu();
        install_read_verified_model();
    });

    it('should report audio seconds over wall-clock seconds as the realtime factor', async () => {
        // 4 s of audio produced in 2 s of wall clock is 2x real time.
        resolve_audio(4 * ONE_SECOND_OF_AUDIO);
        pin_elapsed_ms(2000);

        const throughput = await measureInferenceThroughput();

        expect(throughput).toEqual({
            status: 'measured',
            modelId: KOKORO_MODEL_ARTIFACT.id,
            executionProviders: ['webgpu', 'wasm'],
            audioSeconds: 4,
            elapsedSeconds: 2,
            realtimeFactor: 2,
        });
    });

    it('refuses to publish a WebGPU measurement when the worker used only WASM', async () => {
        loadOnnxSession.mockResolvedValue(['wasm']);
        resolve_audio(ONE_SECOND_OF_AUDIO);
        pin_elapsed_ms(1000);

        const throughput = await measureInferenceThroughput();

        expect(throughput).toEqual({ status: 'not-measured', reason: 'runtime-unavailable' });
        expect(runKokoroTts).not.toHaveBeenCalled();
    });

    it('should report a factor below one when the render is slower than real time', async () => {
        // 1 s of audio produced in 8 s of wall clock is 0.125x real time.
        resolve_audio(ONE_SECOND_OF_AUDIO);
        pin_elapsed_ms(8000);

        const throughput = await measureInferenceThroughput();

        expect(throughput).toMatchObject({ status: 'measured', audioSeconds: 1, realtimeFactor: 0.125 });
    });

    it('should exclude session creation from the timed window', async () => {
        // loadOnnxSession burns wall clock; the ratio must not absorb it, so
        // the clock is only read after the session exists.
        const clock = vi.spyOn(performance, 'now');
        loadOnnxSession.mockImplementation(() => {
            clock.mockReturnValueOnce(5000).mockReturnValueOnce(6000);
            return Promise.resolve(['webgpu', 'wasm']);
        });
        clock.mockReturnValue(0);
        resolve_audio(2 * ONE_SECOND_OF_AUDIO);

        const throughput = await measureInferenceThroughput();

        expect(throughput).toMatchObject({ elapsedSeconds: 1, realtimeFactor: 2 });
    });

    it('should send a fixed 256-float style vector and a non-empty token sequence', async () => {
        resolve_audio(ONE_SECOND_OF_AUDIO);
        pin_elapsed_ms(1000);

        await measureInferenceThroughput();

        const call = runKokoroTts.mock.calls[0]?.[0] as {
            inputIds: BigInt64Array;
            style: Float32Array;
            speed: number;
        };
        expect(call.style).toHaveLength(256);
        expect(call.speed).toBe(1);
        expect(call.inputIds.length).toBeGreaterThan(0);
    });

    it('should refuse to measure without WebGPU and never touch storage', async () => {
        install_no_webgpu();
        const readVerifiedModel = vi.fn(() => Promise.resolve(new ArrayBuffer(8)));
        injectDependencies(measureInferenceThroughput, { logger: create_logger_mock(), readVerifiedModel });

        const throughput = await measureInferenceThroughput();

        expect(throughput).toEqual({ status: 'not-measured', reason: 'no-webgpu' });
        expect(readVerifiedModel).not.toHaveBeenCalled();
    });

    it('should refuse to measure when the Kokoro artifact is withheld', async () => {
        releaseGate.kokoro = false;
        const readVerifiedModel = vi.fn(() => Promise.resolve(new ArrayBuffer(8)));
        injectDependencies(measureInferenceThroughput, { logger: create_logger_mock(), readVerifiedModel });

        const throughput = await measureInferenceThroughput();

        expect(throughput).toEqual({ status: 'not-measured', reason: 'not-requested' });
        expect(readVerifiedModel).not.toHaveBeenCalled();
    });

    it('should refuse to measure when the probe model is not in OPFS', async () => {
        install_read_verified_model({ result: null });

        const throughput = await measureInferenceThroughput();

        expect(throughput).toEqual({ status: 'not-measured', reason: 'model-not-cached' });
        expect(loadOnnxSession).not.toHaveBeenCalled();
    });

    it('should refuse to measure when reading the model throws', async () => {
        install_read_verified_model({ error: new Error('opfs gone') });

        const throughput = await measureInferenceThroughput();

        expect(throughput).toEqual({ status: 'not-measured', reason: 'model-not-cached' });
    });

    it('should refuse to measure when session creation fails', async () => {
        loadOnnxSession.mockRejectedValue(new Error('no ort'));

        const throughput = await measureInferenceThroughput();

        expect(throughput).toEqual({ status: 'not-measured', reason: 'runtime-unavailable' });
        expect(runKokoroTts).not.toHaveBeenCalled();
    });

    it('should refuse to measure when the inference call rejects', async () => {
        runKokoroTts.mockRejectedValue(new Error('session lost'));

        const throughput = await measureInferenceThroughput();

        expect(throughput).toEqual({ status: 'not-measured', reason: 'inference-failed' });
    });

    it('should refuse to form a ratio from an empty waveform', async () => {
        resolve_audio(0);
        pin_elapsed_ms(1000);

        const throughput = await measureInferenceThroughput();

        expect(throughput).toEqual({ status: 'not-measured', reason: 'inference-failed' });
    });

    it('should refuse to form a ratio from a zero-length timing window', async () => {
        resolve_audio(ONE_SECOND_OF_AUDIO);
        pin_elapsed_ms(0);

        const throughput = await measureInferenceThroughput();

        expect(throughput).toEqual({ status: 'not-measured', reason: 'inference-failed' });
    });
});
