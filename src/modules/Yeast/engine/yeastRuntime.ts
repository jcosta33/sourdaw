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
    context: BaseAudioContext | null;
    node: YeastWorkletNodeResult | null;
    nodePromise: Promise<YeastWorkletNodeResult | null> | null;
    projection: YeastProcessorProjection;
    processTail: Promise<void>;
    generation: number;
    status: YeastRuntimeStatus;
    error: string | undefined;
    onNotesOff: ((notes: number[]) => void) | null;
    pendingAllNotesOff?: number[];
};

const session = createHmrPersistentState<YeastRuntimeSession>('yeast.runtime', () => ({
    context: null,
    node: null,
    nodePromise: null,
    projection: [],
    processTail: Promise.resolve(),
    generation: 0,
    status: 'uninitialized',
    error: undefined,
    onNotesOff: null,
    pendingAllNotesOff: [],
}));

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

export function setYeastRuntimeProjection(projection: readonly YeastProcessorProjectionItem[]): void {
    session.projection = cloneProjection(projection);
    if (!session.node) {
        return;
    }

    try {
        session.node.setProjection(session.projection);
    } catch (error: unknown) {
        destroyCurrentNode();
        setRuntimeUnavailable(error);
    }
}

type YeastRuntimeCommandResult =
    | { delivered: true }
    | { delivered: false; reason: 'runtime-unavailable' | 'delivery-failed' };

/**
 * Commands are delivered only to the ready node; they are never retained for
 * projection replay or retried after a successful port send.
 */
export function sendYeastRuntimeCommand(command: YeastProcessorCommand): YeastRuntimeCommandResult {
    const node = session.node;
    if (!node) {
        return { delivered: false, reason: 'runtime-unavailable' };
    }

    try {
        node.sendCommand(command);
        return { delivered: true };
    } catch (error: unknown) {
        if (session.node === node) {
            session.generation += 1;
            destroyCurrentNode();
            session.nodePromise = null;
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
            const pendingAllNotesOff = session.pendingAllNotesOff ?? [];
            session.pendingAllNotesOff = [];
            for (const nowSamples of pendingAllNotesOff) {
                node.allNotesOff(nowSamples);
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
            session.generation += 1;
            destroyCurrentNode();
            session.nodePromise = null;
            setRuntimeUnavailable(error);
        }
        throw error;
    }
}

export function sendYeastRuntimeAllNotesOff(nowSamples: number): void {
    if (!session.node) {
        (session.pendingAllNotesOff ??= []).push(nowSamples);
        return;
    }

    try {
        session.node.allNotesOff(nowSamples);
    } catch (error: unknown) {
        setRuntimeUnavailable(error);
    }
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
