import { type DisplayMode } from '../models/ScoringState';
import { scoringStore, getScoringState } from '../stores/scoringStore';

export function setDisplayMode(deviceId: string, mode: DisplayMode): void {
    const instances = scoringStore.value ?? {};
    const existing = getScoringState(deviceId);
    scoringStore.set({ ...instances, [deviceId]: { ...existing, mode } });
}
