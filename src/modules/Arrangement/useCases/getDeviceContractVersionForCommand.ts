import { getPluginById } from '../models/DeviceParameter';

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => [key, canonicalize(item)])
        );
    }
    return value;
}

function hashContract(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function getDeviceContractVersionForCommand(deviceType: string): string | undefined {
    const descriptor = getPluginById(deviceType);
    if (!descriptor) {
        return undefined;
    }
    return `descriptor-v1:${hashContract(JSON.stringify(canonicalize(descriptor)))}`;
}
