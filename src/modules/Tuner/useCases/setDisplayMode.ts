import { type DisplayMode } from '../models/TunerState';
import { mergeDeviceState } from '../stores/tunerStore';

export function setDisplayMode(deviceId: string, mode: DisplayMode): void {
    mergeDeviceState(deviceId, { mode });
}
