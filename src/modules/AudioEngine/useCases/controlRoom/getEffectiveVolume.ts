import { controlRoomStore } from '../../stores/controlRoom';

/**
 * Get the effective monitoring volume, accounting for dim, mute, and calibration offset.
 */
export function getEffectiveVolume(): number {
    const state = controlRoomStore.value;
    if (!state) {
        return -6;
    }
    if (state.muted) {
        return -Infinity;
    }

    let volume = state.monitorVolume;
    if (state.dimActive) {
        volume += state.dimLevel;
    }

    // Add monitor calibration offset
    const activeMonitor = state.monitors.find((message) => message.id === state.activeMonitorId);
    if (activeMonitor) {
        volume += activeMonitor.calibrationDb;
    }

    return volume;
}
