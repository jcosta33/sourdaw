import { levainBridge } from './levainBridge';

export function unregisterLevainDevice(): void {
    levainBridge().unregisterLevainDevice();
}
