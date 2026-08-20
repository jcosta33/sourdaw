import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type WebGpuProbeRequest, type WebGpuProbeResponse } from '../../models/WebGpuProbe';
import { probeWebGpuUsability } from '../probeWebGpuUsability';

type FakeWorker = {
    url: string;
    options: WorkerOptions;
    onmessage: ((event: MessageEvent<WebGpuProbeResponse>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    postMessage: ReturnType<typeof vi.fn<(message: WebGpuProbeRequest) => void>>;
    terminate: ReturnType<typeof vi.fn>;
};

const OriginalWorker = globalThis.Worker;
let installedWorkers: FakeWorker[] = [];
let postMessageError: Error | null = null;

beforeEach(() => {
    installedWorkers = [];
    postMessageError = null;
    class WorkerStub {
        url: string;
        options: WorkerOptions;
        onmessage: ((event: MessageEvent<WebGpuProbeResponse>) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        postMessage = vi.fn<(message: WebGpuProbeRequest) => void>(() => {
            if (postMessageError) {
                throw postMessageError;
            }
        });
        terminate = vi.fn();

        constructor(url: string | URL, options: WorkerOptions) {
            this.url = String(url);
            this.options = options;
            installedWorkers.push(this);
        }
    }
    globalThis.Worker = WorkerStub as unknown as typeof Worker;
});

afterEach(() => {
    globalThis.Worker = OriginalWorker;
    vi.useRealTimers();
});

function installedWorker(): FakeWorker {
    const worker = installedWorkers.at(-1);
    if (!worker) {
        throw new Error('WebGPU probe worker was not constructed');
    }
    return worker;
}

describe('probeWebGpuUsability', () => {
    it('runs the one-shot probe in its dedicated module worker', async () => {
        vi.useFakeTimers();
        const result = probeWebGpuUsability();
        const worker = installedWorker();

        expect(worker.url).toContain('webGpuProbeWorker');
        expect(worker.options).toEqual({ type: 'module' });
        expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'probe-webgpu' });

        worker.onmessage?.({
            data: { type: 'webgpu-probe-result', result: { status: 'supported' } },
        } as MessageEvent<WebGpuProbeResponse>);

        await expect(result).resolves.toEqual({ status: 'supported' });
        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(worker.onmessage).toBeNull();
        expect(worker.onerror).toBeNull();

        await vi.advanceTimersByTimeAsync(10_001);

        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(worker.onmessage).toBeNull();
        expect(worker.onerror).toBeNull();
    });

    it('preserves an explicit unavailable outcome and terminates the worker', async () => {
        const result = probeWebGpuUsability();
        const worker = installedWorker();

        worker.onmessage?.({
            data: {
                type: 'webgpu-probe-result',
                result: { status: 'unavailable', reason: 'fallback-adapter' },
            },
        } as MessageEvent<WebGpuProbeResponse>);

        await expect(result).resolves.toEqual({ status: 'unavailable', reason: 'fallback-adapter' });
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid worker responses instead of treating them as support', async () => {
        const result = probeWebGpuUsability();
        const worker = installedWorker();

        worker.onmessage?.({
            data: { type: 'webgpu-probe-result', result: { status: 'available' } },
        } as unknown as MessageEvent<WebGpuProbeResponse>);

        await expect(result).rejects.toThrow('invalid response');
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('rejects worker failures and terminates the worker', async () => {
        const result = probeWebGpuUsability();
        const worker = installedWorker();

        worker.onerror?.(new ErrorEvent('error', { error: new Error('worker crashed') }));

        await expect(result).rejects.toThrow('WebGPU probe worker failed');
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('cleans up when posting the probe request throws synchronously', async () => {
        vi.useFakeTimers();
        postMessageError = new Error('postMessage refused');

        const result = probeWebGpuUsability();
        const worker = installedWorker();

        await expect(result).rejects.toThrow('postMessage refused');
        expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'probe-webgpu' });
        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(worker.onmessage).toBeNull();
        expect(worker.onerror).toBeNull();

        await vi.advanceTimersByTimeAsync(10_001);

        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('fails closed and terminates a silent worker after the finite probe deadline', async () => {
        vi.useFakeTimers();
        const result = probeWebGpuUsability();
        const worker = installedWorker();
        const rejection = expect(result).rejects.toThrow('WebGPU probe worker timed out');

        await vi.runAllTimersAsync();

        await rejection;
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });
});
