import { scoringStore, getScoringState } from '../stores/scoringStore';

export function setA4Reference(deviceId: string, hz: number): void {
    const instances = scoringStore.value ?? {};
    const existing = getScoringState(deviceId);
    scoringStore.set({ ...instances, [deviceId]: { ...existing, a4Reference: hz } });
}
