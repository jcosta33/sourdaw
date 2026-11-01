import { deviceSelectionStore } from '../../stores/deviceSelectionStore';

export function selectDevice(deviceId: string): void {
    deviceSelectionStore.set({ selectedDeviceId: deviceId });
}
