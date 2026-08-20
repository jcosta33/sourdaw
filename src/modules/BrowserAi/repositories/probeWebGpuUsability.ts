import { type WebGpuProbeRequest, type WebGpuProbeResult } from '../models/WebGpuProbe';

const WEBGPU_PROBE_TIMEOUT_MS = 10_000;

function isWebGpuProbeResult(value: unknown): value is WebGpuProbeResult {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const status: unknown = Reflect.get(value, 'status');
    if (status === 'supported') {
        return true;
    }
    if (status !== 'unavailable') {
        return false;
    }
    const reason: unknown = Reflect.get(value, 'reason');
    return (
        reason === 'missing-surface' ||
        reason === 'adapter-unavailable' ||
        reason === 'fallback-adapter' ||
        reason === 'device-unavailable'
    );
}

export function probeWebGpuUsability(): Promise<WebGpuProbeResult> {
    return new Promise<WebGpuProbeResult>((resolve, reject) => {
        const worker = new Worker(new URL('../workers/webGpuProbeWorker.ts', import.meta.url), { type: 'module' });
        let timeout: ReturnType<typeof setTimeout> | undefined;

        const finish = (): void => {
            if (timeout !== undefined) {
                clearTimeout(timeout);
            }
            worker.onmessage = null;
            worker.onerror = null;
            worker.terminate();
        };

        worker.onmessage = (event: MessageEvent<unknown>): void => {
            const response = event.data;
            const result: unknown =
                typeof response === 'object' && response !== null ? Reflect.get(response, 'result') : null;
            if (
                typeof response !== 'object' ||
                response === null ||
                Reflect.get(response, 'type') !== 'webgpu-probe-result' ||
                !isWebGpuProbeResult(result)
            ) {
                finish();
                reject(new TypeError('WebGPU probe worker returned an invalid response'));
                return;
            }
            finish();
            resolve(result);
        };
        worker.onerror = (): void => {
            finish();
            reject(new Error('WebGPU probe worker failed'));
        };

        timeout = setTimeout(() => {
            finish();
            reject(new Error('WebGPU probe worker timed out'));
        }, WEBGPU_PROBE_TIMEOUT_MS);

        const request: WebGpuProbeRequest = { type: 'probe-webgpu' };
        try {
            worker.postMessage(request);
        } catch (error) {
            finish();
            reject(error);
        }
    });
}
