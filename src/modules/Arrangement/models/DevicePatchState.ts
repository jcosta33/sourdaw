import { type DeviceStateChunk } from './Track';

/** Only this chunk and these explicit numeric leaves belong to a patch write. */
export type DevicePatchState = {
    deviceState: DeviceStateChunk | null;
    parameterValues: Record<string, number | null>;
};
