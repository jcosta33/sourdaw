import { getYeastRack, getWorkletNodeSync, registerProcessorType, syncStoreFromRack } from '../stores/yeastStore';

import { type ProcessorType, createProcessor } from './processorFactory';

export function addYeastProcessor(type: ProcessorType): void {
    const rack = getYeastRack();
    const id = `${type}-${crypto.randomUUID()}`;
    const processor = createProcessor(type, id);
    registerProcessorType(id, type);
    rack.addProcessor(processor);
    getWorkletNodeSync()?.addProcessor(type, id);
    syncStoreFromRack();
}
