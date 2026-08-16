/**
 * NativePluginBridgeNode — relays Web Audio blocks to the Rust plugin host and
 * back, over a MessagePort hop plus Tauri IPC.
 *
 * Audio crosses as raw IEEE 754 little-endian interleaved pairs, not JSON
 * numbers.
 *
 * The worklet owns a small pool of transfer buffers. Each one it sends must come
 * back, so this relay always returns the buffer it was given — carrying the
 * processed audio when the round trip produced some, empty when it did not.
 * Failing to return one permanently shrinks the pool and starves the bridge.
 *
 * Backpressure: only one round trip is in flight at a time. A block that arrives
 * while one is pending is dropped and counted in the shared dropout tally; its
 * buffer goes straight back so the pool stays whole. The worklet keeps emitting
 * the last processed block, so a drop is a stale block rather than a hole.
 */

import { processAudioIPC, setPluginBypass, setPluginParameter } from '#/modules/PluginHost/useCases';

import { DROPOUT_IDX, dropoutCounters } from './dropoutCounter';

export type NativePluginBridgeResult = {
    workletNode: AudioWorkletNode;
    setParam: (paramId: number, value: number) => void;
    setBypass: (bypassed: boolean) => void;
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

    const dropoutSab = dropoutCounters.getSab();
    const dropoutView = dropoutSab ? new Int32Array(dropoutSab) : null;

    // The worklet needs no plugin identity: the relay resolves the instance on
    // the main thread. Init tells the processor it may start relaying, and hands
    // it the tally it writes its own dropped blocks into.
    node.port.postMessage({ type: 'init', dropoutSab });

    // Backpressure: only one IPC round-trip in flight at a time.
    let pendingBlock = false;

    type WorkletMessage = { type: string; audio?: ArrayBuffer };

    function countDroppedBlock(): void {
        if (dropoutView) {
            Atomics.add(dropoutView, DROPOUT_IDX.bridgeDroppedBlocks, 1);
        }
    }

    function returnBuffer(type: 'processed' | 'recycle', buffer: ArrayBuffer): void {
        node.port.postMessage({ type, audio: buffer }, [buffer]);
    }

    // Relay audio between worklet and Rust
    node.port.onmessage = async (event: MessageEvent<WorkletMessage>) => {
        if (event.data.type !== 'process') {
            return;
        }

        const audioBuffer = event.data.audio;
        if (!audioBuffer) {
            return;
        }

        if (pendingBlock) {
            // Previous round trip still out. Give the buffer back before
            // dropping, or the pool shrinks by one every time this happens.
            countDroppedBlock();
            returnBuffer('recycle', audioBuffer);
            return;
        }

        pendingBlock = true;

        try {
            const resultBytes = await processAudioIPC({
                instanceId,
                audioBytes: new Uint8Array(audioBuffer),
            });

            if (resultBytes) {
                // Write the reply into the worklet's own buffer and hand that
                // same backing store back, so nothing new is allocated per block.
                const target = new Uint8Array(audioBuffer);
                target.set(resultBytes.subarray(0, Math.min(resultBytes.length, target.length)));
                returnBuffer('processed', audioBuffer);
                return;
            }

            returnBuffer('recycle', audioBuffer);
        } catch {
            // Rust processing failed; the worklet keeps emitting its last block.
            returnBuffer('recycle', audioBuffer);
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
        setBypass(bypassed: boolean) {
            // The chain rebuild that follows unroutes this worklet, but not
            // until the next rebuild tick, and blocks already in flight would
            // still come back processed. Telling the native graph directly
            // makes the bypass take effect on the audio thread immediately,
            // and stops MIDI queued while bypassed from banking up into a
            // burst of stale note-ons when it is released.
            void setPluginBypass({ instanceId, bypassed }).catch(() => {});
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
