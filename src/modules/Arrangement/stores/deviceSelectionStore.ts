import { createStore } from '#/infra/store/createStore';

// The device the inspector is showing in detail. Runtime-only selection, never persisted.

export type DeviceSelectionState = {
    selectedDeviceId: string | null;
};

export const defaultDeviceSelectionState: DeviceSelectionState = {
    selectedDeviceId: null,
};

export const deviceSelectionStore = createStore<DeviceSelectionState>({
    initialData: defaultDeviceSelectionState,
});
