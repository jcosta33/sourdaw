import { getYeastRack, syncStoreFromRack } from '../stores/yeastStore';

export function reorderYeastProcessor(fromIdx: number, toIdx: number): void {
    const rack = getYeastRack();
    rack.reorder(fromIdx, toIdx);
    syncStoreFromRack();
}
