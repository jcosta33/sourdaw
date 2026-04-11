import { createStore } from '#/infra/store/createStore';

export type AudioDeviceState = {
    selectedOutputId: string | null;
    selectedInputId: string | null;
};

export const audioDeviceStore = createStore<AudioDeviceState>({
    initialData: {
        selectedOutputId: null,
        selectedInputId: null,
    },
});