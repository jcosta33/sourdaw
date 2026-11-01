import { deviceSelectionStore } from '../../stores/deviceSelectionStore';

export function clearDeviceSelection(): void {
    deviceSelectionStore.set({ selectedDeviceId: null });
}
