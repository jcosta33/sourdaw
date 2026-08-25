/**
 * CrumbsRecordFeedNode — main-thread half of the monitored-input record feed.
 *
 * The worklet (`crumbsRecordFeedProcessor.ts`) taps the monitored input bus
 * once per render quantum and hands the interleaved block over the
 * MessagePort; this wrapper forwards it to the native record feed command and
 * returns the spent buffer to the worklet's pool. The native dispatch is
 * injected by the creator rather than imported, so this engine file keeps no
 * edge into the repositories — the same seam `NativePluginBridgeNode` uses
 * for its use-case calls, pointed the other way.
 *
 * Backpressure and ordering mirror the plugin relay: sends are chained so
 * blocks reach Rust in the order they were rendered (concurrent dispatches
 * could reorder them, and a reordered take is a scrambled one), and the
 * worklet's four-buffer pool is what bounds how far ahead of the drain the
 * feed may run — a block that finds no free buffer is dropped and counted on
 * the worklet side, never silently reordered here.
 */

import { ensureWorkletRegistered } from '#/infra/audioWorklet/workletInitShared';
import { logger } from '#/infra/logger/appLogger';

import crumbsRecordFeedProcessorUrl from '../services/crumbsRecordFeedProcessor.ts?worker&url';

/** One block handed to the native record feed, as interleaved LE f32 bytes. */
export type CrumbsRecordFeedDispatch = (audioBytes: Uint8Array) => Promise<void>;

export type CrumbsRecordFeedHandle = {
    workletNode: AudioWorkletNode;
    attachTo: (source: AudioNode) => void;
    destroy: () => void;
};

type FeedMessage = { type: 'feed'; audio: ArrayBuffer; dropped: number };

/** Only full-quantum buffers belong to the worklet's transfer pool. */
const POOLED_BUFFER_BYTES = 128 * 8;

export async function createCrumbsRecordFeedNode(
    ctx: BaseAudioContext,
    dispatch: CrumbsRecordFeedDispatch
): Promise<CrumbsRecordFeedHandle> {
    await ensureWorkletRegistered(ctx, crumbsRecordFeedProcessorUrl);
    const node = new AudioWorkletNode(ctx, 'crumbs-record-feed-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
    });

    // The arm gate lives in the worklet: nothing crosses the port, and no
    // IPC round trip happens, until this message — and 'disarm' on destroy
    // stops the flow without waiting for the node to be collected.
    node.port.postMessage({ type: 'arm' });

    let destroyed = false;
    let lastReportedDropped = -1;
    // Chained sends: strictly ordered, and never more than one dispatch
    // resolving at a time, so a slow IPC cannot reorder the take.
    let pendingSend: Promise<void> = Promise.resolve();

    const recycle = (audio: ArrayBuffer): void => {
        if (!destroyed && audio.byteLength === POOLED_BUFFER_BYTES) {
            node.port.postMessage({ type: 'recycle', audio }, [audio]);
        }
    };

    node.port.onmessage = (event: MessageEvent<FeedMessage>) => {
        if (destroyed || event.data.type !== 'feed') {
            return;
        }
        if (event.data.dropped > lastReportedDropped) {
            // A hole in the armed take: the worklet ran out of pooled buffers
            // behind a slow dispatch. Logged once per new count, not per
            // block, for the same reason the plugin relay latches failures.
            lastReportedDropped = event.data.dropped;
            logger.warn(
                `[CrumbsRecordFeed] dropped ${event.data.dropped} monitored block(s) behind a slow record feed`
            );
        }
        const bytes = new Uint8Array(event.data.audio);
        pendingSend = pendingSend
            .then(() => (destroyed ? undefined : dispatch(bytes)))
            .catch((error: unknown) => {
                logger.warn(`[CrumbsRecordFeed] record feed block refused: ${String(error)}`);
            })
            .then(() => recycle(event.data.audio));
    };

    return {
        workletNode: node,
        attachTo(source: AudioNode): void {
            source.connect(node);
        },
        destroy(): void {
            if (destroyed) {
                return;
            }
            destroyed = true;
            node.port.postMessage({ type: 'disarm' });
            node.port.onmessage = null;
            try {
                node.disconnect();
            } catch {
                // The graph may already be torn down around us.
            }
            node.port.close();
        },
    };
}
