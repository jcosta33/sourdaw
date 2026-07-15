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
import type { YeastProcessorCommand } from '../models/YeastProcessorCommand';
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
const COMMAND_ACK_TIMEOUT_MS = 1000;

type YeastCommandAck = {
    accepted: boolean;
    error?: string;
};

type YeastPortMessage =
    | { type: 'processed'; requestId: number; events?: MidiEvent[] }
    | { type: 'commandAck'; commandId: number; accepted: boolean; error?: string }
    | { type: 'notesOff'; events?: MidiEvent[] };

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

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
    sendCommand: (command: YeastProcessorCommand) => Promise<YeastCommandAck>;
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
    let nextCommandId = 0;
    let destroyed = false;
    type PendingEntry = {
        resolve: (events: MidiEvent[]) => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    };
    const pending = new Map<number, PendingEntry>();
    type PendingCommandEntry = {
        resolve: (ack: YeastCommandAck) => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    };
    const pendingCommands = new Map<number, PendingCommandEntry>();

    const settle = (requestId: number): PendingEntry | undefined => {
        const entry = pending.get(requestId);
        if (entry) {
            pending.delete(requestId);
            clearTimeout(entry.timer);
        }
        return entry;
    };

    const settleCommand = (commandId: number): PendingCommandEntry | undefined => {
        const entry = pendingCommands.get(commandId);
        if (entry) {
            pendingCommands.delete(commandId);
            clearTimeout(entry.timer);
        }
        return entry;
    };

    const notesOffHandlers = new Set<(notes: number[]) => void>();

    node.port.onmessage = (event: MessageEvent): void => {
        const msg = event.data as YeastPortMessage;
        if (msg.type === 'processed') {
            settle(msg.requestId)?.resolve(msg.events ?? []);
            return;
        }
        if (msg.type === 'commandAck') {
            const ack: YeastCommandAck =
                msg.error === undefined ? { accepted: msg.accepted } : { accepted: msg.accepted, error: msg.error };
            settleCommand(msg.commandId)?.resolve(ack);
            return;
        }
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
    };

    const processBlock = (
        events: readonly MidiEvent[],
        blockStart: number,
        blockEnd: number,
        transport: TransportInfo
    ): Promise<MidiEvent[]> =>
        new Promise((resolve, reject) => {
            if (destroyed) {
                reject(new Error('YeastWorkletNode is destroyed'));
                return;
            }
            const requestId = nextRequestId++;
            // Reject if the worklet never replies (dropped 'processed' message,
            // crashed processor) so the Promise can't leak forever.
            const timer = setTimeout(() => {
                if (settle(requestId)) {
                    reject(new Error(`YeastWorkletNode.processBlock timed out (requestId ${requestId})`));
                }
            }, PROCESS_BLOCK_TIMEOUT_MS);
            pending.set(requestId, { resolve, reject, timer });
            try {
                node.port.postMessage({ type: 'processBlock', requestId, events, blockStart, blockEnd, transport });
            } catch (error: unknown) {
                settle(requestId)?.reject(toError(error));
            }
        });

    const sendCommand = (command: YeastProcessorCommand): Promise<YeastCommandAck> =>
        new Promise((resolve, reject) => {
            if (destroyed) {
                reject(new Error('YeastWorkletNode is destroyed'));
                return;
            }

            const commandId = nextCommandId++;
            const timer = setTimeout(() => {
                if (settleCommand(commandId)) {
                    reject(new Error(`YeastWorkletNode command acknowledgement timed out (commandId ${commandId})`));
                }
            }, COMMAND_ACK_TIMEOUT_MS);
            pendingCommands.set(commandId, { resolve, reject, timer });
            try {
                node.port.postMessage({ type: 'executeCommand', commandId, command });
            } catch (error: unknown) {
                settleCommand(commandId)?.reject(toError(error));
            }
        });

    return {
        context: ctx,
        processBlock,
        sendCommand,
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
            if (destroyed) {
                return;
            }
            destroyed = true;
            // The port is closed; no 'processed' reply can ever arrive. Reject
            // and clear every in-flight request and command so awaiting callers
            // fail fast instead of hanging on Promises that can never settle.
            for (const requestId of [...pending.keys()]) {
                settle(requestId)?.reject(new Error('YeastWorkletNode destroyed before processBlock completed'));
            }
            for (const commandId of [...pendingCommands.keys()]) {
                settleCommand(commandId)?.reject(
                    new Error('YeastWorkletNode destroyed before command acknowledgement')
                );
            }
            pending.clear();
            pendingCommands.clear();
            notesOffHandlers.clear();
            try {
                node.port.close();
            } catch {
                /* already closed */
            }
            try {
                node.disconnect();
            } catch {
                /* already disconnected */
            }
        },
    };
}
