import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processAudioIPC, setPluginParameter } from '#/modules/PluginHost/useCases';

import { dropoutCounters } from '../dropoutCounter';
import { createNativePluginBridgeNode } from '../NativePluginBridgeNode';

vi.mock('#/modules/PluginHost/useCases', () => ({
    processAudioIPC: vi.fn(),
    setPluginParameter: vi.fn(),
    setPluginBypass: vi.fn(() => Promise.resolve()),
}));

type BridgeWorkletMessage = {
    audio?: ArrayBuffer;
    type: string;
};

class FakeMessagePort {
    public onmessage: ((event: MessageEvent<BridgeWorkletMessage>) => Promise<void> | void) | null = null;
    public readonly close = vi.fn();
    public readonly postMessage = vi.fn();
}

class FakeAudioWorkletNode {
    public static instances: FakeAudioWorkletNode[] = [];

    public readonly connect = vi.fn();
    public readonly disconnect = vi.fn();
    public readonly port = new FakeMessagePort();

    public constructor(
        public readonly context: AudioContext,
        public readonly name: string,
        public readonly options: AudioWorkletNodeOptions
    ) {
        FakeAudioWorkletNode.instances.push(this);
    }
}

class FakeAudioContext {}

function createAudioContext(): AudioContext {
    return new AudioContext();
}

function createAudioBuffer(bytes: number[]): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.length);
    new Uint8Array(buffer).set(bytes);
    return buffer;
}

function getCreatedNode(): FakeAudioWorkletNode {
    const node = FakeAudioWorkletNode.instances[0];
    if (!node) {
        throw new Error('expected native bridge worklet node to be created');
    }
    return node;
}

async function dispatchProcessMessage(node: FakeAudioWorkletNode, audio: ArrayBuffer): Promise<void> {
    const event = new MessageEvent<BridgeWorkletMessage>('message', {
        data: { type: 'process', audio },
    });
    await node.port.onmessage?.(event);
}

describe('createNativePluginBridgeNode', () => {
    beforeEach(() => {
        FakeAudioWorkletNode.instances = [];
        vi.stubGlobal('AudioContext', FakeAudioContext);
        vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should initialize the worklet with no plugin identity and the shared dropout tally', async () => {
        await createNativePluginBridgeNode(createAudioContext(), 'instance-1');

        const node = getCreatedNode();
        expect(node.name).toBe('native-plugin-bridge-processor');
        expect(node.options).toEqual({
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: 'explicit',
        });
        const init = node.port.postMessage.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(init.type).toBe('init');
        expect(Object.keys(init).sort()).toEqual(['dropoutSab', 'type']);
    });

    it('should write the processed bytes into the buffer the worklet lent it and hand that back', async () => {
        vi.mocked(processAudioIPC).mockResolvedValue(new Uint8Array([9, 8, 7]));
        await createNativePluginBridgeNode(createAudioContext(), 'instance-1');
        const node = getCreatedNode();
        const lentBuffer = createAudioBuffer([1, 2, 3]);

        await dispatchProcessMessage(node, lentBuffer);

        const input = vi.mocked(processAudioIPC).mock.calls[0]?.[0];
        expect(input?.instanceId).toBe('instance-1');

        // The worklet's pool only stays whole if it gets its own backing store
        // back — a fresh buffer here would shrink the pool by one every block.
        const [message, transfer] = node.port.postMessage.mock.calls[1] ?? [];
        expect(message).toEqual({ type: 'processed', audio: lentBuffer });
        expect(transfer).toEqual([lentBuffer]);
        expect(Array.from(new Uint8Array(lentBuffer))).toEqual([9, 8, 7]);
    });

    it('should copy exactly the processed byte view returned by the Plugin use-case', async () => {
        const backing = new Uint8Array([9, 9, 4, 5, 6]);
        vi.mocked(processAudioIPC).mockResolvedValue(backing.subarray(2));
        await createNativePluginBridgeNode(createAudioContext(), 'instance-1');
        const node = getCreatedNode();
        const lentBuffer = createAudioBuffer([1, 2, 3]);

        await dispatchProcessMessage(node, lentBuffer);

        expect(Array.from(new Uint8Array(lentBuffer))).toEqual([4, 5, 6]);
    });

    it('should return the buffer unprocessed when the Plugin use-case yields no bytes', async () => {
        vi.mocked(processAudioIPC).mockResolvedValue(null);
        await createNativePluginBridgeNode(createAudioContext(), 'instance-1');
        const node = getCreatedNode();
        const lentBuffer = createAudioBuffer([1, 2, 3]);

        await dispatchProcessMessage(node, lentBuffer);

        // Nothing to play, but the buffer still goes home.
        const [message] = node.port.postMessage.mock.calls[1] ?? [];
        expect(message).toEqual({ type: 'recycle', audio: lentBuffer });
        expect(Array.from(new Uint8Array(lentBuffer))).toEqual([1, 2, 3]);
    });

    it('should return the buffer when the Plugin use-case rejects', async () => {
        vi.mocked(processAudioIPC).mockRejectedValue(new Error('native failed'));
        await createNativePluginBridgeNode(createAudioContext(), 'instance-1');
        const node = getCreatedNode();
        const lentBuffer = createAudioBuffer([1, 2, 3]);

        await dispatchProcessMessage(node, lentBuffer);

        const [message] = node.port.postMessage.mock.calls[1] ?? [];
        expect(message).toEqual({ type: 'recycle', audio: lentBuffer });
    });

    it('should keep one audio block in flight, and recycle plus count the ones it drops', async () => {
        dropoutCounters.reset();
        const processing = { resolve: undefined as ((bytes: Uint8Array) => void) | undefined };
        vi.mocked(processAudioIPC).mockReturnValue(
            new Promise((resolve) => {
                processing.resolve = resolve;
            })
        );
        await createNativePluginBridgeNode(createAudioContext(), 'instance-1');
        const node = getCreatedNode();

        const inFlightBuffer = createAudioBuffer([1]);
        const droppedBuffer = createAudioBuffer([2]);
        const firstProcess = dispatchProcessMessage(node, inFlightBuffer);
        await dispatchProcessMessage(node, droppedBuffer);

        expect(processAudioIPC).toHaveBeenCalledTimes(1);
        expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'recycle', audio: droppedBuffer }, [droppedBuffer]);
        expect(dropoutCounters.read().bridgeDroppedBlocks).toBe(1);

        const resolveProcessing = processing.resolve;
        if (!resolveProcessing) {
            throw new Error('expected a pending audio block');
        }
        resolveProcessing(new Uint8Array([3]));
        await firstProcess;

        expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'processed', audio: inFlightBuffer }, [
            inFlightBuffer,
        ]);
        expect(Array.from(new Uint8Array(inFlightBuffer))).toEqual([3]);
    });

    it('should swallow processing errors and accept a later block', async () => {
        vi.mocked(processAudioIPC)
            .mockRejectedValueOnce(new Error('native failed'))
            .mockResolvedValueOnce(new Uint8Array([5]));
        await createNativePluginBridgeNode(createAudioContext(), 'instance-1');
        const node = getCreatedNode();

        await dispatchProcessMessage(node, createAudioBuffer([1]));
        await dispatchProcessMessage(node, createAudioBuffer([2]));

        expect(processAudioIPC).toHaveBeenCalledTimes(2);
    });

    it('should delegate parameter updates through the Plugin use-case and swallow failures', async () => {
        vi.mocked(setPluginParameter).mockRejectedValue(new Error('native failed'));
        const result = await createNativePluginBridgeNode(createAudioContext(), 'instance-1');

        result.setParam(9, 0.25);
        await Promise.resolve();

        expect(setPluginParameter).toHaveBeenCalledWith({
            instanceId: 'instance-1',
            paramId: 9,
            value: 0.25,
        });
    });
});
