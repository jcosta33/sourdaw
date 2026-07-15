/**
 * YeastWorkletNode — AudioWorkletNode wrapper for the Yeast MIDI rack.
 *
 * Creates an AudioWorkletNode that hosts MidiRack + all processors in the
 * audio thread. Provides an async `processBlock()` that returns transformed
 * MIDI events; caller supplies `requestId` correlation internally.
 *
 * Mirrors add/remove/reorder/setParam/setBypass to the worklet so the
 * audio-thread rack stays in sync with the main-thread rack (UI state tracker).
 */

import yeastWorkletProcessorUrl from './yeastWorkletProcessor.ts?worker&url';

import type { MidiEvent, TransportInfo } from '../models/MidiEvent';
import type { ProcessorType } from '../useCases/processorFactory';

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
    addProcessor: (processorType: ProcessorType, processorId: string) => void;
    removeProcessor: (processorId: string) => void;
    reorder: (fromIdx: number, toIdx: number) => void;
    setParam: (processorId: string, name: string, value: number) => void;
    setBypass: (processorId: string, bypassed: boolean) => void;
    allNotesOff: (nowSamples: number) => void;
    /**
     * Register a listener for the Note Offs a `removeProcessor` left hanging in
     * the worklet rack. The worklet computes them on the audio thread and posts
     * them back here; without a listener routing them to the live instrument,
     * the note hangs. Returns an unsubscribe function. Multiple listeners are
     * supported (last-registered are all notified).
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
        addProcessor: (processorType, processorId) =>
            node.port.postMessage({ type: 'addProcessor', processorType, processorId }),
        removeProcessor: (processorId) => node.port.postMessage({ type: 'removeProcessor', processorId }),
        reorder: (fromIdx, toIdx) => node.port.postMessage({ type: 'reorder', fromIdx, toIdx }),
        setParam: (processorId, name, value) => node.port.postMessage({ type: 'setParam', processorId, name, value }),
        setBypass: (processorId, bypassed) => node.port.postMessage({ type: 'setBypass', processorId, bypassed }),
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
