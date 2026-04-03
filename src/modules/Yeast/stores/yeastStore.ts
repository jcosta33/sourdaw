/**
 * Yeast store — tracks the MIDI rack state for UI rendering.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { MidiRack } from '../useCases/MidiRack';
import { createProcessor, type ProcessorType } from '../useCases/processorFactory';
import { createYeastWorkletNode, type YeastWorkletNodeResult } from '../engine/YeastWorkletNode';

const logger = Container.getInstance().get(Logger);

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

export const yeastStore = new Store<YeastState>(logger, { initialData: defaultState });

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
    if (_workletNode) return _workletNode;
    if (_workletNodePromise) return _workletNodePromise;

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
            console.warn('[Yeast] Worklet init failed, using main-thread fallback:', err);
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

export function addYeastProcessor(type: ProcessorType): void {
    const rack = getYeastRack();
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const processor = createProcessor(type, id);
    processorTypeMap.set(id, type);
    rack.addProcessor(processor);
    _workletNode?.addProcessor(type, id);
    syncStoreFromRack();
}

export function removeYeastProcessor(id: string): void {
    const rack = getYeastRack();
    processorTypeMap.delete(id);
    rack.removeProcessor(id);
    _workletNode?.removeProcessor(id);
    syncStoreFromRack();
}

export function reorderYeastProcessor(fromIdx: number, toIdx: number): void {
    const rack = getYeastRack();
    rack.reorder(fromIdx, toIdx);
    syncStoreFromRack();
}

export function setYeastProcessorBypass(id: string, bypassed: boolean): void {
    const rack = getYeastRack();
    rack.setProcessorBypass(id, bypassed);
    _workletNode?.setBypass(id, bypassed);
    syncStoreFromRack();
}

export function setYeastProcessorParam(id: string, name: string, value: number): void {
    const rack = getYeastRack();
    rack.setProcessorParam(id, name, value);
    _workletNode?.setParam(id, name, value);
}

export function setYeastUiLevel(level: 1 | 2 | 3 | 4 | 5): void {
    const state = yeastStore.value;
    if (state) {
        yeastStore.set({ ...state, uiLevel: level });
    }
}

function syncStoreFromRack(): void {
    const rack = getYeastRack();
    const state = yeastStore.value;
    if (!state) return;

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
    if (name.includes('Arp')) return 'arpeggiator';
    if (name.includes('Chord')) return 'chord';
    if (name.includes('Scale')) return 'scale';
    if (name.includes('Repeat')) return 'repeater';
    if (name.includes('Veloc')) return 'velocity';
    if (name.includes('Human')) return 'humanizer';
    if (name.includes('Filter')) return 'filter';
    if (name.includes('Trans')) return 'transposer';
    return 'arpeggiator';
}
