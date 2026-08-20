/**
 * Repository: Browser AI capability detection.
 *
 * Reports the platform facts (Chrome, WebGPU, SharedArrayBuffer, OPFS) and
 * classifies the device into a `WebGpuTier` from a measured inference
 * throughput figure.
 *
 * What the tier is derived from
 * -----------------------------
 * Until this file was fixed, `benchmarkMs` timed `navigator.gpu.requestAdapter()`
 * and the tier was a function of that. Adapter acquisition is essentially
 * constant and unrelated to whether a model renders faster than real time, so a
 * confident `webgpu-fast` could be returned on a device that cannot run a single
 * inference. That is a guard that cannot fail (ADR 0015): it reported
 * confidently and measured nothing relevant.
 *
 * The tier is now derived from `measureInferenceThroughput()` — a real Kokoro
 * ONNX render through the real worker — and from nothing else. When there is no
 * throughput figure the tier is `not-measured`, never a grade.
 *
 * Why the thresholds are where they are
 * -------------------------------------
 * Every inference path here is an offline render the user waits on, tagged
 * `tier: 'browser-preview'` in `RenderProvenance`. So the unit is throughput
 * against real time, and the boundaries are set by what a user will sit through
 * for a preview render of a phrase:
 *
 *   >= 1.0x  `webgpu-fast`  — a phrase renders in less time than it plays. The
 *                             browser path is the primary path.
 *   >= 0.2x  `webgpu-slow`  — usable, but a 10 s phrase costs up to 50 s. Offer
 *                             it; do not make it the default.
 *    < 0.2x  `unavailable`  — a 10 s phrase costs more than 50 s. Below any
 *                             reasonable patience for a scratch preview.
 *
 * Caching
 * -------
 * The report is stored in localStorage. That cache now holds a figure worth
 * reusing: a real throughput measurement costs a full model render, so it is not
 * repeated on every boot. Every detection re-reads the platform facts through
 * the lightweight worker probe; `forceRefresh` remains accepted for caller
 * compatibility. Passing `measureInference` is what re-runs the expensive part.
 * A cached *measured* throughput is carried forward when inference is not
 * requested so the tier does not silently regress to `not-measured`.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import {
    type BrowserAiCapability,
    type CapabilityReport,
    type InferenceThroughput,
    type ThroughputNotMeasuredReason,
    type WebGpuTier,
} from '../models/CapabilityReport';
import { type WebGpuProbeResult } from '../models/WebGpuProbe';

import { measureInferenceThroughput } from './measureInferenceThroughput';
import { probeWebGpuUsability } from './probeWebGpuUsability';

const STORAGE_KEY = 'sourdaw-browser-ai-capability';

/** At or above this many seconds of audio per second of wall clock: `webgpu-fast`. */
const FAST_REALTIME_FACTOR = 1;
/** At or above this, but below fast: `webgpu-slow`. Below it: `unavailable`. */
const USABLE_REALTIME_FACTOR = 0.2;

/**
 * Detect Chrome version from user agent.
 * Returns null if not Chrome-based.
 */
function detectChromeVersion(): number | null {
    if (typeof navigator === 'undefined') {
        return null;
    }
    // Chrome (and Chromium-based): look for "Chrome/" in UA
    const match = navigator.userAgent.match(/Chrome\/(\d+)/);
    if (!match) {
        return null;
    }
    // Exclude Edge and Opera which also have "Chrome/" in their UA
    if (navigator.userAgent.includes('Edg/') || navigator.userAgent.includes('OPR/')) {
        return null;
    }
    return parseInt(match[1]!, 10);
}

/**
 * The only place a `WebGpuTier` is produced. A throughput that was not measured
 * yields `not-measured` — never a grade inferred from something else.
 */
function classifyWebGpuTier(inference: InferenceThroughput): WebGpuTier {
    if (inference.status !== 'measured') {
        return 'not-measured';
    }
    if (inference.realtimeFactor >= FAST_REALTIME_FACTOR) {
        return 'webgpu-fast';
    }
    if (inference.realtimeFactor >= USABLE_REALTIME_FACTOR) {
        return 'webgpu-slow';
    }
    return 'unavailable';
}

type UnknownRecord = {
    [key: string]: unknown;
};

function get_capability_storage(): Storage | null {
    if (!('localStorage' in globalThis)) {
        return null;
    }
    try {
        return globalThis.localStorage;
    } catch {
        return null;
    }
}

function is_plain_record(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A cached report naming a capability this build cannot produce fails
 * validation, so `read_cached_report` discards it and the platform facts are
 * re-detected. That is what retires the old `'unsupported-platform'` verdict
 * from the localStorage of anyone who ran a build that could still emit it.
 */
function is_browser_ai_capability(value: unknown): value is BrowserAiCapability {
    return value === 'supported' || value === 'unsupported-browser';
}

function is_web_gpu_tier(value: unknown): value is WebGpuTier {
    return value === 'webgpu-fast' || value === 'webgpu-slow' || value === 'unavailable' || value === 'not-measured';
}

function is_not_measured_reason(value: unknown): value is ThroughputNotMeasuredReason {
    return (
        value === 'not-requested' ||
        value === 'no-webgpu' ||
        value === 'model-not-cached' ||
        value === 'runtime-unavailable' ||
        value === 'inference-failed'
    );
}

function is_finite_number(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function is_string_array(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function is_inference_throughput(value: unknown): value is InferenceThroughput {
    if (!is_plain_record(value)) {
        return false;
    }
    if (value.status === 'not-measured') {
        return is_not_measured_reason(value.reason);
    }
    if (value.status !== 'measured') {
        return false;
    }
    return (
        typeof value.modelId === 'string' &&
        is_string_array(value.executionProviders) &&
        is_finite_number(value.audioSeconds) &&
        is_finite_number(value.elapsedSeconds) &&
        is_finite_number(value.realtimeFactor)
    );
}

function is_web_gpu_probe_result(value: unknown): value is WebGpuProbeResult {
    if (!is_plain_record(value)) {
        return false;
    }
    if (value.status === 'supported') {
        return true;
    }
    return (
        value.status === 'unavailable' &&
        (value.reason === 'missing-surface' ||
            value.reason === 'adapter-unavailable' ||
            value.reason === 'fallback-adapter' ||
            value.reason === 'device-unavailable' ||
            value.reason === 'probe-failed')
    );
}

function is_capability_admission_pair(value: UnknownRecord): boolean {
    if (!is_browser_ai_capability(value.capability) || !is_web_gpu_probe_result(value.webGpu)) {
        return false;
    }
    return value.capability !== 'supported' || value.webGpu.status === 'supported';
}

function is_nullable_finite_number(value: unknown): value is number | null {
    if (value === null) {
        return true;
    }
    return is_finite_number(value);
}

function is_valid_capability_report(value: unknown): value is CapabilityReport {
    if (!is_plain_record(value)) {
        return false;
    }
    return (
        is_capability_admission_pair(value) &&
        is_web_gpu_tier(value.webGpuTier) &&
        typeof value.sharedArrayBuffer === 'boolean' &&
        typeof value.opfsAvailable === 'boolean' &&
        typeof value.detectedAt === 'number' &&
        Number.isFinite(value.detectedAt) &&
        is_nullable_finite_number(value.chromeVersion) &&
        is_inference_throughput(value.inference)
    );
}

/** A bridge failure is truthful for its run but cannot stand in for a later hardware probe. */
function is_reusable_cached_report(value: unknown): value is CapabilityReport {
    if (!is_valid_capability_report(value)) {
        return false;
    }
    return value.webGpu.status !== 'unavailable' || value.webGpu.reason !== 'probe-failed';
}

function read_cached_report(storage: Storage | null): CapabilityReport | null {
    if (!storage) {
        return null;
    }
    const cached = storage.getItem(STORAGE_KEY);
    if (!cached) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(cached);
        if (is_reusable_cached_report(parsed)) {
            return parsed;
        }
    } catch {
        // Corrupt cache — re-detect
    }
    return null;
}

type DetectCapabilitiesInput = {
    /** Retained for caller compatibility; the lightweight platform probe always runs. */
    forceRefresh?: boolean;
    /**
     * Run the real throughput measurement. Off by default: it renders a full
     * Kokoro phrase, which is far too expensive for app startup. `initBrowserAi`
     * leaves it off and accepts a `not-requested` throughput; the AI settings
     * panel turns it on.
     */
    measureInference?: boolean;
};

type DetectCapabilitiesOutput = Promise<CapabilityReport>;

export const detectCapabilities = inject({ logger, measureInferenceThroughput, probeWebGpuUsability })(
    ({ logger, measureInferenceThroughput, probeWebGpuUsability }) =>
        async function detectCapabilities({
            measureInference = false,
        }: DetectCapabilitiesInput = {}): DetectCapabilitiesOutput {
            const storage = get_capability_storage();
            const cachedReport = read_cached_report(storage);

            const chromeVersion = detectChromeVersion();
            let webGpu: WebGpuProbeResult;
            try {
                webGpu = await probeWebGpuUsability();
            } catch {
                webGpu = { status: 'unavailable', reason: 'probe-failed' };
                logger.warn('[BrowserAi] WebGPU usability probe failed — browser AI disabled');
            }
            const sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
            const opfsAvailable =
                typeof navigator !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage;

            let capability: BrowserAiCapability;
            let inference: InferenceThroughput = { status: 'not-measured', reason: 'not-requested' };

            if (!chromeVersion) {
                capability = 'unsupported-browser';
                logger.info('[BrowserAi] Non-Chrome browser detected — browser AI disabled');
            } else if (webGpu.status === 'unavailable') {
                capability = 'unsupported-browser';
                inference = { status: 'not-measured', reason: 'no-webgpu' };
                logger.info(`[BrowserAi] WebGPU ${webGpu.reason} — browser AI disabled`);
            } else if (measureInference) {
                capability = 'supported';
                inference = await measureInferenceThroughput();
            } else {
                capability = 'supported';
                // Carry a real measurement forward rather than downgrading the tier
                // on a platform-only refresh. Only a `measured` figure is reusable —
                // a stale `not-measured` reason would be a claim about a probe this
                // run never performed.
                if (cachedReport && cachedReport.inference.status === 'measured') {
                    inference = cachedReport.inference;
                }
            }

            const webGpuTier = classifyWebGpuTier(inference);

            const report: CapabilityReport = {
                capability,
                webGpu,
                webGpuTier,
                sharedArrayBuffer,
                opfsAvailable,
                chromeVersion,
                inference,
                detectedAt: Date.now(),
            };

            logger.info(`[BrowserAi] Capability ${capability}, WebGPU tier ${webGpuTier}`);

            // Cache the result
            if (storage) {
                try {
                    storage.setItem(STORAGE_KEY, JSON.stringify(report));
                } catch {
                    // Storage quota exceeded — not critical
                }
            }

            return report;
        }
);
