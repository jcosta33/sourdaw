import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
    initialize: vi.fn<(url: string) => Promise<void>>(),
    materialize: vi.fn<(data: unknown) => { bytes: Uint8Array<ArrayBuffer>; heads: string[] }>(),
}));
vi.mock('@automerge/automerge/slim', () => ({ initializeWasm: calls.initialize }));
vi.mock('../prospectiveMutationWorkerRuntime', () => ({ materializeProspectiveMutation: calls.materialize }));

const endpoint = {
    onmessage: null as ((event: MessageEvent<unknown>) => Promise<void>) | null,
    postMessage: vi.fn(),
};

beforeEach(() => {
    vi.resetModules();
    calls.initialize.mockReset();
    calls.materialize.mockReset();
    endpoint.onmessage = null;
    endpoint.postMessage.mockReset();
    vi.stubGlobal('self', endpoint);
});
afterEach(() => vi.unstubAllGlobals());

describe('prospective Worker public WASM readiness', () => {
    it('waits for public initialization before materializing and transferring its owned response', async () => {
        const ready = Promise.withResolvers<void>();
        calls.initialize.mockReturnValue(ready.promise);
        const result = { bytes: Uint8Array.of(1, 2, 3), heads: ['a'.repeat(64)] };
        calls.materialize.mockReturnValue(result);
        await import('../prospectiveMutationWorker');
        expect(calls.initialize).not.toHaveBeenCalled();
        if (!endpoint.onmessage) {
            throw new Error('Worker handler missing');
        }
        const request = { seed: 'owned request' };
        const pending = endpoint.onmessage(new MessageEvent('message', { data: request }));
        expect(calls.initialize).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('automerge.wasm'));
        expect(calls.materialize).not.toHaveBeenCalled();
        expect(endpoint.postMessage).not.toHaveBeenCalled();
        ready.resolve();
        await pending;
        expect(calls.materialize).toHaveBeenCalledExactlyOnceWith(request);
        expect(endpoint.postMessage).toHaveBeenCalledExactlyOnceWith({ status: 'complete', ...result }, [
            result.bytes.buffer,
        ]);
    });

    it.each(['fetch refused', 'invalid WebAssembly bytes'])(
        'reports initialization failure privately without native materialization: %s',
        async (message) => {
            calls.initialize.mockRejectedValue(new Error(message));
            await import('../prospectiveMutationWorker');
            if (!endpoint.onmessage) {
                throw new Error('Worker handler missing');
            }
            await endpoint.onmessage(new MessageEvent('message', { data: { seed: 'request' } }));
            expect(calls.initialize).toHaveBeenCalledTimes(1);
            expect(calls.materialize).not.toHaveBeenCalled();
            expect(endpoint.postMessage).toHaveBeenCalledExactlyOnceWith({ status: 'failed', message });
        }
    );
});
