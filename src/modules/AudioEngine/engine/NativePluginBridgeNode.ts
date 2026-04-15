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

import { tauriInvoke, isTauri } from '#/utils/tauriBridge';

export type NativePluginBridgeResult = {
    workletNode: AudioWorkletNode;
    setParam: (paramId: number, value: number) => void;
    setBypass: (_bypassed: boolean) => void;
    destroy: () => void;
};

export async function createNativePluginBridgeNode(
    ctx: AudioContext,
    instanceId: string,
    enginePluginId: number
): Promise<NativePluginBridgeResult> {
    const node = new AudioWorkletNode(ctx, 'native-plugin-bridge-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    // Initialize the worklet with the engine plugin ID
    node.port.postMessage({ type: 'init', enginePluginId });

    // Backpressure: only one IPC round-trip in flight at a time.
    let pendingBlock = false;

    // Relay audio between worklet and Rust
    node.port.onmessage = async (event: MessageEvent) => {
        if (event.data.type === 'process' && isTauri()) {
            if (pendingBlock) {return;} // Drop block — previous round-trip still in flight
            pendingBlock = true;

            const audioBuffer = event.data.audio as ArrayBuffer;

            try {
                const resultBytes = (await tauriInvoke('process_plugin_audio', {
                    enginePluginId,
                    audioBytes: new Uint8Array(audioBuffer),
                })) as Uint8Array;

                // resultBytes is already a Uint8Array (binary IPC), so we can use its buffer directly.
                node.port.postMessage({ type: 'processed', audio: resultBytes.buffer }, [resultBytes.buffer]);
            } catch {
                // If Rust processing fails, the worklet falls back to passthrough
            } finally {
                pendingBlock = false;
            }
        }
    };

    return {
        workletNode: node,
        setParam(paramId: number, value: number) {
            if (isTauri()) {
                tauriInvoke('set_plugin_parameter', {
                    instanceId,
                    paramId,
                    value,
                }).catch(() => {});
            }
        },
        setBypass(_bypassed: boolean) {
            // TODO: Send bypass command to native engine
        },
        destroy() {
            try {
                node.disconnect();
            } catch {}
            node.port.close();
        },
    };
}
