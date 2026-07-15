/**
 * YeastWorkletNode — AudioWorkletNode wrapper for the Yeast MIDI rack.
 *
 * Creates an AudioWorkletNode that hosts MidiRack + all processors in the
 * audio thread. Provides an async `processBlock()` that returns transformed
 * MIDI events; caller supplies `requestId` correlation internally.
 *
 * Sends the serializable processor projection to the worklet. The worklet owns
 * the rack and processor instances; this wrapper owns only the port protocol.
 */

import yeastWorkletProcessorUrl from '../worklets/yeastWorkletProcessor.ts?worker&url';

import type { MidiEvent, TransportInfo } from '../models/MidiEvent';
import type { YeastProcessorProjectionItem } from '../models/YeastProcessorProjection';

const workletRegistrations = new WeakMap<BaseAudioContext, Promise<void>>();

/**
 * Upper bound on how long a `processBlock` round-trip may wait for the
 * worklet's `processed` reply before the pending Promise is rejected. Without
 * a bound, a single dropped reply (crashed processor, lost message) leaks an
 * unresolved Promise — and any caller awaiting it — for the lifetime of the
 * page.
 */
const PROCESS_BLOCK_TIMEOUT_MS = 5000;

async function ensureWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
    let param = workletRegistrations.get(ctx);
    if (!param) {
        // Evict the cached promise if addModule rejects (CSP/network/syntax)
        // so a later call retries instead of replaying the same rejection.
        // Without this, a single transient failure leaves the worklet path
        // dead until a full page reload.
        param = ctx.audioWorklet.addModule(yeastWorkletProcessorUrl).catch((error: unknown) => {
            if (workletRegistrations.get(ctx) === param) {
                workletRegistrations.delete(ctx);
            }
            throw error;
        });
        workletRegistrations.set(ctx, param);
    }
    return param;
}

export type YeastWorkletNodeResult = {
    context: BaseAudioContext;
    processBlock: (
        events: readonly MidiEvent[],
        blockStart: number,
        blockEnd: number,
        transport: TransportInfo
    ) => Promise<MidiEvent[]>;
    setProjection: (projection: readonly YeastProcessorProjectionItem[]) => void;
    allNotesOff: (nowSamples: number) => void;
    /**
     * Register a listener for Note Offs a projection change left hanging in the
     * worklet rack. The worklet computes them and posts them back here; without
     * routing them to the live instrument, the note hangs. Returns an
     * unsubscribe function. Multiple listeners are supported.
     */
    onNotesOff: (handler: (notes: number[]) => void) => () => void;
    destroy: () => void;
};

export async function createYeastWorkletNode(ctx: BaseAudioContext): Promise<YeastWorkletNodeResult> {
    await ensureWorkletRegistered(ctx);

    const node = new AudioWorkletNode(ctx, 'yeast-worklet-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 0,
    });

    let nextRequestId = 0;
    type PendingEntry = {
        resolve: (events: MidiEvent[]) => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    };
    const pending = new Map<number, PendingEntry>();

    const settle = (requestId: number): PendingEntry | undefined => {
        const entry = pending.get(requestId);
        if (entry) {
            pending.delete(requestId);
            clearTimeout(entry.timer);
        }
        return entry;
    };

    const notesOffHandlers = new Set<(notes: number[]) => void>();

    node.port.onmessage = (event: MessageEvent): void => {
        const msg = event.data as { type: string; requestId?: number; events?: MidiEvent[] };
        if (msg.type === 'processed' && msg.requestId !== undefined) {
            settle(msg.requestId)?.resolve(msg.events ?? []);
            return;
        }
        if (msg.type === 'notesOff') {
            const notes: number[] = [];
            for (const evt of msg.events ?? []) {
                if (evt.kind.type === 'noteOff') {
                    notes.push(evt.kind.note);
                }
            }
            if (notes.length > 0) {
                for (const handler of notesOffHandlers) {
                    handler(notes);
                }
            }
        }
    };

    const processBlock = (
        events: readonly MidiEvent[],
        blockStart: number,
        blockEnd: number,
        transport: TransportInfo
    ): Promise<MidiEvent[]> =>
        new Promise((resolve, reject) => {
            const requestId = nextRequestId++;
            // Reject if the worklet never replies (dropped 'processed' message,
            // crashed processor) so the Promise can't leak forever.
            const timer = setTimeout(() => {
                if (settle(requestId)) {
                    reject(new Error(`YeastWorkletNode.processBlock timed out (requestId ${requestId})`));
                }
            }, PROCESS_BLOCK_TIMEOUT_MS);
            pending.set(requestId, { resolve, reject, timer });
            node.port.postMessage({ type: 'processBlock', requestId, events, blockStart, blockEnd, transport });
        });

    return {
        context: ctx,
        processBlock,
        setProjection: (projection) =>
            node.port.postMessage({
                type: 'setProjection',
                processors: projection.map((processor) => ({
                    ...processor,
                    params: { ...processor.params },
                })),
            }),
        allNotesOff: (nowSamples) => node.port.postMessage({ type: 'allNotesOff', nowSamples }),
        onNotesOff: (handler) => {
            notesOffHandlers.add(handler);
            return () => {
                notesOffHandlers.delete(handler);
            };
        },
        destroy: () => {
            node.port.close();
            // The port is closed; no 'processed' reply can ever arrive. Reject
            // and clear every in-flight request so awaiting callers fail fast
            // instead of hanging on a Promise that can never settle.
            for (const requestId of [...pending.keys()]) {
                settle(requestId)?.reject(new Error('YeastWorkletNode destroyed before processBlock completed'));
            }
            try {
                node.disconnect();
            } catch {
                /* already disconnected */
            }
        },
    };
}
