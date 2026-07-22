/**
 * NativePluginBridgeNode — bridges Web Audio ↔ Rust native audio thread
 * via a ring buffer and Tauri IPC.
 *
 * Audio data is transferred as raw IEEE 754 little-endian bytes (Uint8Array)
 * rather than JSON number arrays, reducing IPC payload size ~4×.
 *
 * Backpressure: if the previous IPC round-trip hasn't completed when the next
 * block arrives, the new block is dropped. The ring buffer on the Rust side
 * (8 blocks deep) absorbs transient delays; the worklet outputs the most
 * recent available block in the meantime.
 */

import { loadPlugin, processAudioIPC, setPluginParameter, unloadPlugin } from '#/modules/PluginHost/useCases';

export type CreateNativePluginBridgeNodeInput = {
    context: AudioContext;
    pluginId: string;
    instanceId: string;
    signal: AbortSignal;
};

export type NativePluginBridgeResult = {
    workletNode: AudioWorkletNode;
    setParam: (paramId: number, value: number) => Promise<void>;
    setBypass: (_bypassed: boolean) => void;
    destroy: () => Promise<void>;
};

export async function createNativePluginBridgeNode(
    input: CreateNativePluginBridgeNodeInput
): Promise<NativePluginBridgeResult> {
    const { context, pluginId, instanceId, signal } = input;
    let unloadPromise: Promise<void> | null = null;

    function unloadNativeOnce(): Promise<void> {
        if (!unloadPromise) {
            unloadPromise = unloadPlugin(instanceId);
        }
        return unloadPromise;
    }

    const pluginInstance = await loadPlugin(pluginId, instanceId);
    if (signal.aborted) {
        await unloadNativeOnce();
        throw new Error(`Native plugin lifecycle cancelled: ${instanceId}`);
    }

    const enginePluginId = pluginInstance.engine_plugin_id;
    if (enginePluginId === null) {
        await unloadNativeOnce();
        throw new Error(`Native plugin has no engine bridge id: ${instanceId}`);
    }

    let node: AudioWorkletNode;
    try {
        node = new AudioWorkletNode(context, 'native-plugin-bridge-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: 'explicit',
        });
    } catch (error) {
        await unloadNativeOnce();
        throw error;
    }

    let bridgeDisconnected = false;
    function disconnectBridge(): void {
        if (bridgeDisconnected) {
            return;
        }
        bridgeDisconnected = true;
        try {
            node.disconnect();
        } catch {
            // A bridge can already be detached by graph teardown.
        }
        node.port.close();
    }

    try {
        node.port.postMessage({ type: 'init', enginePluginId });
    } catch (error) {
        disconnectBridge();
        await unloadNativeOnce();
        throw error;
    }

    // Backpressure: only one IPC round-trip in flight at a time.
    let pendingBlock = false;
    let destroyed = false;
    let destroyPromise: Promise<void> | null = null;
    const pendingParameterWrites = new Set<Promise<void>>();

    type WorkletMessage = { type: string; audio?: ArrayBuffer };

    // Relay audio between worklet and Rust
    node.port.onmessage = async (event: MessageEvent<WorkletMessage>) => {
        if (destroyed || event.data.type !== 'process') {
            return;
        }

        if (pendingBlock) {
            return;
        } // Drop block — previous round-trip still in flight

        const audioBuffer = event.data.audio;
        if (!audioBuffer) {
            return;
        }

        pendingBlock = true;

        try {
            const resultBytes = await processAudioIPC({
                enginePluginId,
                audioBytes: new Uint8Array(audioBuffer),
            });

            if (resultBytes && !destroyed) {
                const processedBuffer = new Uint8Array(resultBytes).buffer;
                node.port.postMessage({ type: 'processed', audio: processedBuffer }, [processedBuffer]);
            }
        } catch {
            // If Rust processing fails, the worklet falls back to passthrough
        } finally {
            pendingBlock = false;
        }
    };

    function setParam(paramId: number, value: number): Promise<void> {
        if (destroyed) {
            return Promise.resolve();
        }
        const write = setPluginParameter({ instanceId, paramId, value }).catch(() => {});
        pendingParameterWrites.add(write);
        void write.then(() => pendingParameterWrites.delete(write));
        return write;
    }

    function destroy(): Promise<void> {
        if (destroyPromise) {
            return destroyPromise;
        }
        destroyed = true;
        signal.removeEventListener('abort', handleAbort);
        disconnectBridge();
        destroyPromise = Promise.allSettled(Array.from(pendingParameterWrites)).then(() => unloadNativeOnce());
        return destroyPromise;
    }

    function handleAbort(): void {
        void destroy().catch(() => {});
    }

    signal.addEventListener('abort', handleAbort, { once: true });

    return {
        workletNode: node,
        setParam,
        setBypass(_bypassed: boolean) {
            // TODO: Send bypass command to native engine
        },
        destroy,
    };
}
