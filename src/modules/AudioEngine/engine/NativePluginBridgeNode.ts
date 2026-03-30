/**
 * NativePluginBridgeNode — bridges Web Audio ↔ Rust native audio thread
 * via a ring-buffer and Tauri IPC.
 *
 * The worklet sends audio blocks to the main thread via MessagePort.
 * The main thread forwards to Rust via process_plugin_audio (which uses
 * a lock-free ring buffer to communicate with the cpal audio thread).
 * Processed output comes back the same way.
 *
 * Latency: 1 audio block (128 samples ≈ 2.67ms at 48kHz).
 */

import { tauriInvoke, isTauri } from '#/helpers/tauriBridge';

export type NativePluginBridgeResult = {
    workletNode: AudioWorkletNode;
    setParam: (paramId: number, value: number) => void;
    setBypass: (_bypassed: boolean) => void;
    destroy: () => void;
};

export async function createNativePluginBridgeNode(
    ctx: AudioContext,
    instanceId: string,
    enginePluginId: number,
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

    // Relay audio between worklet and Rust
    node.port.onmessage = async (event: MessageEvent) => {
        if (event.data.type === 'process' && isTauri()) {
            const audioBuffer = event.data.audio;
            const audioData = new Float32Array(audioBuffer);

            try {
                const processed = await tauriInvoke('process_plugin_audio', {
                    enginePluginId,
                    audioData: Array.from(audioData),
                }) as number[];

                // Send processed audio back to worklet
                const resultArray = new Float32Array(processed);
                node.port.postMessage(
                    { type: 'processed', audio: resultArray.buffer },
                    [resultArray.buffer],
                );
            } catch {
                // If Rust processing fails, the worklet falls back to passthrough
            }
        }
    };

    return {
        workletNode: node,
        setParam(paramId: number, value: number) {
            if (isTauri()) {
                void tauriInvoke('set_plugin_parameter', {
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
            try { node.disconnect(); } catch {}
            node.port.close();
        },
    };
}
