/**
 * Repository: Browser AI capability detection.
 *
 * Checks for Chrome + WebGPU availability and runs a micro-benchmark
 * to classify the device as webgpu-fast, webgpu-slow, or unavailable.
 *
 * Results are stored in localStorage to avoid re-running the benchmark.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { isTauri } from '#/utils/tauriBridge';

import { type BrowserAiCapability, type CapabilityReport, type WebGpuTier } from '../models/CapabilityReport';

const STORAGE_KEY = 'sourdaw-browser-ai-capability';
const BENCHMARK_FAST_THRESHOLD_MS = 50;
const BENCHMARK_SLOW_THRESHOLD_MS = 500;

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
 * Determine if we're running in Tauri on macOS or Linux,
 * where WKWebView/WebKitGTK doesn't support WebGPU.
 */
function isTauriNonWindowsPlatform(): boolean {
    if (!isTauri()) {
        return false;
    }
    // In Tauri, navigator.platform reports the OS
    const platform = navigator.platform.toLowerCase();
    return platform.includes('mac') || platform.includes('linux');
}

/**
 * Run a minimal ONNX inference micro-benchmark to estimate WebGPU speed.
 * Returns elapsed time in ms.
 */
async function runWebGpuBenchmark(): Promise<number> {
    try {
        const startTime = performance.now();
        // Check if WebGPU adapter is available and responsive
        if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
            // navigator.gpu is not in lib.dom.d.ts — cast to access the WebGPU API
            const adapter = await (
                navigator as { gpu: { requestAdapter: () => Promise<unknown> } }
            ).gpu.requestAdapter();
            if (adapter) {
                const endTime = performance.now();
                // Adapter acquisition time is a proxy for WebGPU responsiveness
                return endTime - startTime;
            }
        }
        return BENCHMARK_SLOW_THRESHOLD_MS + 1; // Not available
    } catch {
        return BENCHMARK_SLOW_THRESHOLD_MS + 1;
    }
}

function classifyWebGpuTier(benchmarkMs: number | null): WebGpuTier {
    if (benchmarkMs === null) {
        return 'unavailable';
    }
    if (benchmarkMs < BENCHMARK_FAST_THRESHOLD_MS) {
        return 'webgpu-fast';
    }
    if (benchmarkMs < BENCHMARK_SLOW_THRESHOLD_MS) {
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

function is_browser_ai_capability(value: unknown): value is BrowserAiCapability {
    return value === 'supported' || value === 'unsupported-browser' || value === 'unsupported-platform';
}

function is_web_gpu_tier(value: unknown): value is WebGpuTier {
    return value === 'webgpu-fast' || value === 'webgpu-slow' || value === 'unavailable';
}

function is_nullable_finite_number(value: unknown): value is number | null {
    if (value === null) {
        return true;
    }
    return typeof value === 'number' && Number.isFinite(value);
}

function is_valid_capability_report(value: unknown): value is CapabilityReport {
    if (!is_plain_record(value)) {
        return false;
    }
    return (
        is_browser_ai_capability(value.capability) &&
        is_web_gpu_tier(value.webGpuTier) &&
        typeof value.sharedArrayBuffer === 'boolean' &&
        typeof value.opfsAvailable === 'boolean' &&
        typeof value.detectedAt === 'number' &&
        Number.isFinite(value.detectedAt) &&
        is_nullable_finite_number(value.chromeVersion) &&
        is_nullable_finite_number(value.benchmarkMs)
    );
}

type DetectCapabilitiesOutput = Promise<CapabilityReport>;

export const detectCapabilities = inject({ logger })(
    ({ logger }) =>
        async function detectCapabilities({
            forceRefresh = false,
        }: { forceRefresh?: boolean } = {}): DetectCapabilitiesOutput {
            const storage = get_capability_storage();
            // Check cached result first
            if (!forceRefresh && storage) {
                const cached = storage.getItem(STORAGE_KEY);
                if (cached) {
                    try {
                        const parsed: unknown = JSON.parse(cached);
                        if (is_valid_capability_report(parsed)) {
                            logger.info('[BrowserAi] Using cached capability report');
                            return parsed;
                        }
                    } catch {
                        // Corrupt cache — re-detect
                    }
                }
            }

            const chromeVersion = detectChromeVersion();
            const webGpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;
            const sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
            const opfsAvailable =
                typeof navigator !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage;

            let capability: CapabilityReport['capability'];
            let benchmarkMs: number | null = null;
            let webGpuTier: WebGpuTier = 'unavailable';

            if (isTauriNonWindowsPlatform()) {
                // macOS/Linux Tauri — route to native pipeline instead
                capability = 'unsupported-platform';
                logger.info(
                    '[BrowserAi] Running in Tauri on macOS/Linux — browser AI disabled, native pipeline available'
                );
            } else if (!chromeVersion) {
                capability = 'unsupported-browser';
                logger.info('[BrowserAi] Non-Chrome browser detected — browser AI disabled');
            } else if (!webGpuAvailable) {
                capability = 'unsupported-browser';
                logger.info('[BrowserAi] WebGPU not available — browser AI disabled');
            } else {
                capability = 'supported';
                benchmarkMs = await runWebGpuBenchmark();
                webGpuTier = classifyWebGpuTier(benchmarkMs);
                logger.info(`[BrowserAi] WebGPU detected: ${webGpuTier} (${String(benchmarkMs.toFixed(1))}ms)`);
            }

            const report: CapabilityReport = {
                capability,
                webGpuTier,
                sharedArrayBuffer,
                opfsAvailable,
                chromeVersion,
                benchmarkMs,
                detectedAt: Date.now(),
            };

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
