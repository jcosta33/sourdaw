import { type WebGpuProbeRequest, type WebGpuProbeResponse, type WebGpuProbeResult } from '../models/WebGpuProbe';

async function probeWebGpu(): Promise<WebGpuProbeResult> {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
        return { status: 'unavailable', reason: 'missing-surface' };
    }

    let adapter: GPUAdapter | null;
    try {
        adapter = await navigator.gpu.requestAdapter({
            featureLevel: 'core',
            forceFallbackAdapter: false,
        });
    } catch {
        return { status: 'unavailable', reason: 'adapter-unavailable' };
    }

    if (!adapter) {
        return { status: 'unavailable', reason: 'adapter-unavailable' };
    }
    let isFallbackAdapter: unknown;
    try {
        isFallbackAdapter = Reflect.get(adapter.info, 'isFallbackAdapter');
    } catch {
        return { status: 'unavailable', reason: 'adapter-unavailable' };
    }
    if (typeof isFallbackAdapter !== 'boolean') {
        return { status: 'unavailable', reason: 'adapter-unavailable' };
    }
    if (isFallbackAdapter) {
        return { status: 'unavailable', reason: 'fallback-adapter' };
    }

    try {
        const device = await adapter.requestDevice();
        device.destroy();
    } catch {
        return { status: 'unavailable', reason: 'device-unavailable' };
    }

    return { status: 'supported' };
}

self.onmessage = (event: MessageEvent<WebGpuProbeRequest>): void => {
    if (event.data.type !== 'probe-webgpu') {
        return;
    }
    void probeWebGpu().then((result) => {
        const response: WebGpuProbeResponse = { type: 'webgpu-probe-result', result };
        self.postMessage(response);
    });
};
