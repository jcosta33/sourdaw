import { levainBridge } from './levainBridge';

export const loadSamplesForInstrument = (deviceId: string, instrumentId: string): void => {
    levainBridge().loadSamplesForInstrument(deviceId, instrumentId);
};
