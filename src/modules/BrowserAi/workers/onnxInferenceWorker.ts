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

import { KOKORO_MODEL_ARTIFACT } from '../models/KokoroArtifactManifest';
import { type ModelStorageTransferMessage } from '../models/ModelStorageWorkerProtocol';

import type { OnnxExecutionProvider, WorkerRequest, WorkerResponse, TensorData } from '../models/InferenceRequest';

// ── Types ──────────────────────────────────────────────────────────────────

type OrtInferenceSession = {
    run: (feeds: Record<string, OrtTensor>) => Promise<Record<string, OrtTensor>>;
    release: () => Promise<void>;
};

type OrtTensor = {
    data: Float32Array | BigInt64Array | Int32Array | Uint8Array;
    dims: number[];
    /**
     * Releases the tensor's backing memory (GPU buffer or WASM heap allocation).
     * Present on every onnxruntime-web Tensor; optional here because tensors we
     * construct via `new ort.Tensor(...)` and those returned from `session.run()`
     * are the same runtime type, and disposal is a best-effort cleanup.
     */
    dispose?: () => void;
};

type OrtModule = {
    InferenceSession: {
        create: (data: ArrayBuffer, options?: { executionProviders?: string[] }) => Promise<OrtInferenceSession>;
    };
    Tensor: new (
        type: string,
        data: ArrayBuffer | Float32Array | BigInt64Array | Int32Array | Uint8Array,
        dims: number[]
    ) => OrtTensor;
    env: { wasm: { numThreads: number }; logLevel: string };
};

type SessionEntry = {
    session: OrtInferenceSession;
    modelId: string;
    executionProviders: OnnxExecutionProvider[];
    sizeBytes: number;
    lastUsedAt: number;
};

// ── Session manager ────────────────────────────────────────────────────────

const SESSION_MEMORY_BUDGET = 1024 * 1024 * 1024; // 1 GB

const sessionCache: Map<string, SessionEntry> = new Map();
let totalMemoryBytes = 0;
// Cache the in-flight import PROMISE (not just the resolved module): self.onmessage
// async chains interleave at every await, so two concurrent first messages could
// otherwise both pass the `if (ortModule)` guard, double-import onnxruntime-web, and
// configure ort.env twice. Coalescing on the promise makes the import-and-configure
// happen exactly once.
let ortPromise: Promise<OrtModule> | null = null;

async function loadAndConfigureOrt(): Promise<OrtModule> {
    // Dynamic import keeps onnxruntime-web out of the main bundle
    // eslint-disable-next-line sourdaw/no-type-assertion-escape -- onnxruntime-web module shape diverges from OrtModule structural subset; double cast required
    const ort = (await import('onnxruntime-web')) as unknown as OrtModule;
    // Multi-threaded WASM requires SharedArrayBuffer which is only available
    // when crossOriginIsolated is true. IIFE workers (forced by Rolldown)
    // are not cross-origin isolated, so fall back to single-threaded.
    ort.env.wasm.numThreads =
        typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated ? (navigator.hardwareConcurrency ?? 4) : 1;
    // Suppress "Some nodes were not assigned to the preferred execution providers"
    // warnings — these are informational (ORT moves shape ops to CPU intentionally).
    ort.env.logLevel = 'error';
    return ort;
}

function getOrt(): Promise<OrtModule> {
    // Reset the cache on failure so a later message can retry the import — without
    // this, one transient import error would poison every subsequent inference.
    ortPromise ??= loadAndConfigureOrt().catch((error: unknown) => {
        ortPromise = null;
        throw error;
    });
    return ortPromise;
}

function selectExecutionProviders(): OnnxExecutionProvider[] {
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
        return ['webgpu', 'wasm'];
    }
    // Safety net — feature should have been disabled at the UI level
    console.warn('[OnnxWorker] WebGPU unavailable — falling back to WASM only');
    return ['wasm'];
}

async function createSessionWithProviderTruth(
    ort: OrtModule,
    modelData: ArrayBuffer
): Promise<Pick<SessionEntry, 'session' | 'executionProviders'>> {
    const candidates = selectExecutionProviders();
    let lastError: unknown;

    // ONNX Runtime filters unavailable providers from a multi-provider request
    // internally, but its public session object does not expose the filtered list.
    // Request one provider at a time so a successful create is decisive evidence
    // for the provider identity reported across the worker boundary.
    for (const provider of candidates) {
        try {
            const session = await ort.InferenceSession.create(modelData, { executionProviders: [provider] });
            return { session, executionProviders: [provider] };
        } catch (error) {
            lastError = error;
            console.warn(`[OnnxWorker] ${provider} session creation failed: ${String(error)}`);
        }
    }

    throw new Error(`No ONNX execution provider could create the session: ${String(lastError)}`);
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
        // Remove from the cache and adjust accounting BEFORE awaiting release():
        // a concurrent getOrCreateSession touching this modelId during the await
        // must not find (and hand back) a session that is being released.
        sessionCache.delete(id);
        totalMemoryBytes -= entry.sizeBytes;
        await entry.session.release();
    }
}

async function getOrCreateSession(modelId: string, modelData: ArrayBuffer): Promise<SessionEntry> {
    const cached = sessionCache.get(modelId);
    if (cached) {
        cached.lastUsedAt = Date.now();
        return cached;
    }

    const ort = await getOrt();
    // Capture the model weight BEFORE create(): onnxruntime-web may consume or
    // detach the ArrayBuffer during session creation, after which byteLength reads
    // 0. Reading it afterwards would leave totalMemoryBytes near 0 and evictLru
    // would never fire, defeating the 1 GB budget.
    const sizeBytes = modelData.byteLength;
    const { session, executionProviders } = await createSessionWithProviderTruth(ort, modelData);

    const entry: SessionEntry = {
        session,
        modelId,
        executionProviders,
        sizeBytes,
        lastUsedAt: Date.now(),
    };
    sessionCache.set(modelId, entry);
    totalMemoryBytes += sizeBytes;

    await evictLru();
    return entry;
}

function receiveModelData(port: MessagePort): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        port.onmessage = (event: MessageEvent<ModelStorageTransferMessage>) => {
            port.close();
            const message = event.data;
            if (message.type === 'model-data') {
                resolve(message.modelData);
                return;
            }
            reject(new Error(`${message.name}: ${message.message}`));
        };
        port.onmessageerror = () => {
            port.close();
            reject(new Error('Model storage worker returned unreadable model data'));
        };
        port.start();
    });
}

// ── Tensor helpers ─────────────────────────────────────────────────────────

function tensorDataToOrt(ort: OrtModule, td: TensorData): OrtTensor {
    const type = (() => {
        if (td.type === 'int64') {
            return 'int64';
        } else {
            if (td.type === 'int32') {
                return 'int32';
            } else {
                if (td.type === 'bool') {
                    return 'bool';
                } else {
                    return 'float32';
                }
            }
        }
    })();
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
    for (let freq = 0; freq < nFrames; freq++) {
        tiled.set(embed, freq * 256);
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

    // Every tensor we construct or receive from session.run() owns a GPU/WASM
    // allocation. Track them all and dispose in the finally so no stage's
    // intermediate outputs leak across renders. The returned waveform is copied
    // into a fresh Float32Array before disposal, so disposing it here is safe.
    const tracked = new Set<OrtTensor>();
    const track = <TTensor extends OrtTensor>(t: TTensor): TTensor => {
        tracked.add(t);
        return t;
    };
    const trackOutputs = (outputs: Record<string, OrtTensor>): Record<string, OrtTensor> => {
        for (const t of Object.values(outputs)) {
            tracked.add(t);
        }
        return outputs;
    };

    try {
        // ── 1. Linguistic encoder ──────────────────────────────────────────────
        post('Encoding phonemes', 0.05);
        const nTokens = params.tokenIds.length;
        const nWords = params.wordDiv.length;

        const tokens = track(new ort.Tensor('int64', BigInt64Array.from(params.tokenIds.map(BigInt)), [1, nTokens]));
        const wordDiv = track(new ort.Tensor('int64', BigInt64Array.from(params.wordDiv.map(BigInt)), [1, nWords]));
        const wordDur = track(new ort.Tensor('int64', BigInt64Array.from(params.wordDur.map(BigInt)), [1, nWords]));

        const linguisticOut = trackOutputs(
            await sessions.linguistic.run({ tokens, word_div: wordDiv, word_dur: wordDur })
        );
        const encoderOut = linguisticOut.encoder_out;
        if (!encoderOut) {
            throw new Error('Linguistic encoder produced no encoder_out output');
        }
        const xMasks = linguisticOut.x_masks;
        if (!xMasks) {
            throw new Error('Linguistic encoder produced no x_masks output');
        }
        post('Encoding phonemes', 0.15);

        // ── 2. Duration predictor ──────────────────────────────────────────────
        post('Predicting durations', 0.2);
        const noteMidi = track(new ort.Tensor('float32', params.noteMidi, [1, params.noteMidi.length]));
        const noteDur = track(new ort.Tensor('int64', params.noteDur, [1, params.noteDur.length]));

        const durFeeds: Record<string, OrtTensor> = {
            encoder_out: encoderOut,
            x_masks: xMasks,
            note_midi: noteMidi,
            note_dur: noteDur,
        };
        if (params.speakerEmbed) {
            durFeeds.spk_embed = track(broadcastSpkEmbed(ort, params.speakerEmbed, nTokens));
        }

        const durOut = trackOutputs(await sessions.dur.run(durFeeds));
        const phDur = durOut.ph_dur;
        if (!phDur) {
            throw new Error('Duration predictor produced no ph_dur output');
        }
        post('Predicting durations', 0.3);

        // ── 3. Pitch predictor ─────────────────────────────────────────────────
        post('Predicting pitch', 0.35);
        const pitchPlaceholder = track(
            new ort.Tensor('float32', new Float32Array(params.durationFrames), [1, params.durationFrames])
        );
        // retake = all true → predict all tokens fresh (not retaining any previous pitch)
        const retakePitch = track(new ort.Tensor('bool', new Uint8Array(nTokens).fill(1), [1, nTokens]));
        const steps = track(new ort.Tensor('int64', BigInt64Array.from([BigInt(params.steps)]), [1]));

        const pitchFeeds: Record<string, OrtTensor> = {
            encoder_out: encoderOut,
            ph_dur: phDur,
            note_midi: noteMidi,
            note_dur: noteDur,
            pitch: pitchPlaceholder,
            retake: retakePitch,
            steps,
        };
        if (params.speakerEmbed) {
            pitchFeeds.spk_embed = track(broadcastSpkEmbed(ort, params.speakerEmbed, params.durationFrames));
        }

        const pitchOut = trackOutputs(await sessions.pitch.run(pitchFeeds));
        const pitchPred = pitchOut.pitch_pred;
        if (!pitchPred) {
            throw new Error('Pitch predictor produced no pitch_pred output');
        }
        post('Predicting pitch', 0.5);

        // ── 4. Variance predictor ──────────────────────────────────────────────
        post('Predicting expression', 0.55);
        const retakeVariance = track(new ort.Tensor('bool', new Uint8Array(nTokens).fill(1), [1, nTokens]));
        const varianceFeeds: Record<string, OrtTensor> = {
            encoder_out: encoderOut,
            x_masks: xMasks,
            ph_dur: phDur,
            pitch: pitchPred,
            retake: retakeVariance,
            steps,
        };
        if (params.speakerEmbed) {
            varianceFeeds.spk_embed = track(broadcastSpkEmbed(ort, params.speakerEmbed, params.durationFrames));
        }

        const varianceOut = trackOutputs(await sessions.variance.run(varianceFeeds));
        const energyPred = varianceOut.energy_pred;
        const breathinessPred = varianceOut.breathiness_pred;
        post('Predicting expression', 0.65);

        // ── 5. Acoustic model (shallow diffusion) ─────────────────────────────
        post('Rendering mel-spectrogram', 0.68);
        const depthTensor = track(new ort.Tensor('float32', new Float32Array([params.depth]), [1]));

        const acousticFeeds: Record<string, OrtTensor> = {
            tokens,
            durations: phDur,
            f0: pitchPred,
            depth: depthTensor,
            steps,
        };
        if (energyPred) {
            acousticFeeds.energy = energyPred;
        }
        if (breathinessPred) {
            acousticFeeds.breathiness = breathinessPred;
        }
        if (params.speakerEmbed) {
            acousticFeeds.spk_embed = track(broadcastSpkEmbed(ort, params.speakerEmbed, params.durationFrames));
        }

        // The acoustic model runs all diffusion steps internally via the `steps` tensor.
        const acousticOut = trackOutputs(await sessions.acoustic.run(acousticFeeds));
        // Key may vary by ONNX export ('mel' is conventional, but some exports use other names)
        const mel = acousticOut.mel ?? Object.values(acousticOut)[0];
        if (!mel) {
            throw new Error('Acoustic model produced no mel-spectrogram output');
        }
        post('Rendering mel-spectrogram', 0.82);

        // ── 6. Vocoder ─────────────────────────────────────────────────────────
        post('Running vocoder', 0.87);
        const vocoderOut = trackOutputs(
            await sessions.vocoder.run({
                mel,
                f0: pitchPred,
            })
        );
        const waveform = vocoderOut.waveform;
        post('Running vocoder', 0.98);

        if (!waveform) {
            throw new Error('Vocoder produced no waveform output');
        }
        return new Float32Array(waveform.data as Float32Array);
    } finally {
        for (const t of tracked) {
            t.dispose?.();
        }
    }
}

// ── Kokoro TTS via onnxruntime-web ────────────────────────────────────────

const KOKORO_SESSION_ID = KOKORO_MODEL_ARTIFACT.id;

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
        throw new Error(`Kokoro ONNX session not loaded: ${KOKORO_SESSION_ID}`);
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

    // Track input + output tensors and dispose them after copying the audio out,
    // so each Kokoro inference does not leak its GPU/WASM tensor allocations.
    const tracked = new Set<OrtTensor>([inputIdsTensor, styleTensor, speedTensor]);
    try {
        const outputs = await session.run({
            input_ids: inputIdsTensor,
            style: styleTensor,
            speed: speedTensor,
        });
        for (const t of Object.values(outputs)) {
            tracked.add(t);
        }

        post('Synthesizing speech', 0.95);

        // The model outputs a waveform tensor — key may vary by export
        const waveform = outputs.waveform ?? outputs.audio ?? Object.values(outputs)[0];
        if (!waveform) {
            throw new Error('Kokoro ONNX produced no output');
        }

        return new Float32Array(waveform.data as Float32Array);
    } finally {
        for (const t of tracked) {
            t.dispose?.();
        }
    }
}

// ── Message handler ────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> => {
    const req = event.data;

    if (req.type === 'create-session') {
        try {
            const entry = await getOrCreateSession(req.modelId, req.modelData);
            const response: WorkerResponse = {
                type: 'session-created',
                requestId: req.requestId,
                modelId: req.modelId,
                executionProviders: entry.executionProviders,
            };
            self.postMessage(response);
        } catch (error) {
            const response: WorkerResponse = { type: 'error', requestId: req.requestId, error: String(error) };
            self.postMessage(response);
        }
        return;
    }

    if (req.type === 'create-session-from-model-port') {
        try {
            const modelData = await receiveModelData(req.modelDataPort);
            const entry = await getOrCreateSession(req.modelId, modelData);
            const response: WorkerResponse = {
                type: 'session-created',
                requestId: req.requestId,
                modelId: req.modelId,
                executionProviders: entry.executionProviders,
            };
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
            const response: WorkerResponse = {
                type: 'error',
                requestId: req.requestId,
                error: `Session not found: ${req.modelId}`,
            };
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
                resultOutputs[key] = { data: val.data, dims: val.dims, type: dataType };
            }
            const response: WorkerResponse = {
                type: 'inference-result',
                requestId: req.requestId,
                outputs: resultOutputs,
            };
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
            // Delete from the cache and adjust accounting BEFORE awaiting release(),
            // so a concurrent getOrCreateSession cannot return the released session.
            sessionCache.delete(req.modelId);
            totalMemoryBytes -= entry.sizeBytes;
            await entry.session.release();
        }
        return;
    }

    if (req.type === 'get-status') {
        // Answer from the LIVE sessionCache — never a stale snapshot. Callers that
        // skip re-loading a session rely on this reflecting LRU eviction.
        const response: WorkerResponse = {
            type: 'status',
            requestId: req.requestId,
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
            const progressMsg: WorkerResponse = {
                type: 'inference-progress',
                requestId: req.requestId,
                stage: 'Preparing sessions',
                progress: 0.02,
            };
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

            if (
                !sessions.linguistic ||
                !sessions.dur ||
                !sessions.pitch ||
                !sessions.variance ||
                !sessions.acoustic ||
                !sessions.vocoder
            ) {
                const missing = Object.entries(sessions)
                    .filter(([, state]) => !state)
                    .map(([kIndex]) => kIndex)
                    .join(', ');
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
