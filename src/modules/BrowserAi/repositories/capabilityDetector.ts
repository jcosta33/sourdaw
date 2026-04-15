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
import { type CapabilityReport, type WebGpuTier } from '../models/CapabilityReport';

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
    const platform = navigator.platform?.toLowerCase() ?? '';
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
            const adapter = await (navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } }).gpu.requestAdapter();
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

type DetectCapabilitiesOutput = Promise<CapabilityReport>;

export const detectCapabilities = inject({ logger })(
    ({ logger }) =>
        async function detectCapabilities({ forceRefresh = false }: { forceRefresh?: boolean } = {}): DetectCapabilitiesOutput {
            // Check cached result first
            if (!forceRefresh && typeof localStorage !== 'undefined') {
                const cached = localStorage.getItem(STORAGE_KEY);
                if (cached) {
                    try {
                        const parsed = JSON.parse(cached) as CapabilityReport;
                        logger.info('[BrowserAi] Using cached capability report');
                        return parsed;
                    } catch {
                        // Corrupt cache — re-detect
                    }
                }
            }

            const chromeVersion = detectChromeVersion();
            const webGpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;
            const sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
            const opfsAvailable = typeof navigator !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage;

            let capability: CapabilityReport['capability'];
            let benchmarkMs: number | null = null;
            let webGpuTier: WebGpuTier = 'unavailable';

            if (isTauriNonWindowsPlatform()) {
                // macOS/Linux Tauri — route to native pipeline instead
                capability = 'unsupported-platform';
                logger.info('[BrowserAi] Running in Tauri on macOS/Linux — browser AI disabled, native pipeline available');
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
                logger.info(`[BrowserAi] WebGPU detected: ${webGpuTier} (${String(benchmarkMs?.toFixed(1))}ms)`);
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
            if (typeof localStorage !== 'undefined') {
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(report));
                } catch {
                    // Storage quota exceeded — not critical
                }
            }

            return report;
        }
);
