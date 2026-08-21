import { isDeviceReleaseAdmitted } from '#/infra/release/deviceReleaseAdmission';

import type { Track } from '#/modules/Arrangement/stores';

// Signature types for the device-spec helpers. Owned here — `buildDevice` is
// the function whose contract they describe; sibling helpers type-import them.

export type Device = Track['devices'][number];

export type DeviceSpec = { type: string; name?: string; params?: Record<string, number> };

export function buildDevice(spec: DeviceSpec): Device {
    if (!isDeviceReleaseAdmitted(spec.type)) {
        throw new Error(`Device type "${spec.type}" is withheld from release templates.`);
    }

    return {
        id: `dev-${crypto.randomUUID()}`,
        name: spec.name ?? spec.type,
        type: spec.type,
        bypassed: false,
        parameterValues: spec.params ?? {},
    };
}
