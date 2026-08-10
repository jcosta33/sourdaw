import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const decoded = {
        sample_rate: 44100,
        channels: 2,
        total_frames: 100,
        decode_warning_count: 0,
        decode_warning_summary: '',
        take_samples: vi.fn().mockReturnValue(new Float32Array(200)),
        free: vi.fn(),
    };
    const wasmModule = {
        default: vi.fn(),
        decode_audio_bytes: vi.fn(),
    };
    const loadWasmDecoderModule = vi.fn();
    const warn = vi.fn();
    return { decoded, wasmModule, loadWasmDecoderModule, warn };
});

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.warn },
}));

vi.mock('../loadWasmDecoderModule', () => ({
    loadWasmDecoderModule: mocks.loadWasmDecoderModule,
}));

async function loadSubject() {
    vi.resetModules();
    const { decodeAudioBytesWasm } = await import('../decodeAudioBytesWasm');
    return decodeAudioBytesWasm;
}

describe('decodeAudioBytesWasm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.decoded.sample_rate = 44100;
        mocks.decoded.channels = 2;
        mocks.decoded.total_frames = 100;
        mocks.decoded.decode_warning_count = 0;
        mocks.decoded.decode_warning_summary = '';
        mocks.decoded.take_samples.mockReturnValue(new Float32Array(200));
        mocks.wasmModule.default.mockResolvedValue(undefined);
        mocks.wasmModule.decode_audio_bytes.mockReturnValue(mocks.decoded);
        mocks.loadWasmDecoderModule.mockResolvedValue(mocks.wasmModule);
    });

    it('should load module and decode bytes', async () => {
        const decodeAudioBytesWasm = await loadSubject();
        const bytes = new ArrayBuffer(10);
        const result = await decodeAudioBytesWasm(bytes);

        expect(mocks.wasmModule.default).toHaveBeenCalled();
        expect(mocks.wasmModule.decode_audio_bytes).toHaveBeenCalled();
        expect(result?.interleaved).toBeInstanceOf(Float32Array);
        expect(result?.sampleRate).toBe(44100);
        expect(result?.channels).toBe(2);
        expect(result?.totalFrames).toBe(100);
        expect(mocks.decoded.take_samples).toHaveBeenCalled();
    });

    it('should return null if metadata is invalid', async () => {
        const decodeAudioBytesWasm = await loadSubject();
        mocks.decoded.total_frames = 0;
        const bytes = new ArrayBuffer(10);
        const result = await decodeAudioBytesWasm(bytes);

        expect(result).toBeNull();
        expect(mocks.decoded.free).toHaveBeenCalled();
    });

    it('should retry module initialization after a failed attempt', async () => {
        const decodeAudioBytesWasm = await loadSubject();
        mocks.wasmModule.default.mockRejectedValueOnce(new Error('WASM init failed')).mockResolvedValueOnce(undefined);
        const bytes = new ArrayBuffer(10);

        await expect(decodeAudioBytesWasm(bytes)).resolves.toBeNull();
        const result = await decodeAudioBytesWasm(bytes);

        expect(result?.interleaved).toBeInstanceOf(Float32Array);
        expect(result?.sampleRate).toBe(44100);
        expect(result?.channels).toBe(2);
        expect(result?.totalFrames).toBe(100);
        expect(mocks.wasmModule.default).toHaveBeenCalledTimes(2);
        expect(mocks.wasmModule.decode_audio_bytes).toHaveBeenCalledTimes(1);
    });

    it('should share one in-flight module initialization across concurrent callers', async () => {
        const decodeAudioBytesWasm = await loadSubject();
        let resolveInit: (() => void) | undefined;
        const initPromise = new Promise<void>((resolve) => {
            resolveInit = resolve;
        });
        mocks.wasmModule.default.mockReturnValue(initPromise);
        const bytes = new ArrayBuffer(10);

        const firstCall = decodeAudioBytesWasm(bytes);
        const secondCall = decodeAudioBytesWasm(bytes);
        await vi.waitFor(() => expect(mocks.wasmModule.default).toHaveBeenCalledTimes(1));
        resolveInit?.();

        const results = await Promise.all([firstCall, secondCall]);

        expect(results).toHaveLength(2);
        expect(results[0]).toEqual(results[1]);
        expect(mocks.wasmModule.default).toHaveBeenCalledTimes(1);
        expect(mocks.wasmModule.decode_audio_bytes).toHaveBeenCalledTimes(2);
    });

    it('should keep a healthy module after a file decode failure', async () => {
        const decodeAudioBytesWasm = await loadSubject();
        mocks.wasmModule.decode_audio_bytes
            .mockImplementationOnce(() => {
                throw new Error('file decode failed');
            })
            .mockReturnValueOnce(mocks.decoded);
        const bytes = new ArrayBuffer(10);

        await expect(decodeAudioBytesWasm(bytes)).resolves.toBeNull();
        const result = await decodeAudioBytesWasm(bytes);

        expect(result?.interleaved).toBeInstanceOf(Float32Array);
        expect(result?.sampleRate).toBe(44100);
        expect(result?.channels).toBe(2);
        expect(result?.totalFrames).toBe(100);

        expect(mocks.wasmModule.default).toHaveBeenCalledTimes(1);
        expect(mocks.wasmModule.decode_audio_bytes).toHaveBeenCalledTimes(2);
    });

    it('should report partial decode corruption before consuming the WASM result', async () => {
        const decodeAudioBytesWasm = await loadSubject();
        mocks.decoded.decode_warning_count = 2;
        mocks.decoded.decode_warning_summary = 'malformed stream: corrupt frame; truncated frame';

        await decodeAudioBytesWasm(new ArrayBuffer(10));

        expect(mocks.warn).toHaveBeenCalledWith(
            '[wasmDecoding] skipped 2 corrupt audio packets:',
            'malformed stream: corrupt frame; truncated frame'
        );
    });
});
