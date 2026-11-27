import { type DeviceOwnerIncarnation } from '#/utils/handlerContract';

export type GrinderFactoryPresetAction = {
    type: 'setGrinderFactoryPreset';
    payload: {
        trackId: string;
        deviceId: string;
        deviceIds: readonly string[];
        ownerIncarnation: DeviceOwnerIncarnation;
        presetId: 'gr-rectifier-heavy';
        before: Readonly<Record<string, number | null>>;
        after: Readonly<Record<string, number | null>>;
        direction?: 'undo';
    };
};

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target
    interface AppActionRegistry {
        grinder: GrinderFactoryPresetAction;
    }
}
