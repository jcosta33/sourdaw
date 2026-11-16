import { type DeviceStateValue } from './Track';

/**
 * The read-only form of a `DeviceStateChunk` a device snapshot carries. Models may not
 * import `events/`, so this mirrors the wire `DeviceStateChunkSnapshot`; an events
 * spec pins the two as equal.
 */
export type DeviceSnapshotState = {
    readonly version: number;
    readonly data: { readonly [key: string]: DeviceStateValue };
};

export type DeviceSnapshot = {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly bypassed: boolean;
    readonly parameterValues: Readonly<Record<string, number>>;
    readonly externalPluginId?: string;
    readonly externalInstanceId?: string;
    readonly externalStateChunk?: string;
    readonly deviceState?: DeviceSnapshotState;
};
