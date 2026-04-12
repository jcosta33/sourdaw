import { controlRoomStore } from '../../stores/controlRoom';

export function setMonitorVolume(volumeDb: number): void {
    const state = controlRoomStore.value;
    if (!state) {
        return;
    }
    controlRoomStore.set({ ...state, monitorVolume: Math.max(-60, Math.min(6, volumeDb)) });
}
