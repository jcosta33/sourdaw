import { type DeviceStateChunkSnapshot } from '#/modules/Arrangement/events';

import { type ToasterMasterGainCapture } from '../models/ToasterMasterGainPatch';

export type ToasterFactoryKitAction = {
    type: 'setToasterFactoryKit';
    payload: {
        deviceId: string;
        trackId: string;
        deviceIds: readonly string[];
        label: string;
        before: DeviceStateChunkSnapshot | null;
        after: DeviceStateChunkSnapshot | null;
    };
};

export type ToasterMasterGainAction = {
    type: 'setToasterMasterGain';
    payload: {
        deviceId: string;
        trackId: string;
        deviceIds: readonly string[];
        before: ToasterMasterGainCapture;
        after: ToasterMasterGainCapture;
    };
};

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        toaster: ToasterFactoryKitAction | ToasterMasterGainAction;
    }
}
