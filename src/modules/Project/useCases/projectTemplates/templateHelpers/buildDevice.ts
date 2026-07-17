import type { Device, DeviceSpec } from './builderTypes';

export function buildDevice(spec: DeviceSpec): Device {
    return {
        id: `dev-${crypto.randomUUID()}`,
        name: spec.name ?? spec.type,
        type: spec.type,
        bypassed: false,
        parameterValues: spec.params ?? {},
    };
}
