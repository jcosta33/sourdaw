/**
 * YeastWorkletNode — AudioWorkletNode wrapper for the Yeast MIDI rack.
 *
 * Creates an AudioWorkletNode that hosts MidiRack + all processors in the
 * audio thread. Provides an async `processBlock()` that returns transformed
 * MIDI events; caller supplies `requestId` correlation internally.
 *
 * Mirrors add/remove/setParam/setBypass to the worklet so the audio-thread
 * rack stays in sync with the main-thread rack (UI state tracker).
 */

import type { MidiEvent, TransportInfo } from '../models/MidiEvent';
import type { ProcessorType } from '../useCases/processorFactory';
import yeastWorkletProcessorUrl from '../services/yeastWorkletProcessor.ts?worker&url';

const workletRegistrations = new WeakMap<BaseAudioContext, Promise<void>>();

async function ensureWorkletRegistered(ctx: BaseAudioContext): Promise<void> {
    let p = workletRegistrations.get(ctx);
    if (!p) {
        p = ctx.audioWorklet.addModule(yeastWorkletProcessorUrl);
        workletRegistrations.set(ctx, p);
    }
    return p;
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
    setParam: (processorId: string, name: string, value: number) => void;
    setBypass: (processorId: string, bypassed: boolean) => void;
    allNotesOff: (nowSamples: number) => void;
    destroy: () => void;
};

export async function createYeastWorkletNode(ctx: BaseAudioContext): Promise<YeastWorkletNodeResult> {
    await ensureWorkletRegistered(ctx);

    const node = new AudioWorkletNode(ctx, 'yeast-worklet-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 0,
    });

    let nextRequestId = 0;
    const pending = new Map<number, { resolve: (events: MidiEvent[]) => void; reject: (err: Error) => void }>();

    node.port.onmessage = (e: MessageEvent): void => {
        const msg = e.data as { type: string; requestId?: number; events?: MidiEvent[] };
        if (msg.type === 'processed' && msg.requestId !== undefined) {
            const p = pending.get(msg.requestId);
            if (p) {
                pending.delete(msg.requestId);
                p.resolve(msg.events ?? []);
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
            pending.set(requestId, { resolve, reject });
            node.port.postMessage({ type: 'processBlock', requestId, events, blockStart, blockEnd, transport });
        });

    return {
        context: ctx,
        processBlock,
        addProcessor: (processorType, processorId) =>
            node.port.postMessage({ type: 'addProcessor', processorType, processorId }),
        removeProcessor: (processorId) => node.port.postMessage({ type: 'removeProcessor', processorId }),
        setParam: (processorId, name, value) => node.port.postMessage({ type: 'setParam', processorId, name, value }),
        setBypass: (processorId, bypassed) => node.port.postMessage({ type: 'setBypass', processorId, bypassed }),
        allNotesOff: (nowSamples) => node.port.postMessage({ type: 'allNotesOff', nowSamples }),
        destroy: () => {
            node.port.close();
            try {
                node.disconnect();
            } catch {
                /* already disconnected */
            }
        },
    };
}
