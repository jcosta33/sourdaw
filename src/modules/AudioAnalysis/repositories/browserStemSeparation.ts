/**
 * Browser-side stem separation using Demucs v4 ONNX via onnxruntime-web.
 *
 * Runs the same Demucs ONNX model as the Tauri/Rust backend, but entirely
 * in the browser using WebGPU (preferred) or WASM fallback.
 *
 * Model: ~235MB, downloaded from HuggingFace on first use and cached via Cache API.
 */

import { logger } from '#/infra/logger/appLogger';

const DEMUCS_MODEL_URL = 'https://huggingface.co/MansfieldPlumbing/Demucs_v4_TRT/resolve/main/demucsv4.onnx';
const DEMUCS_SAMPLE_RATE = 44100;
const DEMUCS_SEGMENT_LEN = 343980; // ~7.8s at 44100Hz
const STEM_NAMES = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'] as const;
const CACHE_NAME = 'sourdaw-ai-models';

type OrtSession = {
    run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array; dims: number[] }>>;
    release: () => void;
};

let cachedSession: OrtSession | null = null;

/**
 * Get or download the model file, using Cache API for persistence.
 */
async function getModelBuffer(): Promise<ArrayBuffer> {
    // Try Cache API first
    if ('caches' in window) {
        try {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(DEMUCS_MODEL_URL);
            if (cached) {
                logger.info('[Browser Stems] Loading model from cache...');
                return cached.arrayBuffer();
            }
        } catch {
            // Cache API not available or failed, continue to download
        }
    }

    logger.info('[Browser Stems] Downloading Demucs ONNX model (~235MB)...');
    const response = await fetch(DEMUCS_MODEL_URL);
    if (!response.ok) {
        throw new Error(`Failed to download Demucs model: ${String(response.status)}`);
    }

    const buffer = await response.arrayBuffer();

    // Cache for next time
    if ('caches' in window) {
        try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(DEMUCS_MODEL_URL, new Response(buffer.slice(0)));
            logger.info('[Browser Stems] Model cached for future use');
        } catch {
            // Caching failed, not critical
        }
    }

    return buffer;
}

/**
 * Create or return a cached ONNX inference session.
 */
async function getSession(): Promise<OrtSession> {
    if (cachedSession) {
        return cachedSession;
    }

    const ort = await import('onnxruntime-web');

    // Prefer WebGPU, fall back to WASM
    const executionProviders: string[] = [];
    if ('gpu' in navigator) {
        executionProviders.push('webgpu');
    }
    executionProviders.push('wasm');

    const modelBuffer = await getModelBuffer();

    logger.info(`[Browser Stems] Creating ONNX session (providers: ${executionProviders.join(', ')})...`);

    const session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders,
        graphOptimizationLevel: 'all',
    });

    cachedSession = session as unknown as OrtSession;
    logger.info('[Browser Stems] Session ready');
    return cachedSession;
}

/**
 * Resample audio using OfflineAudioContext.
 */
async function resampleBuffer(buffer: AudioBuffer, targetRate: number): Promise<AudioBuffer> {
    if (buffer.sampleRate === targetRate) {
        return buffer;
    }
    const ratio = targetRate / buffer.sampleRate;
    const newLength = Math.round(buffer.length * ratio);
    const ctx = new OfflineAudioContext(buffer.numberOfChannels, newLength, targetRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    return ctx.startRendering();
}

export type BrowserStemResult = Record<string, AudioBuffer>;

/**
 * Separate audio into stems using Demucs v4 ONNX in the browser.
 *
 * @param audioData WAV ArrayBuffer
 * @param requestedStems Which stems to return (default: drums, bass, vocals, other)
 * @returns Map of stem name → AudioBuffer
 */
export async function separateStemsBrowser(
    audioData: ArrayBuffer,
    requestedStems: string[] = ['all']
): Promise<BrowserStemResult> {
    const session = await getSession();
    const ort = await import('onnxruntime-web');

    // Decode input audio
    const audioContext = new AudioContext();
    const sourceBuffer = await audioContext.decodeAudioData(audioData.slice(0));
    await audioContext.close();

    // Resample to 44100Hz
    const resampled = await resampleBuffer(sourceBuffer, DEMUCS_SAMPLE_RATE);

    const left = resampled.getChannelData(0);
    const right = resampled.numberOfChannels > 1 ? resampled.getChannelData(1) : left;
    const totalSamples = left.length;

    // Determine which stems to return
    const wanted = requestedStems.includes('all')
        ? STEM_NAMES.slice(0, 4) // Default: drums, bass, other, vocals
        : STEM_NAMES.filter((n) => requestedStems.includes(n));

    // Initialize accumulators for all 6 stems (stereo)
    const stemL: Float32Array[] = Array.from({ length: 6 }, () => new Float32Array(totalSamples));
    const stemR: Float32Array[] = Array.from({ length: 6 }, () => new Float32Array(totalSamples));

    // Process in segments
    let offset = 0;
    let segmentIndex = 0;
    const totalSegments = Math.ceil(totalSamples / DEMUCS_SEGMENT_LEN);

    while (offset < totalSamples) {
        segmentIndex++;
        logger.info(`[Browser Stems] Processing segment ${String(segmentIndex)}/${String(totalSegments)}...`);

        const end = Math.min(offset + DEMUCS_SEGMENT_LEN, totalSamples);
        const segLen = end - offset;

        // Build input: [1, 2, DEMUCS_SEGMENT_LEN]
        const inputData = new Float32Array(2 * DEMUCS_SEGMENT_LEN);
        inputData.set(left.subarray(offset, end), 0);
        inputData.set(right.subarray(offset, end), DEMUCS_SEGMENT_LEN);

        const inputTensor = new ort.Tensor('float32', inputData, [1, 2, DEMUCS_SEGMENT_LEN]);

        // Run inference
        const feeds: Record<string, unknown> = { input: inputTensor };
        const results = await session.run(feeds);

        // Output: [1, 6, 2, DEMUCS_SEGMENT_LEN]
        const outputKey = Object.keys(results)[0];
        if (!outputKey) {
            throw new Error('No output from Demucs model');
        }
        const output = results[outputKey];
        if (!output) {
            throw new Error('Empty output from Demucs model');
        }
        const outData = output.data as Float32Array;
        const dims = output.dims as number[];

        const nStems = dims[1] ?? 6;
        const nCh = dims[2] ?? 2;
        const segOutLen = dims[3] ?? DEMUCS_SEGMENT_LEN;
        const copyLen = Math.min(segLen, segOutLen);

        for (let s = 0; s < Math.min(nStems, 6); s++) {
            for (let j = 0; j < copyLen; j++) {
                const lIdx = s * nCh * segOutLen + j;
                const rIdx = s * nCh * segOutLen + segOutLen + j;
                stemL[s]![offset + j] = outData[lIdx] ?? 0;
                stemR[s]![offset + j] = outData[rIdx] ?? 0;
            }
        }

        offset += DEMUCS_SEGMENT_LEN;
    }

    // Convert to AudioBuffers (resample back if source was different rate)
    const result: BrowserStemResult = {};
    const needsResample = sourceBuffer.sampleRate !== DEMUCS_SAMPLE_RATE;

    for (const name of wanted) {
        const idx = STEM_NAMES.indexOf(name);
        if (idx === -1) {
            continue;
        }

        // Create stereo AudioBuffer at model sample rate
        const stemCtx = new OfflineAudioContext(2, totalSamples, DEMUCS_SAMPLE_RATE);
        const buf = stemCtx.createBuffer(2, totalSamples, DEMUCS_SAMPLE_RATE);
        buf.getChannelData(0).set(stemL[idx]!);
        buf.getChannelData(1).set(stemR[idx]!);

        if (needsResample) {
            result[name] = await resampleBuffer(buf, sourceBuffer.sampleRate);
        } else {
            result[name] = buf;
        }
    }

    logger.info(`[Browser Stems] Separated into ${String(Object.keys(result).length)} stems`);
    return result;
}
