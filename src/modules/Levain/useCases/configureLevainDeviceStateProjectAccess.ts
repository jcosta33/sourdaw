import {
    setLevainDeviceStateProjectAccess,
    type LevainDeviceStateProjectAccess,
} from '../stores/levainDeviceStateProjectAccess';

/** Bind committed membership before device-state persistence starts; null detaches the dependency. */
export function configureLevainDeviceStateProjectAccess(next: LevainDeviceStateProjectAccess | null): void {
    setLevainDeviceStateProjectAccess(next);
}
