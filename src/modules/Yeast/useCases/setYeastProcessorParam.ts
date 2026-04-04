import { getYeastRack, getWorkletNodeSync } from '../stores/yeastStore';

export function setYeastProcessorParam(id: string, name: string, value: number): void {
    const rack = getYeastRack();
    rack.setProcessorParam(id, name, value);
    getWorkletNodeSync()?.setParam(id, name, value);
}
