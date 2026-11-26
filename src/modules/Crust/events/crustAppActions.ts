export type CrustFactoryPresetAction = {
    type: 'setCrustFactoryPreset';
    payload: {
        deviceId: string;
        trackId: string;
        trackObjectId: string;
        deviceObjectId: string;
        deviceIds: readonly string[];
        presetId: string;
        before: Readonly<Record<string, number | null>>;
        after: Readonly<Record<string, number | null>>;
    };
};

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        crust: CrustFactoryPresetAction;
    }
}
