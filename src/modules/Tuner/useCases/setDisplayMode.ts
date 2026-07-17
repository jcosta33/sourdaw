import { type DisplayMode } from '../models/ScoringState';
import { mergeDeviceState } from '../stores/scoringStore';

export function setDisplayMode(deviceId: string, mode: DisplayMode): void {
    mergeDeviceState(deviceId, { mode });
}
