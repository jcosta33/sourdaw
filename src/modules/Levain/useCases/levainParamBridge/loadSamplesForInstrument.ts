import { levainBridge } from './levainBridge';

export function loadSamplesForInstrument(deviceId: string, instrumentId: string): void {
    void levainBridge().loadSamplesForInstrument(deviceId, instrumentId);
}
