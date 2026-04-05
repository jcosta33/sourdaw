import { type ProcessorType, createProcessor } from './processorFactory';
import { getYeastRack, getWorkletNodeSync, registerProcessorType, syncStoreFromRack } from '../stores/yeastStore';

export function addYeastProcessor(type: ProcessorType): void {
    const rack = getYeastRack();
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const processor = createProcessor(type, id);
    registerProcessorType(id, type);
    rack.addProcessor(processor);
    getWorkletNodeSync()?.addProcessor(type, id);
    syncStoreFromRack();
}
