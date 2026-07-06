import { activeSessions } from './sixteenLevels';

export function is16LevelsActive(deviceId: string): boolean {
    return activeSessions.has(deviceId);
}
