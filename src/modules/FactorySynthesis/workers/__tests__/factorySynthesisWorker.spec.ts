import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const endpoint: {
    onmessage: ((event: MessageEvent<unknown>) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
} = { onmessage: null, postMessage: vi.fn() };

describe('factory synthesis worker entry', () => {
    beforeAll(async () => {
        vi.stubGlobal('self', endpoint);
        await import('../factorySynthesisWorker');
    });
    afterAll(() => vi.unstubAllGlobals());

    it('binds its message handler during module evaluation', () => {
        expect(endpoint.onmessage).toBeTypeOf('function');
    });

    it('posts the rendered library with every channel buffer in the transfer list', () => {
        endpoint.onmessage?.(new MessageEvent('message', { data: { type: 'render' } }));

        expect(endpoint.postMessage).toHaveBeenCalledTimes(1);
        const [reply, transfer] = endpoint.postMessage.mock.calls[0] as [
            { status: string; samples: { channels: Float32Array[] }[] },
            ArrayBuffer[],
        ];
        expect(reply.status).toBe('complete');
        const buffers = reply.samples.flatMap((sample) => sample.channels.map((channel) => channel.buffer));
        const transferred = new Set(transfer);
        expect(transferred.size).toBe(new Set(buffers).size);
        expect(buffers.every((buffer) => transferred.has(buffer))).toBe(true);
    });
});
