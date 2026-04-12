import { controlRoomStore } from '../../stores/controlRoom';

export function switchMonitor(monitorId: string): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }

    controlRoomStore.set({
        ...state,
        activeMonitorId: monitorId,
        monitors: state.monitors.map((m) => ({ ...m, active: m.id === monitorId })),
    });
}
