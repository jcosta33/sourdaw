import { createStore } from '#/infra/store/createStore';

import { type ControllerProfile } from '../models/ControllerProfile';

export type ConnectedDevice = {
    id: string;
    name: string;
    profileId: string | null;
};

export type HardwareControllerState = {
    connectedDevices: ConnectedDevice[];
    profiles: ControllerProfile[];
};

export const hardwareControllerStore = createStore<HardwareControllerState>({
    initialData: {
        connectedDevices: [],
        profiles: [],
    },
});
