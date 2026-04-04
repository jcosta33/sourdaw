import { getYeastRack, getWorkletNodeSync, syncStoreFromRack } from '../stores/yeastStore';

export function setYeastProcessorBypass(id: string, bypassed: boolean): void {
    const rack = getYeastRack();
    rack.setProcessorBypass(id, bypassed);
    getWorkletNodeSync()?.setBypass(id, bypassed);
    syncStoreFromRack();
}
