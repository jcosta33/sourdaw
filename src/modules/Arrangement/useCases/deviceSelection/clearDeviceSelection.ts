import { deviceSelectionStore } from '../../stores/deviceSelectionStore';

export function clearDeviceSelection(): void {
    // Clip gestures call this on every selection; skip the write when nothing is
    // focused so they do not notify device-selection subscribers for no change.
    if (deviceSelectionStore.value?.selectedDeviceId === null) {
        return;
    }
    deviceSelectionStore.set({ selectedDeviceId: null });
}
