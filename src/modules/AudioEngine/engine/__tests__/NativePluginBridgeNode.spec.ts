import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadPlugin, processAudioIPC, setPluginParameter, unloadPlugin } from '#/modules/PluginHost/useCases';

import { createNativePluginBridgeNode } from '../NativePluginBridgeNode';

vi.mock('#/modules/PluginHost/useCases', () => ({
    loadPlugin: vi.fn(),
    processAudioIPC: vi.fn(),
    setPluginParameter: vi.fn(),
    unloadPlugin: vi.fn(),
}));

function createPluginInstance(enginePluginId = 17) {
    return {
        instance_id: 'instance-1',
        plugin_id: 'plugin-1',
        name: 'Plugin',
        parameters: [],
        is_active: true,
        latency_samples: 0,
        engine_plugin_id: enginePluginId,
    };
}

function createDeferred<T>() {
    let resolveDeferred: ((value: T) => void) | undefined;
    const promise = new Promise<T>((resolve) => {
        resolveDeferred = resolve;
    });
    return {
        promise,
        resolve(value: T) {
            if (!resolveDeferred) {
                throw new Error('expected deferred resolver');
            }
            resolveDeferred(value);
        },
    };
}

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
    public static constructionError: Error | undefined;

    public readonly connect = vi.fn();
    public readonly disconnect = vi.fn();
    public readonly port = new FakeMessagePort();

    public constructor(
        public readonly context: AudioContext,
        public readonly name: string,
        public readonly options: AudioWorkletNodeOptions
    ) {
        if (FakeAudioWorkletNode.constructionError) {
            throw FakeAudioWorkletNode.constructionError;
        }
        FakeAudioWorkletNode.instances.push(this);
    }
}

class FakeAudioContext {}

function createAudioContext(): AudioContext {
    return new AudioContext();
}

function createReadyLifecycle(): ReturnType<typeof createNativePluginBridgeNode> {
    const controller = new AbortController();
    return createNativePluginBridgeNode({
        context: createAudioContext(),
        pluginId: 'plugin-1',
        instanceId: 'instance-1',
        signal: controller.signal,
    });
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
        FakeAudioWorkletNode.constructionError = undefined;
        vi.stubGlobal('AudioContext', FakeAudioContext);
        vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
        vi.clearAllMocks();
        vi.mocked(loadPlugin).mockResolvedValue(createPluginInstance());
        vi.mocked(unloadPlugin).mockResolvedValue();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('does not create the bridge before the native instance is ready', async () => {
        const nativeLoad = createDeferred<ReturnType<typeof createPluginInstance>>();
        vi.mocked(loadPlugin).mockReturnValue(nativeLoad.promise);
        const controller = new AbortController();

        const creation = createNativePluginBridgeNode({
            context: createAudioContext(),
            pluginId: 'plugin-1',
            instanceId: 'instance-1',
            signal: controller.signal,
        });
        await Promise.resolve();

        expect(loadPlugin).toHaveBeenCalledWith('plugin-1', 'instance-1');
        expect(FakeAudioWorkletNode.instances).toHaveLength(0);

        nativeLoad.resolve(createPluginInstance(23));
        await creation;

        expect(getCreatedNode().port.postMessage).toHaveBeenCalledWith({ type: 'init', enginePluginId: 23 });
    });

    it('serializes pending-load cancellation after native readiness without creating a late bridge', async () => {
        const nativeLoad = createDeferred<ReturnType<typeof createPluginInstance>>();
        vi.mocked(loadPlugin).mockReturnValue(nativeLoad.promise);
        const controller = new AbortController();
        const creation = createNativePluginBridgeNode({
            context: createAudioContext(),
            pluginId: 'plugin-1',
            instanceId: 'instance-1',
            signal: controller.signal,
        });

        controller.abort();
        nativeLoad.resolve(createPluginInstance());

        await expect(creation).rejects.toThrow();
        expect(unloadPlugin).toHaveBeenCalledWith('instance-1');
        expect(FakeAudioWorkletNode.instances).toHaveLength(0);
    });

    it('leaves no bridge or unload work when native loading rejects', async () => {
        vi.mocked(loadPlugin).mockRejectedValue(new Error('native load failed'));
        const controller = new AbortController();

        await expect(
            createNativePluginBridgeNode({
                context: createAudioContext(),
                pluginId: 'plugin-1',
                instanceId: 'instance-1',
                signal: controller.signal,
            })
        ).rejects.toThrow('native load failed');

        expect(FakeAudioWorkletNode.instances).toHaveLength(0);
        expect(unloadPlugin).not.toHaveBeenCalled();
    });

    it('unloads a ready native instance when bridge construction fails', async () => {
        FakeAudioWorkletNode.constructionError = new Error('bridge failed');
        const controller = new AbortController();

        await expect(
            createNativePluginBridgeNode({
                context: createAudioContext(),
                pluginId: 'plugin-1',
                instanceId: 'instance-1',
                signal: controller.signal,
            })
        ).rejects.toThrow('bridge failed');

        expect(unloadPlugin).toHaveBeenCalledWith('instance-1');
        expect(FakeAudioWorkletNode.instances).toHaveLength(0);
    });

    it('should initialize the worklet with the engine plugin id', async () => {
        await createReadyLifecycle();

        const node = getCreatedNode();
        expect(node.name).toBe('native-plugin-bridge-processor');
        expect(node.options).toEqual({
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: 'explicit',
        });
        expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'init', enginePluginId: 17 });
    });

    it('should delegate audio blocks through the Plugin use-case and post processed bytes', async () => {
        const processedBytes = new Uint8Array([9, 8, 7]);
        vi.mocked(processAudioIPC).mockResolvedValue(processedBytes);
        await createReadyLifecycle();
        const node = getCreatedNode();

        await dispatchProcessMessage(node, createAudioBuffer([1, 2, 3]));

        const input = vi.mocked(processAudioIPC).mock.calls[0]?.[0];
        expect(input?.enginePluginId).toBe(17);
        expect(Array.from(input?.audioBytes ?? [])).toEqual([1, 2, 3]);
        expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'processed', audio: processedBytes.buffer }, [
            processedBytes.buffer,
        ]);
    });

    it('should post exactly the processed byte view returned by the Plugin use-case', async () => {
        const backing = new Uint8Array([9, 9, 4, 5, 6]);
        vi.mocked(processAudioIPC).mockResolvedValue(backing.subarray(2));
        await createReadyLifecycle();
        const node = getCreatedNode();

        await dispatchProcessMessage(node, createAudioBuffer([1, 2, 3]));

        const postedMessage = node.port.postMessage.mock.calls[1]?.[0] as { audio?: ArrayBuffer };
        expect(Array.from(new Uint8Array(postedMessage.audio ?? new ArrayBuffer(0)))).toEqual([4, 5, 6]);
    });

    it('should not post processed audio when the Plugin use-case returns no bytes', async () => {
        vi.mocked(processAudioIPC).mockResolvedValue(null);
        await createReadyLifecycle();
        const node = getCreatedNode();

        await dispatchProcessMessage(node, createAudioBuffer([1, 2, 3]));

        expect(node.port.postMessage).toHaveBeenCalledTimes(1);
        expect(node.port.postMessage).toHaveBeenCalledWith({ type: 'init', enginePluginId: 17 });
    });

    it('should keep one audio block in flight and drop blocks while pending', async () => {
        const processing = { resolve: undefined as ((bytes: Uint8Array) => void) | undefined };
        vi.mocked(processAudioIPC).mockReturnValue(
            new Promise((resolve) => {
                processing.resolve = resolve;
            })
        );
        await createReadyLifecycle();
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
        await createReadyLifecycle();
        const node = getCreatedNode();

        await dispatchProcessMessage(node, createAudioBuffer([1]));
        await dispatchProcessMessage(node, createAudioBuffer([2]));

        expect(processAudioIPC).toHaveBeenCalledTimes(2);
    });

    it('should delegate parameter updates through the Plugin use-case and swallow failures', async () => {
        vi.mocked(setPluginParameter).mockRejectedValue(new Error('native failed'));
        const result = await createReadyLifecycle();

        await result.setParam(9, 0.25);

        expect(setPluginParameter).toHaveBeenCalledWith({
            instanceId: 'instance-1',
            paramId: 9,
            value: 0.25,
        });
        await result.destroy();
        await result.destroy();
        expect(unloadPlugin).toHaveBeenCalledTimes(1);
    });
});
