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

import { processAudioIPC, setPluginParameter } from '#/modules/PluginHost/useCases';

export type NativePluginBridgeResult = {
    workletNode: AudioWorkletNode;
    setParam: (paramId: number, value: number) => void;
    setBypass: (_bypassed: boolean) => void;
    destroy: () => void;
};

// eslint-disable-next-line @typescript-eslint/require-await -- async API contract; callers use .then(); will await node initialization once native bridge handshake is implemented
export async function createNativePluginBridgeNode(
    ctx: AudioContext,
    instanceId: string
): Promise<NativePluginBridgeResult> {
    const node = new AudioWorkletNode(ctx, 'native-plugin-bridge-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    // The worklet needs no plugin identity: the relay resolves the instance on
    // the main thread. Init only tells the processor it may start relaying.
    node.port.postMessage({ type: 'init' });

    // Backpressure: only one IPC round-trip in flight at a time.
    let pendingBlock = false;

    type WorkletMessage = { type: string; audio?: ArrayBuffer };

    // Relay audio between worklet and Rust
    node.port.onmessage = async (event: MessageEvent<WorkletMessage>) => {
        if (event.data.type !== 'process') {
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
                instanceId,
                audioBytes: new Uint8Array(audioBuffer),
            });

            if (resultBytes) {
                const processedBuffer = new Uint8Array(resultBytes).buffer;
                node.port.postMessage({ type: 'processed', audio: processedBuffer }, [processedBuffer]);
            }
        } catch {
            // If Rust processing fails, the worklet falls back to passthrough
        } finally {
            pendingBlock = false;
        }
    };

    return {
        workletNode: node,
        setParam(paramId: number, value: number) {
            void setPluginParameter({
                instanceId,
                paramId,
                value,
            }).catch(() => {});
        },
        setBypass(_bypassed: boolean) {
            // TODO: Send bypass command to native engine
        },
        destroy() {
            try {
                node.disconnect();
            } catch {
                // ignore
            }
            node.port.close();
        },
    };
}
