import { mergeDeviceState } from '../stores/scoringStore';

export function setA4Reference(deviceId: string, hz: number): void {
    mergeDeviceState(deviceId, { a4Reference: hz });
}
