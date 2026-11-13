import { type AppAction, type DeviceSnapshot } from '#/utils/handlerContract';

import { type DevicePatchState } from './DevicePatchState';

export type PlannedDeviceOwnerSource = {
    id: string;
    frozen?: boolean;
    devices: readonly DeviceSnapshot[];
};

/** A required owner operation, not an optional extension of the current AppAction payload. */
export type CapturedDevicePatchStep = {
    kind: 'patch';
    trackId: string;
    deviceId: string;
    expectedDeviceIds: readonly string[];
    expectedTrackFrozen: boolean;
    expected: DevicePatchState;
    after: DevicePatchState;
};

export type PlannedDeviceWriteStep =
    | CapturedDevicePatchStep
    | { kind: 'restore-owner'; source: PlannedDeviceOwnerSource }
    | { kind: 'command'; action: AppAction };

export type PlannedDevicePresence =
    | { kind: 'absent-track'; trackId: string; deviceId: string }
    | { kind: 'absent-device'; trackId: string; deviceId: string; deviceIds: readonly string[]; frozen: boolean }
    | {
          kind: 'device';
          trackId: string;
          deviceId: string;
          deviceIds: readonly string[];
          frozen: boolean;
          deviceType: string;
          state: DevicePatchState;
      };

/** Values for publication proof; live project/incarnation evidence is captured separately. */
export type PlannedDeviceWrite =
    | { status: 'ready'; source: PlannedDevicePresence; prefix: PlannedDevicePresence; terminal: PlannedDevicePresence }
    | { status: 'conflict' | 'unsupported'; reason: string };
