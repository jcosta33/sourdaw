/**
 * Crumbs record feed relay.
 *
 * Exercises the real main-thread half of the record feed: worklet block →
 * dispatch to the native command → buffer recycled to the worklet's pool. The
 * native dispatch is faked at the injected seam (exactly what production
 * injects) and the worklet is a fake port driven by hand, the same shape as
 * the native plugin bridge spec.
 *
 * The invariants under test are the ones a recording depends on: the relay
 * fires only while the tap lives (arm/destroy gate), carries the monitored
 * block's bytes untouched, preserves block order behind a slow dispatch, and
 * returns pooled buffers without ever returning a foreign one to the pool.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCrumbsRecordFeedNode, type CrumbsRecordFeedDispatch } from '../CrumbsRecordFeedNode';

const mocks = vi.hoisted(() => ({ loggerWarn: vi.fn() }));

vi.mock('#/infra/audioWorklet/workletInitShared', () => ({
    ensureWorkletRegistered: vi.fn(async (): Promise<void> => {}),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { debug: vi.fn(), warn: mocks.loggerWarn, info: vi.fn(), error: vi.fn() },
}));

type FeedMessage = { type: 'feed'; audio: ArrayBuffer; dropped: number };

class FakeMessagePort {
    public onmessage: ((event: MessageEvent<FeedMessage>) => Promise<void> | void) | null = null;
    public readonly close = vi.fn();
    public readonly postMessage = vi.fn();
}

class FakeAudioWorkletNode {
    public static instances: FakeAudioWorkletNode[] = [];
    public readonly connect = vi.fn();
    public readonly disconnect = vi.fn();
    public readonly port = new FakeMessagePort();

    public constructor() {
        FakeAudioWorkletNode.instances.push(this);
    }
}

function currentNode(): FakeAudioWorkletNode {
    const node = FakeAudioWorkletNode.instances.at(-1);
    if (!node) {
        throw new Error('expected the record feed worklet node to be created');
    }
    return node;
}

const POOLED_BYTES = 128 * 8;

function monitoredBlock(firstSample: number, bytes = POOLED_BYTES): ArrayBuffer {
    const samples = new Float32Array(bytes / 4);
    samples[0] = firstSample;
    return samples.buffer;
}

async function feedBlock(node: FakeAudioWorkletNode, audio: ArrayBuffer, dropped = 0): Promise<void> {
    await node.port.onmessage?.(new MessageEvent<FeedMessage>('message', { data: { type: 'feed', audio, dropped } }));
}

/** Let the serialized send chain run its then/catch/then links. */
async function settleSendChain(): Promise<void> {
    for (let hop = 0; hop < 6; hop += 1) {
        await Promise.resolve();
    }
}

describe('CrumbsRecordFeedNode', () => {
    let dispatch: CrumbsRecordFeedDispatch;
    let dispatched: Uint8Array[];
    let handle: Awaited<ReturnType<typeof createCrumbsRecordFeedNode>>;

    beforeEach(async () => {
        FakeAudioWorkletNode.instances = [];
        vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
        mocks.loggerWarn.mockClear();
        dispatched = [];
        dispatch = (audioBytes: Uint8Array) => {
            dispatched.push(audioBytes);
            return Promise.resolve();
        };
        handle = await createCrumbsRecordFeedNode({} as BaseAudioContext, dispatch);
    });

    it('arms the worklet on creation — nothing crosses the port before that', () => {
        const node = currentNode();
        expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'arm' });
        expect(dispatched).toEqual([]);
    });

    it('relays the monitored block untouched and recycles the pooled buffer', async () => {
        const node = currentNode();
        const block = monitoredBlock(0.5);
        await feedBlock(node, block);
        await settleSendChain();

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]).toEqual(new Uint8Array(block));
        expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'recycle', audio: block }, [block]);
    });

    it('keeps a short-quantum buffer out of the worklet pool', async () => {
        const node = currentNode();
        const shortBlock = monitoredBlock(0.25, 64 * 8);
        await feedBlock(node, shortBlock);
        await settleSendChain();

        expect(dispatched).toHaveLength(1);
        const recycleCalls = node.port.postMessage.mock.calls.filter(([message]) => message?.type === 'recycle');
        expect(recycleCalls).toEqual([]);
    });

    it('preserves block order behind a dispatch slower than the quantum', async () => {
        const order: number[] = [];
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        handle.destroy();
        handle = await createCrumbsRecordFeedNode({} as BaseAudioContext, (audioBytes) => {
            // Probe the block's first f32 sample — its first byte alone is
            // mantissa bits and cannot distinguish blocks.
            const first = new Float32Array(audioBytes.buffer, audioBytes.byteOffset, 1)[0] ?? 0;
            order.push(first);
            return gate.then(() => undefined);
        });
        const slowNode = currentNode();

        await feedBlock(slowNode, monitoredBlock(1));
        await feedBlock(slowNode, monitoredBlock(2));
        await settleSendChain();
        expect(order).toEqual([1]);

        release();
        await settleSendChain();
        expect(order).toEqual([1, 2]);
    });

    it('destroys clean: disarms the worklet and ignores late blocks', async () => {
        const node = currentNode();
        handle.destroy();
        expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'disarm' });
        expect(node.port.onmessage).toBeNull();
        expect(node.port.close).toHaveBeenCalled();
        expect(node.disconnect).toHaveBeenCalled();

        await feedBlock(node, monitoredBlock(0.5));
        await settleSendChain();
        expect(dispatched).toEqual([]);
    });

    it('reports a dropped-block count once per new count, not per block', async () => {
        const node = currentNode();
        await feedBlock(node, monitoredBlock(0.5), 2);
        await settleSendChain();
        await feedBlock(node, monitoredBlock(0.5), 2);
        await settleSendChain();
        await feedBlock(node, monitoredBlock(0.5), 5);
        await settleSendChain();

        expect(mocks.loggerWarn).toHaveBeenCalledTimes(2);
        expect(mocks.loggerWarn).toHaveBeenNthCalledWith(
            1,
            '[CrumbsRecordFeed] dropped 2 monitored block(s) behind a slow record feed'
        );
        expect(mocks.loggerWarn).toHaveBeenNthCalledWith(
            2,
            '[CrumbsRecordFeed] dropped 5 monitored block(s) behind a slow record feed'
        );
    });
});
