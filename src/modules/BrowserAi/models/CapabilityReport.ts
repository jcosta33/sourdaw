/**
 * Browser capability report for AI features.
 *
 * Produced by capability detection on feature first use.
 * Stored in localStorage so a real inference measurement is not repeated on
 * every boot.
 *
 * What the tier is derived from, and why
 * --------------------------------------
 * Every inference path in this module is an **offline render in a Worker** —
 * `renderKokoroTts` and `renderDiffSingerPhrase` both post a whole phrase to
 * `onnxInferenceWorker`, wait for the finished waveform, and write it to the
 * OPFS render cache. Nothing here runs per audio block and nothing here runs on
 * the audio thread, so the render-quantum budget (2.667 ms for 128 frames at
 * 48 kHz) is the wrong yardstick. The figure that decides whether these models
 * are usable is **throughput against real time**: how many seconds of audio a
 * render produces per second of wall clock.
 *
 * That is what `InferenceThroughput` carries, and it is the only thing
 * `WebGpuTier` is allowed to be derived from.
 */

/**
 * `not-measured` is a first-class outcome, not a failure. A report that admits
 * it could not measure is worth more than a confident wrong one — the same
 * three-state contract `scripts/measureRenderDeadline.ts` uses.
 */
export type WebGpuTier = 'webgpu-fast' | 'webgpu-slow' | 'unavailable' | 'not-measured';

export type BrowserAiCapability = 'supported' | 'unsupported-browser' | 'unsupported-platform';

/** Why a throughput figure is absent. Each value names a distinct, actionable cause. */
export type ThroughputNotMeasuredReason =
    /** Measurement was not requested — the caller wanted platform facts only (e.g. app startup). */
    | 'not-requested'
    /** No WebGPU on this target, so there is no inference path to time. */
    | 'no-webgpu'
    /** The probe model is not in OPFS yet. Download it, then re-measure. */
    | 'model-not-cached'
    /** onnxruntime-web failed to load, or session creation threw. */
    | 'runtime-unavailable'
    /** The session ran but produced no audio, so no throughput could be computed. */
    | 'inference-failed';

export type InferenceThroughput =
    | {
          status: 'measured';
          /** The model whose real weights produced this figure. */
          modelId: string;
          /** Execution providers requested, in preference order, for this run. */
          executionProviders: string[];
          /** Seconds of audio the run produced. */
          audioSeconds: number;
          /** Wall-clock seconds the inference call took. Excludes session creation. */
          elapsedSeconds: number;
          /**
           * `audioSeconds / elapsedSeconds`. Above 1 means a phrase renders in
           * less time than it takes to play.
           */
          realtimeFactor: number;
      }
    | { status: 'not-measured'; reason: ThroughputNotMeasuredReason };

export type CapabilityReport = {
    /** Whether the browser supports browser AI features */
    capability: BrowserAiCapability;
    webGpuTier: WebGpuTier;
    /** Whether SharedArrayBuffer is available (required for multi-threaded WASM) */
    sharedArrayBuffer: boolean;
    /** Whether OPFS is available for model storage */
    opfsAvailable: boolean;
    /** Chrome major version, null if not Chrome */
    chromeVersion: number | null;
    /** Measured offline-render throughput, or the reason there is no figure. */
    inference: InferenceThroughput;
    detectedAt: number;
};
