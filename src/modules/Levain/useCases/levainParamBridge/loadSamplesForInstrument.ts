import { levainBridge } from './levainBridge';

export const loadSamplesForInstrument = (instrumentId: string): void => {
    levainBridge().loadSamplesForInstrument(instrumentId);
};