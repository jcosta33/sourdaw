import { type DeviceStateChunkSnapshot } from '#/modules/Arrangement/events';

export type GrandBouleAppAction = {
    type: 'setGrandBouleDeviceState';
    payload: {
        deviceId: string;
        trackId: string;
        before: DeviceStateChunkSnapshot | null;
        after: DeviceStateChunkSnapshot | null;
    };
};

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        grandBoule: GrandBouleAppAction;
    }
}
