import { controlRoomStore } from '../../stores/controlRoom';

export function calibrateMonitor(monitorId: string, calibrationDb: number): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }

    controlRoomStore.set({
        ...state,
        monitors: state.monitors.map((message) => (message.id === monitorId ? { ...message, calibrationDb } : message)),
    });
}
