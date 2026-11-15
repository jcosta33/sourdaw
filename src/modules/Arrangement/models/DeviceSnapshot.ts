import { type DeviceStateChunkSnapshot } from '#/utils/handlerContract';

export type DeviceSnapshot = {
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly bypassed: boolean;
    readonly parameterValues: Readonly<Record<string, number>>;
    readonly externalPluginId?: string;
    readonly externalInstanceId?: string;
    readonly externalStateChunk?: string;
    readonly deviceState?: DeviceStateChunkSnapshot;
};
