import { activeSessions, type SixteenLevelsSession } from './sixteenLevels';

export function get16LevelsTarget(deviceId: string): SixteenLevelsSession | null {
    return activeSessions.get(deviceId) ?? null;
}
