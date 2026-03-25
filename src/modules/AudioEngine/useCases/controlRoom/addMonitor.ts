import { controlRoomStore, getNextMonitorId, type MonitorOutput } from '#/modules/AudioEngine/stores/controlRoom';

export function addMonitor(name: string): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }

    const monitor: MonitorOutput = {
        id: getNextMonitorId(),
        name,
        gainDb: 0,
        active: false,
        calibrationDb: 0,
    };

    controlRoomStore.set({
        ...state,
        monitors: [...state.monitors, monitor],
    });
}
