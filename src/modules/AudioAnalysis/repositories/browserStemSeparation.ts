/**
 * Browser-side stem separation using Demucs v4 ONNX via onnxruntime-web.
 *
 * Runs the same Demucs ONNX model as the Tauri/Rust backend, but entirely
 * in the browser using WebGPU (preferred) or WASM fallback.
 *
 * Model: ~235MB, downloaded from HuggingFace on first use and cached via Cache API.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { resampleBuffer } from './resampleBuffer';

const DEMUCS_MODEL_URL = 'https://huggingface.co/MansfieldPlumbing/Demucs_v4_TRT/resolve/main/demucsv4.onnx';
const DEMUCS_SAMPLE_RATE = 44100;
const DEMUCS_SEGMENT_LEN = 343980; // ~7.8s at 44100Hz
const STEM_NAMES = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'] as const;
const CACHE_NAME = 'sourdaw-ai-models';

type OrtSession = {
    run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array; dims: number[] }>>;
    release: () => void;
};

// §152.1 — Coalesce the ONNX session cache into a holder so module-level
// mutation is scoped to this file. HMR still discards the 235MB model
// on hot reload (the browser Cache API handles persistence across page
// loads); a full HMR-safe fix requires porting the session into a
// persistent store, but the 1-line scope reduction at least hides the
// binding from external writers.
//
// `pending` memoizes the *in-flight* load promise, not just the resolved
// session. Without it, two concurrent first calls both observe a null
// session and each download the ~235MB model + create a second
// InferenceSession (OOM hazard). With it, the first caller stores the
// promise and every concurrent caller awaits that one load. On failure
// `pending` is cleared so a later call can retry.
const ortSession: {
    cached: OrtSession | null;
    pending: Promise<OrtSession> | null;
    ort: typeof import('onnxruntime-web') | null;
} = {
    cached: null,
    pending: null,
    ort: null,
};

type BrowserStemResult = Record<string, AudioBuffer>;

/**
 * Separate audio into stems using Demucs v4 ONNX in the browser.
 *
 * @param audioData WAV ArrayBuffer
 * @param requestedStems Which stems to return (default: drums, bass, vocals, other)
 * @returns Map of stem name → AudioBuffer
 */
export const separateStemsBrowser = inject({ logger })(({ logger }) => {
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
     * Download the model and build a fresh ONNX inference session. This is
     * the expensive (~235MB download + session create) work that must run
     * at most once; `getSession` guards against concurrent invocations.
     */
    async function loadSession(): Promise<OrtSession> {
        // §152.2 — cache the onnxruntime-web namespace as well so the
        // second dynamic import in separateStemsBrowser below becomes a
        // closure-scope hit instead of another import() microtask.
        ortSession.ort ??= await import('onnxruntime-web');
        const ort = ortSession.ort;

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

        // eslint-disable-next-line sourdaw/no-type-assertion-escape -- OrtSession is a structural subset of onnxruntime InferenceSession; run() return type differs only in index signature variance
        const ortLikeSession = session as unknown as OrtSession;
        logger.info('[Browser Stems] Session ready');
        return ortLikeSession;
    }

    /**
     * Create or return a cached ONNX inference session.
     *
     * Concurrent first callers must not each download the 235MB model and
     * build a second session (OOM hazard). We memoize the in-flight load
     * promise so every caller awaits a single `loadSession()`; once it
     * resolves the result is promoted to `cached` and the promise is
     * cleared. If the load rejects, `pending` is reset so a later call can
     * retry instead of permanently caching the failure.
     */
    async function getSession(): Promise<OrtSession> {
        if (ortSession.cached) {
            return ortSession.cached;
        }

        ortSession.pending ??= loadSession().catch((error: unknown) => {
            ortSession.pending = null;
            throw error;
        });

        const session = await ortSession.pending;
        ortSession.cached = session;
        ortSession.pending = null;
        return session;
    }

    return async function separateStemsBrowser(
        audioData: ArrayBuffer,
        requestedStems: string[] = ['all']
    ): Promise<BrowserStemResult> {
        const session = await getSession();
        // getSession() above has already populated ortSession.ort.
        const ort = ortSession.ort!;

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
            : STEM_NAMES.filter((node) => requestedStems.includes(node));

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
            const outData = output.data;
            const dims = output.dims;

            const nStems = dims[1] ?? 6;
            const nCh = dims[2] ?? 2;
            const segOutLen = dims[3] ?? DEMUCS_SEGMENT_LEN;
            const copyLen = Math.min(segLen, segOutLen);

            for (let state = 0; state < Math.min(nStems, 6); state++) {
                for (let jIndex = 0; jIndex < copyLen; jIndex++) {
                    const lIdx = state * nCh * segOutLen + jIndex;
                    const rIdx = state * nCh * segOutLen + segOutLen + jIndex;
                    stemL[state]![offset + jIndex] = outData[lIdx] ?? 0;
                    stemR[state]![offset + jIndex] = outData[rIdx] ?? 0;
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
    };
});
