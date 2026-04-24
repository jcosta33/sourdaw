/**
 * Yeast store — tracks the MIDI rack state for UI rendering.
 *
 * Write operations have moved to useCases/:
 *   addYeastProcessor, removeYeastProcessor, reorderYeastProcessor,
 *   setYeastProcessorBypass, setYeastProcessorParam, setYeastUiLevel
 *
 * This store holds:
 *   - the reactive yeastStore instance (public contract surface)
 *   - singleton rack/worklet runtime state
 *   - read access helpers (getYeastRack, getYeastWorkletNodeAsync)
 *   - internal sync and registration helpers used by the use cases
 */

import { logger } from '#/infra/logger/appLogger';
import { createStore } from '#/infra/store/createStore';
import { createHmrPersistentState } from '#/utils/HMR/createHmrPersistentState';

import { createYeastWorkletNode, type YeastWorkletNodeResult } from '../engine/YeastWorkletNode';
import { MidiRack } from '../useCases/MidiRack';
import { type ProcessorType } from '../useCases/processorFactory';

export type YeastProcessorInfo = {
    id: string;
    type: ProcessorType;
    name: string;
    bypassed: boolean;
};

export type YeastState = {
    processors: YeastProcessorInfo[];
    uiLevel: 1 | 2 | 3 | 4 | 5;
};

const defaultState: YeastState = {
    processors: [],
    uiLevel: 1,
};

export const yeastStore = createStore<YeastState>({ initialData: defaultState });

type YeastSessionState = {
    rackInstance: MidiRack | null;
    processorTypeMap: Map<string, ProcessorType>;
    _workletNode: YeastWorkletNodeResult | null;
    _workletNodePromise: Promise<YeastWorkletNodeResult | null> | null;
};

const session = createHmrPersistentState<YeastSessionState>('yeast.session', () => ({
    rackInstance: null,
    processorTypeMap: new Map<string, ProcessorType>(),
    _workletNode: null,
    _workletNodePromise: null,
}));

/**
 * Lazily create (or return cached) the YeastWorkletNode.
 * Returns null if the worklet fails to initialize (triggers main-thread fallback).
 */
export async function getYeastWorkletNodeAsync(ctx: BaseAudioContext): Promise<YeastWorkletNodeResult | null> {
    // If context changed, invalidate existing session
    if (session._workletNode && session._workletNode.context !== ctx) {
        session._workletNode = null;
        session._workletNodePromise = null;
    }

    if (session._workletNode) {
        return session._workletNode;
    }
    if (session._workletNodePromise) {
        return session._workletNodePromise;
    }

    session._workletNodePromise = createYeastWorkletNode(ctx)
        .then((node) => {
            session._workletNode = node;
            // Sync any processors that were added before the worklet was ready.
            for (const [id, type] of session.processorTypeMap) {
                node.addProcessor(type, id);
            }
            return node;
        })
        .catch((error) => {
            logger.warn('[Yeast] Worklet init failed, using main-thread fallback:', error);
            session._workletNodePromise = null;
            return null;
        });

    return session._workletNodePromise;
}

export function getYeastRack(): MidiRack {
    if (!session.rackInstance) {
        session.rackInstance = new MidiRack();
    }
    return session.rackInstance;
}

/**
 * Synchronous access to the worklet node if it has already resolved.
 * Returns null if the worklet has not yet initialized.
 * Use cases call this to notify the worklet of mutations without awaiting.
 */
export function getWorkletNodeSync(): YeastWorkletNodeResult | null {
    return session._workletNode;
}

/**
 * Register a processor type mapping for a given processor ID.
 * Called by write use cases when adding a processor.
 */
export function registerProcessorType(id: string, type: ProcessorType): void {
    session.processorTypeMap.set(id, type);
}

/**
 * Remove a processor type mapping.
 * Called by write use cases when removing a processor.
 */
export function unregisterProcessorType(id: string): void {
    session.processorTypeMap.delete(id);
}

/**
 * Sync the reactive store from the current rack state.
 * Called by write use cases after any mutation to the rack.
 */
export function syncStoreFromRack(): void {
    const rack = getYeastRack();
    const state = yeastStore.value;
    if (!state) {
        return;
    }

    const names = rack.getProcessorNames();
    yeastStore.set({
        ...state,
        processors: names.map((node) => ({
            id: node.id,
            type: session.processorTypeMap.get(node.id) ?? inferType(node.name),
            name: node.name,
            bypassed: node.bypassed,
        })),
    });
}

function inferType(name: string): ProcessorType {
    if (name.includes('Arp')) {
        return 'arpeggiator';
    }
    if (name.includes('Chord')) {
        return 'chord';
    }
    if (name.includes('Scale')) {
        return 'scale';
    }
    if (name.includes('Repeat')) {
        return 'repeater';
    }
    if (name.includes('Veloc')) {
        return 'velocity';
    }
    if (name.includes('Human')) {
        return 'humanizer';
    }
    if (name.includes('Filter')) {
        return 'filter';
    }
    if (name.includes('Trans')) {
        return 'transposer';
    }
    return 'arpeggiator';
}
