import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processAudioIPC, setPluginParameter } from '#/modules/PluginHost/useCases';

import { createNativePluginBridgeNode } from '../NativePluginBridgeNode';

vi.mock('#/modules/PluginHost/useCases', () => ({
    processAudioIPC: vi.fn(),
    setPluginParameter: vi.fn(),
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

    it('should initialize the worklet with the engine plugin id', async () => {
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
        expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'init' });
    });

    it('should delegate audio blocks through the Plugin use-case and post processed bytes', async () => {
        const processedBytes = new Uint8Array([9, 8, 7]);
        vi.mocked(processAudioIPC).mockResolvedValue(processedBytes);
        await createNativePluginBridgeNode(createAudioContext(), 'instance-1');
        const node = getCreatedNode();

        await dispatchProcessMessage(node, createAudioBuffer([1, 2, 3]));

        const input = vi.mocked(processAudioIPC).mock.calls[0]?.[0];
        expect(input?.instanceId).toBe('instance-1');
        expect(Array.from(input?.audioBytes ?? [])).toEqual([1, 2, 3]);
        expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'processed', audio: processedBytes.buffer }, [
            processedBytes.buffer,
        ]);
    });

    it('should post exactly the processed byte view returned by the Plugin use-case', async () => {
        const backing = new Uint8Array([9, 9, 4, 5, 6]);
        vi.mocked(processAudioIPC).mockResolvedValue(backing.subarray(2));
        await createNativePluginBridgeNode(createAudioContext(), 'instance-1');
        const node = getCreatedNode();

        await dispatchProcessMessage(node, createAudioBuffer([1, 2, 3]));

        const postedMessage = node.port.postMessage.mock.calls[1]?.[0] as { audio?: ArrayBuffer };
        expect(Array.from(new Uint8Array(postedMessage.audio ?? new ArrayBuffer(0)))).toEqual([4, 5, 6]);
    });

    it('should not post processed audio when the Plugin use-case returns no bytes', async () => {
        vi.mocked(processAudioIPC).mockResolvedValue(null);
        await createNativePluginBridgeNode(createAudioContext(), 'instance-1');
        const node = getCreatedNode();

        await dispatchProcessMessage(node, createAudioBuffer([1, 2, 3]));

        expect(node.port.postMessage).toHaveBeenCalledTimes(1);
        expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'init' });
    });

    it('should keep one audio block in flight and drop blocks while pending', async () => {
        const processing = { resolve: undefined as ((bytes: Uint8Array) => void) | undefined };
        vi.mocked(processAudioIPC).mockReturnValue(
            new Promise((resolve) => {
                processing.resolve = resolve;
            })
        );
        await createNativePluginBridgeNode(createAudioContext(), 'instance-1');
        const node = getCreatedNode();

        const firstProcess = dispatchProcessMessage(node, createAudioBuffer([1]));
        await dispatchProcessMessage(node, createAudioBuffer([2]));

        expect(processAudioIPC).toHaveBeenCalledTimes(1);
        const processedBytes = new Uint8Array([3]);
        const resolveProcessing = processing.resolve;
        if (!resolveProcessing) {
            throw new Error('expected a pending audio block');
        }
        resolveProcessing(processedBytes);
        await firstProcess;

        expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'processed', audio: processedBytes.buffer }, [
            processedBytes.buffer,
        ]);
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
