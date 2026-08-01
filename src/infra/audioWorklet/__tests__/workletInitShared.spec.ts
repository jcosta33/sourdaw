import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReadyHandshake, ensureWorkletRegistered, fetchWasmBinary } from '../workletInitShared';

type FakeAudioContext = {
    audioWorklet: {
        addModule: (moduleUrl: string) => Promise<void>;
    };
};

const createFakeContext = (addModule: (moduleUrl: string) => Promise<void>): FakeAudioContext => ({
    audioWorklet: { addModule },
});

describe('ensureWorkletRegistered', () => {
    it('registers the module on the context and resolves', async () => {
        const addModule = vi.fn().mockResolvedValue(undefined);
        const ctx = createFakeContext(addModule);

        await ensureWorkletRegistered(ctx as unknown as BaseAudioContext, 'worklet.js');

        expect(addModule).toHaveBeenCalledExactlyOnceWith('worklet.js');
    });

    it('caches the registration promise so a second call for the same context/url does not re-register', async () => {
        const addModule = vi.fn().mockResolvedValue(undefined);
        const ctx = createFakeContext(addModule);

        await ensureWorkletRegistered(ctx as unknown as BaseAudioContext, 'worklet.js');
        await ensureWorkletRegistered(ctx as unknown as BaseAudioContext, 'worklet.js');

        expect(addModule).toHaveBeenCalledOnce();
    });

    it('registers separately per url on the same context', async () => {
        const addModule = vi.fn().mockResolvedValue(undefined);
        const ctx = createFakeContext(addModule);

        await ensureWorkletRegistered(ctx as unknown as BaseAudioContext, 'a.js');
        await ensureWorkletRegistered(ctx as unknown as BaseAudioContext, 'b.js');

        expect(addModule).toHaveBeenCalledTimes(2);
    });

    it('registers separately per context for the same url', async () => {
        const addModuleA = vi.fn().mockResolvedValue(undefined);
        const addModuleB = vi.fn().mockResolvedValue(undefined);
        const ctxA = createFakeContext(addModuleA);
        const ctxB = createFakeContext(addModuleB);

        await ensureWorkletRegistered(ctxA as unknown as BaseAudioContext, 'shared.js');
        await ensureWorkletRegistered(ctxB as unknown as BaseAudioContext, 'shared.js');

        expect(addModuleA).toHaveBeenCalledOnce();
        expect(addModuleB).toHaveBeenCalledOnce();
    });
});

describe('fetchWasmBinary', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('fetches the binary and resolves with the array buffer', async () => {
        const buffer = new ArrayBuffer(4);
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: () => Promise.resolve(buffer),
        });
        globalThis.fetch = fetchMock;

        const result = await fetchWasmBinary('https://example.test/module-a.wasm');

        expect(result).toBe(buffer);
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('https://example.test/module-a.wasm');
    });

    it('caches in-flight fetches so a second call for the same url does not re-fetch', async () => {
        const buffer = new ArrayBuffer(4);
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: () => Promise.resolve(buffer),
        });
        globalThis.fetch = fetchMock;

        const [first, second] = await Promise.all([
            fetchWasmBinary('https://example.test/module-b.wasm'),
            fetchWasmBinary('https://example.test/module-b.wasm'),
        ]);

        expect(first).toBe(buffer);
        expect(second).toBe(buffer);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('rejects with a descriptive error when the response is not ok', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        });
        globalThis.fetch = fetchMock;

        await expect(fetchWasmBinary('https://example.test/missing.wasm')).rejects.toThrow(
            'Failed to fetch WASM (https://example.test/missing.wasm): 404'
        );
    });

    it('drops a failed fetch from the cache so a later retry can succeed', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({ ok: false, status: 500, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) })
            .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
        globalThis.fetch = fetchMock;

        await expect(fetchWasmBinary('https://example.test/retry.wasm')).rejects.toThrow();
        const result = await fetchWasmBinary('https://example.test/retry.wasm');

        expect(result.byteLength).toBe(8);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('createReadyHandshake', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('resolves the promise and reports "ready" when a ready message arrives', async () => {
        const handshake = createReadyHandshake({ pluginName: 'TestNode' });

        const outcome = handshake.onMessage({ data: { type: 'ready', sampleRate: 48_000 } } as MessageEvent);

        expect(outcome).toBe('ready');
        expect(handshake.isSettled()).toBe(true);
        await expect(handshake.promise).resolves.toEqual({ type: 'ready', sampleRate: 48_000 });
    });

    it('rejects the promise and reports "error" when an error message arrives', async () => {
        const handshake = createReadyHandshake({ pluginName: 'TestNode' });

        const outcome = handshake.onMessage({ data: { type: 'error', message: 'boom' } } as MessageEvent);

        expect(outcome).toBe('error');
        expect(handshake.isSettled()).toBe(true);
        await expect(handshake.promise).rejects.toThrow('boom');
    });

    it('falls back to a generic error message when the error event carries no message', async () => {
        const handshake = createReadyHandshake({ pluginName: 'TestNode' });

        handshake.onMessage({ data: { type: 'error' } } as MessageEvent);

        await expect(handshake.promise).rejects.toThrow('TestNode init error');
    });

    it('reports "other" for messages that are not ready/error and leaves the handshake unsettled', () => {
        const handshake = createReadyHandshake({ pluginName: 'TestNode' });

        expect(handshake.onMessage({ data: { type: 'progress' } } as MessageEvent)).toBe('other');
        expect(handshake.onMessage({ data: null } as unknown as MessageEvent)).toBe('other');
        expect(handshake.onMessage({ data: 'not-an-object' } as unknown as MessageEvent)).toBe('other');
        expect(handshake.isSettled()).toBe(false);
    });

    it('reports "late" for a ready/error event that arrives after the handshake already settled', async () => {
        const handshake = createReadyHandshake({ pluginName: 'TestNode' });

        handshake.onMessage({ data: { type: 'ready' } } as MessageEvent);
        const lateOutcome = handshake.onMessage({ data: { type: 'error', message: 'late boom' } } as MessageEvent);

        expect(lateOutcome).toBe('late');
        await expect(handshake.promise).resolves.toEqual({ type: 'ready' });
    });

    it('cancels an unsettled handshake without leaving its timeout alive', async () => {
        const handshake = createReadyHandshake({ pluginName: 'TestNode', timeoutMs: 5_000 });
        const assertion = expect(handshake.promise).rejects.toThrow('node disposed');

        handshake.cancel(new Error('node disposed'));
        await vi.advanceTimersByTimeAsync(5_000);

        await assertion;
        expect(handshake.isSettled()).toBe(true);
    });

    it('rejects with a timeout error once the timeout elapses without a message', async () => {
        const handshake = createReadyHandshake({ pluginName: 'TestNode', timeoutMs: 5_000 });

        const assertion = expect(handshake.promise).rejects.toThrow('TestNode init timeout (5s)');
        await vi.advanceTimersByTimeAsync(5_000);
        await assertion;
        expect(handshake.isSettled()).toBe(true);
    });

    it('does not time out once the handshake already resolved', async () => {
        const handshake = createReadyHandshake({ pluginName: 'TestNode', timeoutMs: 1_000 });

        handshake.onMessage({ data: { type: 'ready' } } as MessageEvent);
        await vi.advanceTimersByTimeAsync(1_000);

        await expect(handshake.promise).resolves.toEqual({ type: 'ready' });
    });

    it('uses the default 10s timeout when none is provided', async () => {
        const handshake = createReadyHandshake({ pluginName: 'DefaultTimeoutNode' });

        const assertion = expect(handshake.promise).rejects.toThrow('DefaultTimeoutNode init timeout (10s)');
        await vi.advanceTimersByTimeAsync(10_000);
        await assertion;
    });
});
