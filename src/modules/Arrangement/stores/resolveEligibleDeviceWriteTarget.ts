import { getTrackEligibility } from './trackEligibility';
import { trackStore } from './trackStore';

type EligibleDeviceWriteTarget = {
    status: 'eligible';
    trackId: string;
    deviceId: string;
};

type UnresolvedDeviceWriteTarget = {
    status: 'missing' | 'ineligible';
};

export type DeviceWriteTargetResolution = EligibleDeviceWriteTarget | UnresolvedDeviceWriteTarget;

type TrackEligibilityKind = Parameters<typeof getTrackEligibility>[0];

function isTrackEligibilityKind(value: unknown): value is TrackEligibilityKind {
    return (
        value === 'audio' ||
        value === 'midi' ||
        value === 'bus' ||
        value === 'master' ||
        value === 'folder' ||
        value === 'vca'
    );
}

function isObject(value: unknown): value is object {
    return value !== null && typeof value === 'object';
}

export function resolveEligibleDeviceWriteTarget(deviceId: string): DeviceWriteTargetResolution {
    if (deviceId.length === 0) {
        return { status: 'ineligible' };
    }

    const tracks: unknown = trackStore.value?.tracks;
    if (!Array.isArray(tracks)) {
        return { status: 'missing' };
    }

    let matchingOwner: object | null = null;
    let matchingDeviceCount = 0;

    for (const candidate of tracks) {
        if (!isObject(candidate)) {
            continue;
        }

        const devices: unknown = Reflect.get(candidate, 'devices');
        if (!Array.isArray(devices)) {
            continue;
        }

        for (const device of devices) {
            if (!isObject(device) || Reflect.get(device, 'id') !== deviceId) {
                continue;
            }

            matchingOwner = candidate;
            matchingDeviceCount += 1;
        }
    }

    if (matchingDeviceCount === 0 || !matchingOwner) {
        return { status: 'missing' };
    }

    if (matchingDeviceCount !== 1) {
        return { status: 'ineligible' };
    }

    const trackId: unknown = Reflect.get(matchingOwner, 'id');
    const kind: unknown = Reflect.get(matchingOwner, 'kind');
    if (typeof trackId !== 'string' || !isTrackEligibilityKind(kind)) {
        return { status: 'ineligible' };
    }

    if (!getTrackEligibility(kind).acceptsDeviceUpdate) {
        return { status: 'ineligible' };
    }

    return { status: 'eligible', trackId, deviceId };
}
