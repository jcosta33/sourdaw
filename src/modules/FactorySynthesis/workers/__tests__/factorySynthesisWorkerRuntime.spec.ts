import { describe, expect, it } from 'vitest';

import { renderFactorySynthesisReply } from '../factorySynthesisWorkerRuntime';

describe('factory synthesis worker runtime', () => {
    it('renders every factory sample and transfers each channel buffer exactly once', () => {
        const { reply, transfer } = renderFactorySynthesisReply({ type: 'render' });

        expect(reply.status).toBe('complete');
        if (reply.status !== 'complete') {
            return;
        }
        expect(reply.samples.length).toBeGreaterThanOrEqual(60);
        const buffers = reply.samples.flatMap((sample) => sample.channels.map((channel) => channel.buffer));
        const transferred = new Set<ArrayBufferLike>(transfer);
        expect(transfer).toHaveLength(transferred.size);
        expect(transferred.size).toBe(new Set(buffers).size);
        expect(buffers.every((buffer) => transferred.has(buffer))).toBe(true);
    });

    it('produces a reply that survives a transferring structured clone intact', () => {
        const { reply, transfer } = renderFactorySynthesisReply({ type: 'render' });
        if (reply.status !== 'complete') {
            throw new Error('expected a complete reply');
        }
        const lengths = reply.samples.map((sample) => sample.channels.map((channel) => channel.length));

        const received = structuredClone(reply, { transfer });

        expect(transfer.every((buffer) => buffer.byteLength === 0)).toBe(true);
        expect(received.status).toBe('complete');
        if (received.status !== 'complete') {
            return;
        }
        expect(received.samples.map((sample) => sample.channels.map((channel) => channel.length))).toEqual(lengths);
        // jsdom's structuredClone answers from another realm, so instanceof cannot apply here.
        const channelTags = new Set(
            received.samples.flatMap((sample) => sample.channels.map((c) => Object.prototype.toString.call(c)))
        );
        expect(channelTags).toEqual(new Set(['[object Float32Array]']));
    });

    it.each([undefined, null, 'render', {}, { type: 'other' }])(
        'refuses the request %j without rendering',
        (message) => {
            expect(renderFactorySynthesisReply(message)).toEqual({ reply: { status: 'failed' }, transfer: [] });
        }
    );
});
