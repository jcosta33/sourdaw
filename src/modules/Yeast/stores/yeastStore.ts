/**
 * Yeast store — tracks the MIDI rack state for UI rendering.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { MidiRack } from '../useCases/MidiRack';
import { createProcessor, type ProcessorType } from '../useCases/processorFactory';

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

// The actual MIDI rack instance (not in React state — used by the audio/MIDI thread)
let rackInstance: MidiRack | null = null;

export function getYeastRack(): MidiRack {
    if (!rackInstance) {
        rackInstance = new MidiRack();
    }
    return rackInstance;
}

export function addYeastProcessor(type: ProcessorType): void {
    const rack = getYeastRack();
    const processor = createProcessor(type);
    rack.addProcessor(processor);
    syncStoreFromRack();
}

export function removeYeastProcessor(id: string): void {
    const rack = getYeastRack();
    rack.removeProcessor(id);
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
    syncStoreFromRack();
}

export function setYeastProcessorParam(id: string, name: string, value: number): void {
    const rack = getYeastRack();
    rack.setProcessorParam(id, name, value);
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

    // This is a simplified sync — in production, processor type would be tracked
    const names = rack.getProcessorNames();
    yeastStore.set({
        ...state,
        processors: names.map((n) => ({
            id: n.id,
            type: inferType(n.name),
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
