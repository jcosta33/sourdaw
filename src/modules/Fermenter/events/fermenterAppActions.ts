import { type DeviceStateChunkSnapshot } from '#/utils/handlerContract';

export type DevicePatchStateSnapshot = {
    deviceState: DeviceStateChunkSnapshot | null;
    parameterValues: Record<string, number | null>;
};

export type FermenterAppAction = {
    type: 'setFermenterPatch';
    payload: {
        deviceId: string;
        before: DeviceStateChunkSnapshot;
        after: DeviceStateChunkSnapshot;
        expectedCurrent: DeviceStateChunkSnapshot;
        beforeProject: DevicePatchStateSnapshot;
        afterProject: DevicePatchStateSnapshot;
        expectedProject: DevicePatchStateSnapshot;
        expectedTrackId: string;
        expectedDeviceIds: readonly string[];
        expectedTrackFrozen: boolean;
        label: string;
    };
};

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        fermenter: FermenterAppAction;
    }
}
