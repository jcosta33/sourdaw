import { mergeDeviceState } from '../stores/tunerStore';

export function setA4Reference(deviceId: string, hz: number): void {
    mergeDeviceState(deviceId, { a4Reference: hz });
}
