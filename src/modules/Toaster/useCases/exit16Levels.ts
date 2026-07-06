import { activeSessions } from './sixteenLevels';

export function exit16Levels(deviceId: string): void {
    activeSessions.delete(deviceId);
}
