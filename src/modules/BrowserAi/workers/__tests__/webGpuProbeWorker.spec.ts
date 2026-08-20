import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type WebGpuProbeRequest } from '../../models/WebGpuProbe';

type WorkerMessageHandler = (event: MessageEvent<WebGpuProbeRequest>) => void;

function installNavigator(value: object): void {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
}

async function runProbe(): Promise<unknown> {
    await import('../webGpuProbeWorker');
    (self.onmessage as WorkerMessageHandler)({
        data: { type: 'probe-webgpu' },
    } as MessageEvent<WebGpuProbeRequest>);

    await vi.waitFor(() => expect(self.postMessage).toHaveBeenCalledTimes(1));
    const response = vi.mocked(self.postMessage).mock.calls[0]?.[0];
    return response;
}

describe('webGpuProbeWorker', () => {
    beforeEach(() => {
        vi.resetModules();
        self.postMessage = vi.fn();
    });

    it('reports the WebGPU surface as missing', async () => {
        installNavigator({});

        await expect(runProbe()).resolves.toEqual({
            type: 'webgpu-probe-result',
            result: { status: 'unavailable', reason: 'missing-surface' },
        });
    });

    it('requests a core non-fallback adapter and reports null as unavailable', async () => {
        const requestAdapter = vi.fn().mockResolvedValue(null);
        installNavigator({ gpu: { requestAdapter } });

        await expect(runProbe()).resolves.toEqual({
            type: 'webgpu-probe-result',
            result: { status: 'unavailable', reason: 'adapter-unavailable' },
        });
        expect(requestAdapter).toHaveBeenCalledExactlyOnceWith({
            featureLevel: 'core',
            forceFallbackAdapter: false,
        });
    });

    it('reports adapter request rejection as unavailable exactly once', async () => {
        const requestAdapter = vi.fn().mockRejectedValue(new Error('adapter refused'));
        installNavigator({ gpu: { requestAdapter } });

        await expect(runProbe()).resolves.toEqual({
            type: 'webgpu-probe-result',
            result: { status: 'unavailable', reason: 'adapter-unavailable' },
        });
        expect(requestAdapter).toHaveBeenCalledExactlyOnceWith({
            featureLevel: 'core',
            forceFallbackAdapter: false,
        });
        expect(self.postMessage).toHaveBeenCalledTimes(1);
    });

    it('rejects a fallback adapter without requesting a device', async () => {
        const requestDevice = vi.fn();
        installNavigator({
            gpu: {
                requestAdapter: vi.fn().mockResolvedValue({
                    info: { isFallbackAdapter: true },
                    requestDevice,
                }),
            },
        });

        await expect(runProbe()).resolves.toEqual({
            type: 'webgpu-probe-result',
            result: { status: 'unavailable', reason: 'fallback-adapter' },
        });
        expect(requestDevice).not.toHaveBeenCalled();
    });

    it('fails closed when the adapter cannot prove it is not a fallback', async () => {
        const requestDevice = vi.fn();
        installNavigator({
            gpu: {
                requestAdapter: vi.fn().mockResolvedValue({ info: {}, requestDevice }),
            },
        });

        await expect(runProbe()).resolves.toEqual({
            type: 'webgpu-probe-result',
            result: { status: 'unavailable', reason: 'adapter-unavailable' },
        });
        expect(requestDevice).not.toHaveBeenCalled();
    });

    it('reports device rejection as unavailable', async () => {
        const requestDevice = vi.fn().mockRejectedValue(new Error('device refused'));
        installNavigator({
            gpu: {
                requestAdapter: vi.fn().mockResolvedValue({
                    info: { isFallbackAdapter: false },
                    requestDevice,
                }),
            },
        });

        await expect(runProbe()).resolves.toEqual({
            type: 'webgpu-probe-result',
            result: { status: 'unavailable', reason: 'device-unavailable' },
        });
        expect(requestDevice).toHaveBeenCalledTimes(1);
    });

    it('destroys the probe device after successful admission', async () => {
        const destroy = vi.fn();
        installNavigator({
            gpu: {
                requestAdapter: vi.fn().mockResolvedValue({
                    info: { isFallbackAdapter: false },
                    requestDevice: vi.fn().mockResolvedValue({ destroy }),
                }),
            },
        });

        await expect(runProbe()).resolves.toEqual({
            type: 'webgpu-probe-result',
            result: { status: 'supported' },
        });
        expect(destroy).toHaveBeenCalledTimes(1);
    });
});
