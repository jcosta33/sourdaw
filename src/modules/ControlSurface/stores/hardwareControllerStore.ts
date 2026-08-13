import { createStore } from '#/infra/store/createStore';

import { PUSH_2_PROFILE, type ControllerProfile } from '../models/ControllerProfile';

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
        // Seed the built-in Push 2 profile so profile matching and mapping
        // import have a known profileId to target out of the box (F-8).
        profiles: [PUSH_2_PROFILE],
    },
});
