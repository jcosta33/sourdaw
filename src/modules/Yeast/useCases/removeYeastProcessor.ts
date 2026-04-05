import { getYeastRack, getWorkletNodeSync, unregisterProcessorType, syncStoreFromRack } from '../stores/yeastStore';

export function removeYeastProcessor(id: string): void {
    const rack = getYeastRack();
    unregisterProcessorType(id);
    rack.removeProcessor(id);
    getWorkletNodeSync()?.removeProcessor(id);
    syncStoreFromRack();
}
