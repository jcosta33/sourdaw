export type WebGpuUnavailableReason =
    | 'missing-surface'
    | 'adapter-unavailable'
    | 'fallback-adapter'
    | 'device-unavailable'
    /** The worker bridge could not complete, so no adapter or device verdict was observed. */
    | 'probe-failed';

export type WebGpuProbeResult = { status: 'supported' } | { status: 'unavailable'; reason: WebGpuUnavailableReason };

export type WebGpuProbeRequest = { type: 'probe-webgpu' };

export type WebGpuProbeObservation = {
    webGpu: WebGpuProbeResult;
    /** The isolation fact from the worker global that will host inference. */
    crossOriginIsolated: boolean;
};

export type WebGpuProbeResponse = {
    type: 'webgpu-probe-result';
    result: WebGpuProbeResult;
    workerCrossOriginIsolated: boolean;
};
