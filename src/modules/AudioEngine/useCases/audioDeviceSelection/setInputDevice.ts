import { audioDeviceStore } from './helpers';

export function setInputDevice(deviceId: string): void {
    const current = audioDeviceStore.value;
    audioDeviceStore.set({ ...current!, selectedInputId: deviceId });
}