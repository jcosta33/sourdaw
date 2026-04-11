import { levainBridge } from './levainBridge';

export const unregisterLevainDevice = (): void => {
    levainBridge().unregisterLevainDevice();
};