import { activeSessions, type SixteenLevelsTarget } from './sixteenLevels';

export function enter16Levels(deviceId: string, padIndex: number, paramTarget: SixteenLevelsTarget = 'velocity'): void {
    activeSessions.set(deviceId, { deviceId, padIndex, target: paramTarget });
}
