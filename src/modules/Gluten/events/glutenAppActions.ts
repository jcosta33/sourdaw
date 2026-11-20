export type GlutenFactoryPresetAction = {
    type: 'setGlutenFactoryPreset';
    payload: {
        deviceId: string;
        trackId: string;
        deviceIds: readonly string[];
        presetId: string;
        before: Readonly<Record<string, number | null>>;
        after: Readonly<Record<string, number | null>>;
    };
};

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        gluten: GlutenFactoryPresetAction;
    }
}
