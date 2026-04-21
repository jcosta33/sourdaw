import { levainBridge } from './levainBridge';

export function loadSamplesForInstrument(instrumentId: string): void {
    levainBridge().loadSamplesForInstrument(instrumentId);
}
