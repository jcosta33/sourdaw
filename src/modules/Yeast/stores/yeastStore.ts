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
import { MidiRack } from '../useCases/MidiRack';
import { type ProcessorType } from '../useCases/processorFactory';
import { createYeastWorkletNode, type YeastWorkletNodeResult } from '../engine/YeastWorkletNode';

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

// The actual MIDI rack instance (main thread — used for live MIDI and UI state tracking)
let rackInstance: MidiRack | null = null;

// Explicit type map so the worklet can recreate processors on init/add.
const processorTypeMap = new Map<string, ProcessorType>();

// Worklet node — lazy init, null until first getYeastWorkletNodeAsync() call settles.
let _workletNode: YeastWorkletNodeResult | null = null;
let _workletNodePromise: Promise<YeastWorkletNodeResult | null> | null = null;

/**
 * Lazily create (or return cached) the YeastWorkletNode.
 * Returns null if the worklet fails to initialize (triggers main-thread fallback).
 */
export async function getYeastWorkletNodeAsync(ctx: BaseAudioContext): Promise<YeastWorkletNodeResult | null> {
    if (_workletNode) {
        return _workletNode;
    }
    if (_workletNodePromise) {
        return _workletNodePromise;
    }

    _workletNodePromise = createYeastWorkletNode(ctx)
        .then((node) => {
            _workletNode = node;
            // Sync any processors that were added before the worklet was ready.
            for (const [id, type] of processorTypeMap) {
                node.addProcessor(type, id);
            }
            return node;
        })
        .catch((err) => {
            logger.warn('[Yeast] Worklet init failed, using main-thread fallback:', err);
            _workletNodePromise = null;
            return null;
        });

    return _workletNodePromise;
}

export function getYeastRack(): MidiRack {
    if (!rackInstance) {
        rackInstance = new MidiRack();
    }
    return rackInstance;
}

/**
 * Synchronous access to the worklet node if it has already resolved.
 * Returns null if the worklet has not yet initialized.
 * Use cases call this to notify the worklet of mutations without awaiting.
 */
export function getWorkletNodeSync(): YeastWorkletNodeResult | null {
    return _workletNode;
}

/**
 * Register a processor type mapping for a given processor ID.
 * Called by write use cases when adding a processor.
 */
export function registerProcessorType(id: string, type: ProcessorType): void {
    processorTypeMap.set(id, type);
}

/**
 * Remove a processor type mapping.
 * Called by write use cases when removing a processor.
 */
export function unregisterProcessorType(id: string): void {
    processorTypeMap.delete(id);
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
        processors: names.map((n) => ({
            id: n.id,
            type: processorTypeMap.get(n.id) ?? inferType(n.name),
            name: n.name,
            bypassed: n.bypassed,
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
