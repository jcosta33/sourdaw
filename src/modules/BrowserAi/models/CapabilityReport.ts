/**
 * Browser capability report for AI features.
 *
 * Produced by capability detection on feature first use.
 * Stored in localStorage so the micro-benchmark only runs once.
 */

export type WebGpuTier = 'webgpu-fast' | 'webgpu-slow' | 'unavailable';

export type BrowserAiCapability = 'supported' | 'unsupported-browser' | 'unsupported-platform';

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
    /** Micro-benchmark latency in ms, null if not benchmarked */
    benchmarkMs: number | null;
    detectedAt: number;
};

export type CapabilityDisabledReason =
    | 'not-chrome'
    | 'no-webgpu'
    | 'tauri-macos'
    | 'tauri-linux'
    | 'unknown';
