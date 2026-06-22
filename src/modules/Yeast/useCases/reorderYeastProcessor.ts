import { getYeastRack, getWorkletNodeSync, syncStoreFromRack } from '../stores/yeastStore';

export function reorderYeastProcessor(fromIdx: number, toIdx: number): void {
    const rack = getYeastRack();
    rack.reorder(fromIdx, toIdx);
    // Mirror the reorder to the worklet rack so the offline/worklet chain and
    // the live/main-thread chain apply processors in the same order.
    getWorkletNodeSync()?.reorder(fromIdx, toIdx);
    syncStoreFromRack();
}
