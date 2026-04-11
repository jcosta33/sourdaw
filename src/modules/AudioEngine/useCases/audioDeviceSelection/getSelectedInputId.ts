import { audioDeviceStore } from './helpers';

export function getSelectedInputId(): string | null {
    return audioDeviceStore.value?.selectedInputId ?? null;
}