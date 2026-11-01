import { afterAll, beforeAll, describe, expect, it, type Mock, vi } from 'vitest';

import { type FactorySynthesisWorkerReply } from '../../models/FactorySynthesisWorker';

type PostReply = (reply: FactorySynthesisWorkerReply, transfer: ArrayBuffer[]) => void;

const endpoint: {
    onmessage: ((event: MessageEvent<unknown>) => void) | null;
    postMessage: Mock<PostReply>;
} = { onmessage: null, postMessage: vi.fn<PostReply>() };

describe('factory synthesis worker entry', () => {
    beforeAll(async () => {
        vi.stubGlobal('self', endpoint);
        await import('../factorySynthesisWorker');
    });
    afterAll(() => vi.unstubAllGlobals());

    it('installs a message handler on the worker global', () => {
        expect(endpoint.onmessage).toBeTypeOf('function');
    });

    it('posts the rendered library with every channel buffer in the transfer list', () => {
        endpoint.onmessage?.(new MessageEvent('message', { data: { type: 'render' } }));

        expect(endpoint.postMessage).toHaveBeenCalledTimes(1);
        const [reply, transfer] = endpoint.postMessage.mock.calls[0]!;
        if (reply.status !== 'complete') {
            throw new Error(`expected a complete reply, got ${reply.status}`);
        }
        const buffers = reply.samples.flatMap((sample) => sample.channels.map((channel) => channel.buffer));
        const transferred = new Set<ArrayBufferLike>(transfer);
        expect(transferred.size).toBe(new Set(buffers).size);
        expect(buffers.every((buffer) => transferred.has(buffer))).toBe(true);
    });
});
