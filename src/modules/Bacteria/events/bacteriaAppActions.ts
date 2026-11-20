import { type DeviceStateChunkSnapshot } from '#/modules/Arrangement/events';

export type BacteriaFactoryPatchSnapshot = {
    name: string;
    deviceState: DeviceStateChunkSnapshot | null;
    parameterValues: Record<string, number | null>;
};

export type BacteriaFactoryPatchAction = {
    type: 'setBacteriaFactoryPatch';
    payload: {
        deviceId: string;
        trackId: string;
        deviceIds: readonly string[];
        label: string;
        before: BacteriaFactoryPatchSnapshot;
        after: BacteriaFactoryPatchSnapshot;
    };
};

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        bacteria: BacteriaFactoryPatchAction;
    }
}
