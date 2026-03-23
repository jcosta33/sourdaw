import { controlRoomStore } from '#/modules/Mixer/stores/controlRoom';

export function calibrateMonitor(monitorId: string, calibrationDb: number): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }

    controlRoomStore.set({
        ...state,
        monitors: state.monitors.map((m) =>
            m.id === monitorId ? { ...m, calibrationDb } : m
        ),
    });
}
