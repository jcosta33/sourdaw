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

import { logger } from '#/infra/logger/appLogger';
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

    // Bypass is the one control here the WebAudio chain cannot cover for.
    // Engaging it is safe to lose: the rebuild unroutes this worklet anyway.
    // Releasing it is not — the rebuild puts the device back in the path
    // unconditionally, so a refused `set_plugin_bypass` leaves the native
    // effect bypassed underneath a device the rack shows as enabled, and
    // every block drains as passthrough for as long as the instance lives.
    // Nothing else re-asserts native bypass state, so the last requested
    // value is held here until the native side confirms it, and re-sent on
    // each completed round trip until it does.
    //
    // Two properties keep that loop honest. Sends are totally ordered — one
    // outstanding at a time, later ones queued behind it — because
    // `set_plugin_bypass` waits on the engine mutex and two concurrent sends
    // can reach the graph in either order, leaving the native side holding the
    // older value. And only the newest send may record confirmation: an
    // identical value sent earlier resolving proves nothing about the request
    // standing now, so counting it would confirm a value the native graph does
    // not hold and retire the re-assertion for good.
    //
    // The single-flight rule is also what keeps the loop cheap. A plugin load
    // holds the engine mutex for hundreds of milliseconds while audio round
    // trips keep completing on a different lock, so a re-send per round trip
    // would bank up one mutex-blocked task per audio block.
    let requestedBypass: boolean | null = null;
    let bypassConfirmed = false;
    let bypassRefusalLogged = false;
    let bypassSeq = 0;
    let bypassInFlight = false;
    let lastBypassSend: Promise<void> = Promise.resolve();

    function dispatchBypass(bypassed: boolean, seq: number): Promise<void> {
        return setPluginBypass({ instanceId, bypassed })
            .then(() => {
                if (seq === bypassSeq) {
                    bypassConfirmed = true;
                }
            })
            .catch((error: unknown) => {
                // One warning per refused request, not one per re-send: the
                // re-send runs at audio round-trip rate.
                if (!bypassRefusalLogged) {
                    bypassRefusalLogged = true;
                    logger.warn(
                        `[WebAudioEngine] Native plugin bypass (${String(bypassed)}) refused, re-asserting: ${String(error)}`
                    );
                }
            })
            .then(() => {
                // Only the last link of the chain reopens the gate; a settled
                // send with a successor behind it hands the flight straight on.
                if (seq === bypassSeq) {
                    bypassInFlight = false;
                }
            });
    }

    function sendBypass(bypassed: boolean): void {
        const seq = ++bypassSeq;
        if (bypassInFlight) {
            lastBypassSend = lastBypassSend.then(() => dispatchBypass(bypassed, seq));
            return;
        }
        bypassInFlight = true;
        lastBypassSend = dispatchBypass(bypassed, seq);
    }

    function reassertBypassIfUnconfirmed(): void {
        if (requestedBypass === null || bypassConfirmed || bypassInFlight) {
            return;
        }
        sendBypass(requestedBypass);
    }

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

            // The host answered, so the command path to this instance is up.
            // If its bypass state was never confirmed, this is the moment to
            // put it right — before the next block drains through it.
            reassertBypassIfUnconfirmed();

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
            }).catch((error: unknown) => {
                logger.warn(`[WebAudioEngine] Native plugin parameter ${paramId} was refused: ${String(error)}`);
            });
        },
        setBypass(bypassed: boolean) {
            // The chain rebuild that follows unroutes this worklet, but not
            // until the next rebuild tick, and blocks already in flight would
            // still come back processed. Telling the native graph directly
            // makes the bypass take effect on the audio thread immediately,
            // and stops MIDI queued while bypassed from banking up into a
            // burst of stale note-ons when it is released. A toggle thrown
            // while a send is still out is never dropped: it goes out the
            // moment that one settles, and its value is the one that stands.
            requestedBypass = bypassed;
            bypassConfirmed = false;
            bypassRefusalLogged = false;
            sendBypass(bypassed);
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
