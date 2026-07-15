import { logger } from '#/infra/logger/appLogger';
import { createHmrPersistentState } from '#/utils/HMR/createHmrPersistentState';

import { createYeastWorkletNode, type YeastWorkletNodeResult } from './YeastWorkletNode';

import type { MidiEvent, TransportInfo } from '../models/MidiEvent';
import type { YeastProcessorCommand } from '../models/YeastProcessorCommand';
import type {
    YeastProcessorProjection,
    YeastProcessorProjectionItem,
    YeastRuntimeStatus,
} from '../models/YeastProcessorProjection';

type ProcessYeastRuntimeBlockInput = {
    context: BaseAudioContext;
    events: readonly MidiEvent[];
    blockStartSamples: number;
    blockEndSamples: number;
    transport: TransportInfo;
};

type YeastRuntimeSession = {
    version: number;
    context: BaseAudioContext | null;
    node: YeastWorkletNodeResult | null;
    nodePromise: Promise<YeastWorkletNodeResult | null> | null;
    projection: YeastProcessorProjection;
    processTail: Promise<void>;
    generation: number;
    status: YeastRuntimeStatus;
    error: string | undefined;
    onNotesOff: ((notes: number[]) => void) | null;
    pendingAllNotesOff: PendingAllNotesOff | null;
};

type PendingAllNotesOff = {
    context: BaseAudioContext;
    generation: number;
    nowSamples: number;
};

const YEAST_RUNTIME_SESSION_VERSION = 2;
const MIDI_PANIC_NOTES = Array.from({ length: 128 }, (_, note) => note);

const session = createHmrPersistentState<YeastRuntimeSession>('yeast.runtime', () => ({
    version: YEAST_RUNTIME_SESSION_VERSION,
    context: null,
    node: null,
    nodePromise: null,
    projection: [],
    processTail: Promise.resolve(),
    generation: 0,
    status: 'uninitialized',
    error: undefined,
    onNotesOff: null,
    pendingAllNotesOff: null,
}));

// HMR retains the live node/session, but an older module may have left an
// unscoped panic array behind. Drop only that incompatible transient state.
if (session.version !== YEAST_RUNTIME_SESSION_VERSION) {
    session.version = YEAST_RUNTIME_SESSION_VERSION;
    session.pendingAllNotesOff = null;
}

function cloneProjection(projection: readonly YeastProcessorProjectionItem[]): YeastProcessorProjection {
    return projection.map((processor) => ({
        ...processor,
        params: { ...processor.params },
    }));
}

function setRuntimeUnavailable(error: unknown): void {
    session.status = 'unavailable';
    session.error = error instanceof Error ? error.message : String(error);
}

function destroyCurrentNode(): void {
    const node = session.node;
    session.node = null;
    if (node) {
        node.destroy();
    }
}

function invalidateCurrentRuntime(node: YeastWorkletNodeResult): void {
    if (session.node !== node) {
        return;
    }
    session.generation += 1;
    destroyCurrentNode();
    session.nodePromise = null;
    session.processTail = Promise.resolve();
    session.pendingAllNotesOff = null;
}

function invokeNotesOffFallback(): void {
    const handler = session.onNotesOff;
    if (!handler) {
        return;
    }

    try {
        handler([...MIDI_PANIC_NOTES]);
    } catch (error: unknown) {
        logger.warn('[Yeast] Panic Note Off fallback failed:', error);
    }
}

function trySendAllNotesOff(node: YeastWorkletNodeResult, nowSamples: number): boolean {
    try {
        node.allNotesOff(nowSamples);
        return true;
    } catch (error: unknown) {
        if (session.node === node) {
            invalidateCurrentRuntime(node);
            setRuntimeUnavailable(error);
            invokeNotesOffFallback();
        }
        return false;
    }
}

export function setYeastRuntimeProjection(projection: readonly YeastProcessorProjectionItem[]): void {
    session.projection = cloneProjection(projection);
    if (!session.node) {
        return;
    }

    try {
        session.node.setProjection(session.projection);
    } catch (error: unknown) {
        invalidateCurrentRuntime(session.node);
        setRuntimeUnavailable(error);
    }
}

type YeastRuntimeCommandResult =
    | { delivered: true }
    | { delivered: false; reason: 'runtime-unavailable' | 'delivery-failed' };

/**
 * Commands are delivered only to the ready node; they are never retained for
 * projection replay or retried after an uncertain delivery.
 */
export async function sendYeastRuntimeCommand(command: YeastProcessorCommand): Promise<YeastRuntimeCommandResult> {
    const node = session.node;
    if (!node) {
        return { delivered: false, reason: 'runtime-unavailable' };
    }
    const generation = session.generation;

    try {
        const ack = await node.sendCommand(command);
        if (session.node !== node || session.generation !== generation || !ack.accepted) {
            return { delivered: false, reason: 'delivery-failed' };
        }
        return { delivered: true };
    } catch (error: unknown) {
        if (session.node === node && session.generation === generation) {
            invalidateCurrentRuntime(node);
            setRuntimeUnavailable(error);
        }
        return { delivered: false, reason: 'delivery-failed' };
    }
}

export async function ensureYeastRuntime(input: {
    context: BaseAudioContext;
    projection: readonly YeastProcessorProjectionItem[];
}): Promise<YeastWorkletNodeResult | null> {
    session.projection = cloneProjection(input.projection);

    if (session.context !== null && session.context !== input.context) {
        session.generation += 1;
        session.pendingAllNotesOff = null;
        destroyCurrentNode();
        session.nodePromise = null;
        session.processTail = Promise.resolve();
        session.status = 'uninitialized';
        session.error = undefined;
    }

    session.context = input.context;
    if (session.node) {
        return session.node;
    }
    if (session.nodePromise) {
        return session.nodePromise;
    }

    const generation = session.generation;
    session.status = 'initializing';
    session.error = undefined;

    const nodePromise = createYeastWorkletNode(input.context)
        .then((node) => {
            if (session.generation !== generation || session.context !== input.context) {
                node.destroy();
                return null;
            }
            session.node = node;
            node.onNotesOff((notes) => {
                session.onNotesOff?.(notes);
            });
            node.setProjection(session.projection);
            const pendingAllNotesOff = session.pendingAllNotesOff;
            session.pendingAllNotesOff = null;
            if (
                pendingAllNotesOff &&
                pendingAllNotesOff.context === input.context &&
                pendingAllNotesOff.generation === generation
            ) {
                if (!trySendAllNotesOff(node, pendingAllNotesOff.nowSamples)) {
                    return null;
                }
            }
            session.status = 'ready';
            session.error = undefined;
            if (session.nodePromise === nodePromise) {
                session.nodePromise = null;
            }
            return node;
        })
        .catch((error: unknown) => {
            if (session.generation === generation && session.context === input.context) {
                if (session.node) {
                    invalidateCurrentRuntime(session.node);
                }
                destroyCurrentNode();
                if (session.nodePromise === nodePromise) {
                    session.nodePromise = null;
                }
                setRuntimeUnavailable(error);
                logger.warn('[Yeast] AudioWorklet runtime unavailable:', error);
            }
            return null;
        });

    session.nodePromise = nodePromise;
    return nodePromise;
}

export async function processYeastRuntimeBlock(input: ProcessYeastRuntimeBlockInput): Promise<MidiEvent[] | null> {
    const node = session.node;
    if (!node || node.context !== input.context) {
        return null;
    }

    const operation = session.processTail.then(() => {
        if (session.node !== node) {
            throw new Error('Yeast AudioWorklet runtime changed during MIDI processing');
        }
        return node.processBlock(input.events, input.blockStartSamples, input.blockEndSamples, input.transport);
    });
    session.processTail = operation.then(
        () => undefined,
        () => undefined
    );

    try {
        return await operation;
    } catch (error: unknown) {
        if (session.node === node) {
            invalidateCurrentRuntime(node);
            setRuntimeUnavailable(error);
        }
        throw error;
    }
}

export function sendYeastRuntimeAllNotesOff(nowSamples: number): void {
    const node = session.node;
    if (!node) {
        if (session.context === null) {
            // There is no context to scope this panic to yet, so do not retain it.
            return;
        }
        // Panic is idempotent; keep only the latest request during initialization.
        session.pendingAllNotesOff = {
            context: session.context,
            generation: session.generation,
            nowSamples,
        };
        return;
    }

    trySendAllNotesOff(node, nowSamples);
}

export function setYeastRuntimeNotesOffHandler(handler: (notes: number[]) => void): void {
    session.onNotesOff = handler;
}

export function getYeastRuntimeStatus(): YeastRuntimeStatus {
    return session.status;
}

export function getYeastRuntimeError(): string | undefined {
    return session.error;
}
