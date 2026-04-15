/**
 * ONNX Inference Worker — handles DiffSinger and Kokoro TTS via onnxruntime-web.
 *
 * Bundled as a separate chunk by Vite via the `?worker` import in inferenceWorkerBridge.ts.
 * Always initialized when browser AI features are active.
 *
 * Design:
 * - ONNX sessions are created per model and cached by modelId
 * - LRU eviction applied when total weight memory exceeds 1 GB
 * - Progress events emitted per pipeline stage
 * - Audio buffers transferred via Transferable (zero-copy)
 */

import type { WorkerRequest, WorkerResponse, TensorData } from '../models/InferenceRequest';

// ── Types ──────────────────────────────────────────────────────────────────

type OrtInferenceSession = {
    run: (feeds: Record<string, OrtTensor>) => Promise<Record<string, { data: Float32Array | BigInt64Array; dims: number[] }>>;
    release: () => Promise<void>;
};

type OrtTensor = {
    data: Float32Array | BigInt64Array | Int32Array | Uint8Array;
    dims: number[];
};

type OrtModule = {
    InferenceSession: {
        create: (data: ArrayBuffer, options?: { executionProviders?: string[] }) => Promise<OrtInferenceSession>;
    };
    Tensor: new (type: string, data: ArrayBuffer | Float32Array | BigInt64Array | Int32Array | Uint8Array, dims: number[]) => OrtTensor;
    env: { wasm: { numThreads: number } };
};

type SessionEntry = {
    session: OrtInferenceSession;
    modelId: string;
    sizeBytes: number;
    lastUsedAt: number;
};

// ── Session manager ────────────────────────────────────────────────────────

const SESSION_MEMORY_BUDGET = 1024 * 1024 * 1024; // 1 GB

const sessionCache: Map<string, SessionEntry> = new Map();
let totalMemoryBytes = 0;
let ortModule: OrtModule | null = null;

async function getOrt(): Promise<OrtModule> {
    if (ortModule) {
        return ortModule;
    }
    // Dynamic import keeps onnxruntime-web out of the main bundle
    const ort = await import('onnxruntime-web') as unknown as OrtModule;
    // Multi-threaded WASM requires SharedArrayBuffer which is only available
    // when crossOriginIsolated is true. IIFE workers (forced by Rolldown)
    // are not cross-origin isolated, so fall back to single-threaded.
    ort.env.wasm.numThreads = (typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated)
        ? (navigator.hardwareConcurrency ?? 4)
        : 1;
    ortModule = ort;
    return ort;
}

function selectExecutionProviders(): string[] {
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        return ['webgpu', 'wasm'];
    }
    // Safety net — feature should have been disabled at the UI level
    console.warn('[OnnxWorker] WebGPU unavailable — falling back to WASM only');
    return ['wasm'];
}

async function evictLru(): Promise<void> {
    while (totalMemoryBytes > SESSION_MEMORY_BUDGET && sessionCache.size > 0) {
        let oldest: [string, SessionEntry] | null = null;
        for (const entry of sessionCache.entries()) {
            if (!oldest || entry[1].lastUsedAt < oldest[1].lastUsedAt) {
                oldest = entry;
            }
        }
        if (!oldest) {
            break;
        }
        const [id, entry] = oldest;
        await entry.session.release();
        totalMemoryBytes -= entry.sizeBytes;
        sessionCache.delete(id);
    }
}

async function getOrCreateSession(modelId: string, modelData: ArrayBuffer): Promise<OrtInferenceSession> {
    const cached = sessionCache.get(modelId);
    if (cached) {
        cached.lastUsedAt = Date.now();
        return cached.session;
    }

    const ort = await getOrt();
    const providers = selectExecutionProviders();
    const session = await ort.InferenceSession.create(modelData, { executionProviders: providers });

    const entry: SessionEntry = {
        session,
        modelId,
        sizeBytes: modelData.byteLength,
        lastUsedAt: Date.now(),
    };
    sessionCache.set(modelId, entry);
    totalMemoryBytes += modelData.byteLength;

    await evictLru();
    return session;
}

// ── Tensor helpers ─────────────────────────────────────────────────────────

function tensorDataToOrt(ort: OrtModule, td: TensorData): OrtTensor {
    const type = td.type === 'int64' ? 'int64' : td.type === 'int32' ? 'int32' : td.type === 'bool' ? 'bool' : 'float32';
    return new ort.Tensor(type, td.data, td.dims);
}

// ── DiffSinger pipeline ───────────────────────────────────────────────────

type DiffSingerSessions = {
    linguistic: OrtInferenceSession;
    dur: OrtInferenceSession;
    pitch: OrtInferenceSession;
    variance: OrtInferenceSession;
    acoustic: OrtInferenceSession;
    vocoder: OrtInferenceSession;
};

/**
 * Broadcast a 256-dim speaker embedding to [1, nFrames, 256] for acoustic/pitch/variance models.
 * DiffSinger models expect a per-frame speaker embedding; we tile the single 256-dim vector.
 */
function broadcastSpkEmbed(ort: OrtModule, embed: Float32Array, nFrames: number): OrtTensor {
    const tiled = new Float32Array(nFrames * 256);
    for (let f = 0; f < nFrames; f++) {
        tiled.set(embed, f * 256);
    }
    return new ort.Tensor('float32', tiled, [1, nFrames, 256]);
}

/**
 * Run the full DiffSinger browser SVS pipeline.
 * Steps: linguistic → duration → pitch → variance → acoustic (diffusion) → vocoder
 */
async function runDiffSingerPipeline(
    requestId: string,
    sessions: DiffSingerSessions,
    ort: OrtModule,
    params: Extract<WorkerRequest, { type: 'run-diffsinger-phrase' }>
): Promise<Float32Array> {
    const post = (stage: string, progress: number): void => {
        const msg: WorkerResponse = { type: 'inference-progress', requestId, stage, progress };
        self.postMessage(msg);
    };

    // ── 1. Linguistic encoder ──────────────────────────────────────────────
    post('Encoding phonemes', 0.05);
    const nTokens = params.tokenIds.length;
    const nWords = params.wordDiv.length;

    const tokens = new ort.Tensor('int64', BigInt64Array.from(params.tokenIds.map(BigInt)), [1, nTokens]);
    const wordDiv = new ort.Tensor('int64', BigInt64Array.from(params.wordDiv.map(BigInt)), [1, nWords]);
    const wordDur = new ort.Tensor('int64', BigInt64Array.from(params.wordDur.map(BigInt)), [1, nWords]);

    const linguisticOut = await sessions.linguistic.run({ tokens, word_div: wordDiv, word_dur: wordDur });
    const encoderOut = linguisticOut['encoder_out'];
    const xMasks = linguisticOut['x_masks'];
    post('Encoding phonemes', 0.15);

    // ── 2. Duration predictor ──────────────────────────────────────────────
    post('Predicting durations', 0.20);
    const noteMidi = new ort.Tensor('float32', params.noteMidi, [1, params.noteMidi.length]);
    const noteDur = new ort.Tensor('int64', params.noteDur, [1, params.noteDur.length]);

    const durFeeds: Record<string, OrtTensor> = {
        encoder_out: encoderOut as unknown as OrtTensor,
        x_masks: xMasks as unknown as OrtTensor,
        note_midi: noteMidi,
        note_dur: noteDur,
    };
    if (params.speakerEmbed) {
        durFeeds['spk_embed'] = broadcastSpkEmbed(ort, params.speakerEmbed, nTokens);
    }

    const durOut = await sessions.dur.run(durFeeds);
    const phDur = durOut['ph_dur'];
    if (!phDur) {
        throw new Error('Duration predictor produced no ph_dur output');
    }
    post('Predicting durations', 0.30);

    // ── 3. Pitch predictor ─────────────────────────────────────────────────
    post('Predicting pitch', 0.35);
    const pitchPlaceholder = new ort.Tensor('float32', new Float32Array(params.durationFrames), [1, params.durationFrames]);
    // retake = all true → predict all tokens fresh (not retaining any previous pitch)
    const retakePitch = new ort.Tensor('bool', new Uint8Array(nTokens).fill(1), [1, nTokens]);
    const steps = new ort.Tensor('int64', BigInt64Array.from([BigInt(params.steps)]), [1]);

    const pitchFeeds: Record<string, OrtTensor> = {
        encoder_out: encoderOut as unknown as OrtTensor,
        ph_dur: phDur as unknown as OrtTensor,
        note_midi: noteMidi,
        note_dur: noteDur,
        pitch: pitchPlaceholder,
        retake: retakePitch,
        steps,
    };
    if (params.speakerEmbed) {
        pitchFeeds['spk_embed'] = broadcastSpkEmbed(ort, params.speakerEmbed, params.durationFrames);
    }

    const pitchOut = await sessions.pitch.run(pitchFeeds);
    const pitchPred = pitchOut['pitch_pred'];
    post('Predicting pitch', 0.50);

    // ── 4. Variance predictor ──────────────────────────────────────────────
    post('Predicting expression', 0.55);
    const retakeVariance = new ort.Tensor('bool', new Uint8Array(nTokens).fill(1), [1, nTokens]);
    const varianceFeeds: Record<string, OrtTensor> = {
        encoder_out: encoderOut as unknown as OrtTensor,
        x_masks: xMasks as unknown as OrtTensor,
        ph_dur: phDur as unknown as OrtTensor,
        pitch: pitchPred as unknown as OrtTensor,
        retake: retakeVariance,
        steps,
    };
    if (params.speakerEmbed) {
        varianceFeeds['spk_embed'] = broadcastSpkEmbed(ort, params.speakerEmbed, params.durationFrames);
    }

    const varianceOut = await sessions.variance.run(varianceFeeds);
    const energyPred = varianceOut['energy_pred'];
    const breathinessPred = varianceOut['breathiness_pred'];
    post('Predicting expression', 0.65);

    // ── 5. Acoustic model (shallow diffusion) ─────────────────────────────
    post('Rendering mel-spectrogram', 0.68);
    const depthTensor = new ort.Tensor('float32', new Float32Array([params.depth]), [1]);

    const acousticFeeds: Record<string, OrtTensor> = {
        tokens,
        durations: phDur as unknown as OrtTensor,
        f0: pitchPred as unknown as OrtTensor,
        depth: depthTensor,
        steps,
    };
    if (energyPred) {
        acousticFeeds['energy'] = energyPred as unknown as OrtTensor;
    }
    if (breathinessPred) {
        acousticFeeds['breathiness'] = breathinessPred as unknown as OrtTensor;
    }
    if (params.speakerEmbed) {
        acousticFeeds['spk_embed'] = broadcastSpkEmbed(ort, params.speakerEmbed, params.durationFrames);
    }

    // The acoustic model runs all diffusion steps internally via the `steps` tensor.
    const acousticOut = await sessions.acoustic.run(acousticFeeds);
    // Key may vary by ONNX export ('mel' is conventional, but some exports use other names)
    const mel = acousticOut['mel'] ?? Object.values(acousticOut)[0];
    if (!mel) {
        throw new Error('Acoustic model produced no mel-spectrogram output');
    }
    post('Rendering mel-spectrogram', 0.82);

    // ── 6. Vocoder ─────────────────────────────────────────────────────────
    post('Running vocoder', 0.87);
    const vocoderOut = await sessions.vocoder.run({
        mel: mel as unknown as OrtTensor,
        f0: pitchPred as unknown as OrtTensor,
    });
    const waveform = vocoderOut['waveform'];
    post('Running vocoder', 0.98);

    if (!waveform) {
        throw new Error('Vocoder produced no waveform output');
    }
    return new Float32Array(waveform.data as Float32Array);
}

// ── Kokoro TTS via onnxruntime-web ────────────────────────────────────────

const KOKORO_SESSION_ID = 'kokoro-82m-q8';

/**
 * Run Kokoro TTS inference using the pre-loaded ONNX session.
 * Inputs are prepared on the main thread (tokenization + voice embedding selection)
 * and transferred to this worker as typed arrays.
 *
 * Model inputs:
 *   input_ids  int64[1, seq_len]  — phoneme token IDs with 0-padding at both ends
 *   style      float32[1, 256]    — voice style embedding (indexed by token count)
 *   speed      float32[1]         — speed multiplier
 *
 * Output: float32 audio at 24 kHz.
 */
async function runKokoroOnnx(
    requestId: string,
    inputIds: BigInt64Array,
    style: Float32Array,
    speed: number
): Promise<Float32Array> {
    const ort = await getOrt();
    const session = sessionCache.get(KOKORO_SESSION_ID)?.session;
    if (!session) {
        throw new Error('Kokoro ONNX session not loaded — call create-session with modelId="kokoro-82m-q8" first');
    }

    const post = (stage: string, progress: number): void => {
        const msg: WorkerResponse = { type: 'inference-progress', requestId, stage, progress };
        self.postMessage(msg);
    };

    post('Synthesizing speech', 0.2);

    const seqLen = inputIds.length;
    const inputIdsTensor = new ort.Tensor('int64', inputIds, [1, seqLen]);
    const styleTensor = new ort.Tensor('float32', style, [1, 256]);
    const speedTensor = new ort.Tensor('float32', new Float32Array([speed]), [1]);

    const outputs = await session.run({
        input_ids: inputIdsTensor,
        style: styleTensor,
        speed: speedTensor,
    });

    post('Synthesizing speech', 0.95);

    // The model outputs a waveform tensor — key may vary by export
    const waveform = outputs['waveform'] ?? outputs['audio'] ?? Object.values(outputs)[0];
    if (!waveform) {
        throw new Error('Kokoro ONNX produced no output');
    }

    return new Float32Array(waveform.data as Float32Array);
}

// ── Message handler ────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> => {
    const req = event.data;

    if (req.type === 'create-session') {
        try {
            await getOrCreateSession(req.modelId, req.modelData);
            const response: WorkerResponse = { type: 'session-created', requestId: req.requestId, modelId: req.modelId };
            self.postMessage(response);
        } catch (error) {
            const response: WorkerResponse = { type: 'error', requestId: req.requestId, error: String(error) };
            self.postMessage(response);
        }
        return;
    }

    if (req.type === 'run-inference') {
        const entry = sessionCache.get(req.modelId);
        if (!entry) {
            const response: WorkerResponse = { type: 'error', requestId: req.requestId, error: `Session not found: ${req.modelId}` };
            self.postMessage(response);
            return;
        }
        try {
            const ort = await getOrt();
            entry.lastUsedAt = Date.now();
            const feeds: Record<string, OrtTensor> = {};
            for (const [key, td] of Object.entries(req.feeds)) {
                feeds[key] = tensorDataToOrt(ort, td);
            }
            const outputs = await entry.session.run(feeds);
            const resultOutputs: Record<string, TensorData> = {};
            for (const [key, val] of Object.entries(outputs)) {
                let dataType: TensorData['type'] = 'float32';
                if (val.data instanceof BigInt64Array) {
                    dataType = 'int64';
                } else if (val.data instanceof Int32Array) {
                    dataType = 'int32';
                } else if (val.data instanceof Uint8Array) {
                    dataType = 'bool';
                }
                resultOutputs[key] = { data: val.data as Float32Array, dims: val.dims, type: dataType };
            }
            const response: WorkerResponse = { type: 'inference-result', requestId: req.requestId, outputs: resultOutputs };
            self.postMessage(response);
        } catch (error) {
            const response: WorkerResponse = { type: 'error', requestId: req.requestId, error: String(error) };
            self.postMessage(response);
        }
        return;
    }

    if (req.type === 'release-session') {
        const entry = sessionCache.get(req.modelId);
        if (entry) {
            await entry.session.release();
            totalMemoryBytes -= entry.sizeBytes;
            sessionCache.delete(req.modelId);
        }
        return;
    }

    if (req.type === 'get-status') {
        const response: WorkerResponse = {
            type: 'status',
            loadedModels: Array.from(sessionCache.keys()),
            memoryUsageBytes: totalMemoryBytes,
        };
        self.postMessage(response);
        return;
    }

    if (req.type === 'run-kokoro-tts') {
        try {
            const progressMsg: WorkerResponse = {
                type: 'inference-progress',
                requestId: req.requestId,
                stage: 'Synthesizing speech',
                progress: 0.1,
            };
            self.postMessage(progressMsg);

            const audio = await runKokoroOnnx(req.requestId, req.inputIds, req.style, req.speed);
            const response: WorkerResponse = {
                type: 'tts-result',
                requestId: req.requestId,
                audio,
                // Kokoro ONNX outputs 24 kHz PCM
                samplingRate: 24000,
            };
            self.postMessage(response, [audio.buffer]);
        } catch (error) {
            const response: WorkerResponse = { type: 'error', requestId: req.requestId, error: String(error) };
            self.postMessage(response);
        }
        return;
    }

    if (req.type === 'run-diffsinger-phrase') {
        try {
            const progressMsg: WorkerResponse = { type: 'inference-progress', requestId: req.requestId, stage: 'Preparing sessions', progress: 0.02 };
            self.postMessage(progressMsg);

            // All sessions must have been pre-loaded via 'create-session' messages
            const linguisticKey = `${req.voicebankId}/linguistic`;
            const durKey = `${req.voicebankId}/dur`;
            const pitchKey = `${req.voicebankId}/pitch`;
            const varianceKey = `${req.voicebankId}/variance`;
            const acousticKey = `${req.voicebankId}/acoustic`;
            const vocoderKey = 'shared/vocoder';

            const sessions = {
                linguistic: sessionCache.get(linguisticKey)?.session,
                dur: sessionCache.get(durKey)?.session,
                pitch: sessionCache.get(pitchKey)?.session,
                variance: sessionCache.get(varianceKey)?.session,
                acoustic: sessionCache.get(acousticKey)?.session,
                vocoder: sessionCache.get(vocoderKey)?.session,
            };

            if (!sessions.linguistic || !sessions.dur || !sessions.pitch || !sessions.variance || !sessions.acoustic || !sessions.vocoder) {
                const missing = Object.entries(sessions).filter(([, s]) => !s).map(([k]) => k).join(', ');
                throw new Error(`DiffSinger sessions not loaded: ${missing}`);
            }

            const ort = await getOrt();
            const audio = await runDiffSingerPipeline(req.requestId, sessions as DiffSingerSessions, ort, req);

            const response: WorkerResponse = {
                type: 'diffsinger-result',
                requestId: req.requestId,
                audio,
            };
            self.postMessage(response, [audio.buffer]);
        } catch (error) {
            const response: WorkerResponse = { type: 'error', requestId: req.requestId, error: String(error) };
            self.postMessage(response);
        }
        return;
    }
};
