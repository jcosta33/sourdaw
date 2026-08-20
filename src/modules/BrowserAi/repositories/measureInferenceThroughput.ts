/**
 * Repository: measure real offline-render inference throughput.
 *
 * What this measures, and why this figure
 * ---------------------------------------
 * `capabilityDetector` used to grade a device from `navigator.gpu.requestAdapter()`
 * latency. Adapter acquisition is essentially constant and says nothing about
 * whether a model renders faster than real time, so the tier it produced could
 * not answer the question it was asked.
 *
 * Every inference path in this module is an offline render in a Worker
 * (`renderKokoroTts`, `renderDiffSingerPhrase`): a whole phrase in, a finished
 * waveform out, cached to OPFS. Nothing runs per audio block. So the figure that
 * would actually change a decision is **throughput against real time** —
 * `audioSeconds / elapsedSeconds`, the "realtime factor". A device at 2.0x
 * renders a 10 s phrase in 5 s; a device at 0.1x takes 100 s for the same
 * phrase, and that is a different product.
 *
 * The probe is the real Kokoro model
 * ----------------------------------
 * The measurement runs the admitted Kokoro ONNX graph through the same
 * `inferenceWorkerBridge` and the same execution-provider selection production
 * uses. A synthetic graph would need a calibration constant to become a realtime
 * factor, and that constant would be invented — the exact defect being fixed.
 * Kokoro is the one family in this module with a complete, working, end-to-end
 * browser path, so it is the honest probe.
 *
 * Two deliberate deviations from the production render path, both because they
 * change the number without changing the compute:
 *
 * 1. **The style vector is a fixed constant, not the CDN voice embedding.**
 *    `renderKokoroTts` fetches a ~500 KB voice file from HuggingFace. Network
 *    time is not inference time, and the graph's cost does not depend on the
 *    style values — only on their shape, which is pinned at 256 floats. Using a
 *    constant keeps the probe offline and deterministic.
 * 2. **Session creation is excluded from the timed window.** Loading 86 MB of
 *    weights is a once-per-session cost amortised across every subsequent
 *    render; folding it into a per-phrase throughput figure would understate
 *    steady-state throughput by an amount that depends on phrase length.
 *
 * When it cannot measure, it says so
 * ----------------------------------
 * No WebGPU, no cached model, no runtime, or an empty output all resolve to
 * `{ status: 'not-measured', reason }`. None of them produce a tier. This is the
 * three-state contract from `scripts/measureRenderDeadline.ts`: "I could not
 * measure" and "I measured something bad" are different claims and must not
 * share a representation.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';

import { type InferenceThroughput } from '../models/CapabilityReport';
import { KOKORO_MODEL_ARTIFACT } from '../models/KokoroArtifactManifest';
import { textToKokoroInputIds } from '../services/kokoroTokenizer';

import { inferenceWorkerBridge } from './inferenceWorkerBridge';
import { readVerifiedModel } from './readVerifiedModel';

const PROBE_MODEL_ID = KOKORO_MODEL_ARTIFACT.id;
const PROBE_MODEL_FAMILY = 'kokoro';

/** Kokoro ONNX emits 24 kHz PCM — see `onnxInferenceWorker.runKokoroOnnx`. */
const KOKORO_NATIVE_SAMPLE_RATE = 24000;

/** Kokoro's style input is `float32[1, 256]`. Only the shape matters to the cost. */
const KOKORO_STYLE_DIMENSIONS = 256;

/**
 * A fixed, non-degenerate style value. Zeros would also run, but a small
 * non-zero constant keeps the graph away from any input the exporter might have
 * special-cased, at no cost to determinism.
 */
const PROBE_STYLE_VALUE = 0.05;

/**
 * The probe phrase. Long enough that per-call overhead does not dominate the
 * ratio, short enough that a slow device is not punished with a long wait during
 * a settings-panel refresh. Fixed text means a fixed token count, so two runs on
 * the same machine are comparable.
 */
const PROBE_TEXT = 'the quick brown fox jumps over the lazy dog while the sun sets behind the hills';

function hasWebGpu(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

function buildProbeStyle(): Float32Array {
    return new Float32Array(KOKORO_STYLE_DIMENSIONS).fill(PROBE_STYLE_VALUE);
}

type MeasureInferenceThroughputOutput = Promise<InferenceThroughput>;

export const measureInferenceThroughput = inject({ logger, readVerifiedModel })(
    ({ logger, readVerifiedModel }) =>
        async function measureInferenceThroughput(): MeasureInferenceThroughputOutput {
            if (!MODEL_RELEASE_ADMISSION.kokoro) {
                return { status: 'not-measured', reason: 'not-requested' };
            }
            if (!hasWebGpu()) {
                return { status: 'not-measured', reason: 'no-webgpu' };
            }

            let modelData: ArrayBuffer | null;
            let executionProviders: string[];
            try {
                modelData = await readVerifiedModel({
                    family: PROBE_MODEL_FAMILY,
                    modelId: PROBE_MODEL_ID,
                    sha256: KOKORO_MODEL_ARTIFACT.sha256,
                    sizeBytes: KOKORO_MODEL_ARTIFACT.sizeBytes,
                });
            } catch (error) {
                logger.warn(`[BrowserAi] Throughput probe could not read the model: ${String(error)}`);
                return { status: 'not-measured', reason: 'model-not-cached' };
            }

            if (!modelData) {
                logger.info(
                    `[BrowserAi] Throughput not measured: ${PROBE_MODEL_ID} is not in OPFS. ` +
                        'Download it in AI Settings, then re-detect.'
                );
                return { status: 'not-measured', reason: 'model-not-cached' };
            }

            try {
                // Session creation is outside the timed window on purpose — see the
                // header. `loadOnnxSession` is idempotent; the worker caches by modelId.
                executionProviders = await inferenceWorkerBridge.loadOnnxSession({
                    modelId: PROBE_MODEL_ID,
                    modelData,
                });
                if (!executionProviders.includes('webgpu')) {
                    logger.warn('[BrowserAi] Throughput probe session did not use WebGPU.');
                    return { status: 'not-measured', reason: 'runtime-unavailable' };
                }
            } catch (error) {
                logger.warn(`[BrowserAi] Throughput probe could not create a session: ${String(error)}`);
                return { status: 'not-measured', reason: 'runtime-unavailable' };
            }

            const { inputIds } = textToKokoroInputIds(PROBE_TEXT);

            let audioLength: number;
            let elapsedMs: number;
            try {
                const startedAt = performance.now();
                const result = await inferenceWorkerBridge.runKokoroTts({
                    requestId: crypto.randomUUID(),
                    inputIds,
                    style: buildProbeStyle(),
                    speed: 1,
                });
                elapsedMs = performance.now() - startedAt;
                audioLength = result.audio.length;
            } catch (error) {
                logger.warn(`[BrowserAi] Throughput probe inference failed: ${String(error)}`);
                return { status: 'not-measured', reason: 'inference-failed' };
            }

            // A zero-length output or a zero-length window makes the ratio meaningless
            // rather than merely bad, so neither may be turned into a tier.
            if (audioLength === 0 || elapsedMs <= 0) {
                logger.warn(
                    `[BrowserAi] Throughput probe produced ${String(audioLength)} samples in ` +
                        `${elapsedMs.toFixed(3)} ms — no ratio can be formed.`
                );
                return { status: 'not-measured', reason: 'inference-failed' };
            }

            const audioSeconds = audioLength / KOKORO_NATIVE_SAMPLE_RATE;
            const elapsedSeconds = elapsedMs / 1000;
            const realtimeFactor = audioSeconds / elapsedSeconds;

            logger.info(
                `[BrowserAi] Inference throughput: ${realtimeFactor.toFixed(2)}x real time ` +
                    `(${audioSeconds.toFixed(2)} s of audio in ${elapsedSeconds.toFixed(2)} s)`
            );

            return {
                status: 'measured',
                modelId: PROBE_MODEL_ID,
                executionProviders,
                audioSeconds,
                elapsedSeconds,
                realtimeFactor,
            };
        }
);
