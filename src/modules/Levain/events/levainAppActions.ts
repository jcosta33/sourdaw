import { type DeviceStateChunkSnapshot } from '#/modules/Arrangement/events';

export type LevainIdentitySnapshot = {
    deviceState: DeviceStateChunkSnapshot | null;
    parameterValues: Record<string, number | null>;
};

export type SetLevainIdentityAction = {
    type: 'setLevainIdentity';
    payload: {
        kind: 'articulation' | 'instrument';
        deviceId: string;
        trackId: string;
        deviceIds: readonly string[];
        label: string;
        before: LevainIdentitySnapshot;
        after: LevainIdentitySnapshot;
        /** Default identity to retain if a live layout needs the otherwise absent state chunk. */
        missingDeviceState: DeviceStateChunkSnapshot;
        /** Inverse may restore an older captured identity exactly. New selections always omit this. */
        restore?: true;
    };
};

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        levain: SetLevainIdentityAction;
    }
}
