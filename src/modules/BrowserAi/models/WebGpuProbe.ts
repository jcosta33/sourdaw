export type WebGpuUnavailableReason =
    'missing-surface' | 'adapter-unavailable' | 'fallback-adapter' | 'device-unavailable';

export type WebGpuProbeResult = { status: 'supported' } | { status: 'unavailable'; reason: WebGpuUnavailableReason };

export type WebGpuProbeRequest = { type: 'probe-webgpu' };

export type WebGpuProbeResponse = { type: 'webgpu-probe-result'; result: WebGpuProbeResult };
