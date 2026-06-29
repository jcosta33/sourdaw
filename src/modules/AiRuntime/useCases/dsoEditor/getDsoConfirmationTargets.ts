import { trackStore } from '#/modules/Arrangement/stores';

import { type Dso, type DsoConfirmationTarget } from '../../models/DsoTypes';

type ClipMetadata = {
    id: string;
    trackId: string;
    name: string;
};

type DeviceMetadata = {
    id: string;
    name: string;
};

type TrackMetadata = {
    id: string;
    name: string;
    clips: ClipMetadata[];
    devices: DeviceMetadata[];
};

type LocatedClip = {
    clip: ClipMetadata;
    track: TrackMetadata;
};

type LocatedDevice = {
    device: DeviceMetadata;
    track: TrackMetadata;
};

type GetDsoConfirmationTargetsInput = {
    dsos: Dso[];
};

type GetDsoConfirmationTargetsOutput = DsoConfirmationTarget[];

export function getDsoConfirmationTargets(input: GetDsoConfirmationTargetsInput): GetDsoConfirmationTargetsOutput {
    const tracks: TrackMetadata[] = trackStore.value?.tracks ?? [];
    const targets: DsoConfirmationTarget[] = [];

    for (const dso of input.dsos) {
        switch (dso.op) {
            case 'remove_track': {
                const track = tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
                targets.push({
                    op: 'remove_track',
                    label: `Remove track ${formatEntityName(track?.name ?? null, dso.track_id)}`,
                    fingerprint: {
                        kind: 'track',
                        trackId: dso.track_id,
                        trackName: track?.name ?? null,
                    },
                });
                break;
            }

            case 'remove_clip': {
                const locatedClip = findClip({ tracks, clipId: dso.clip_id });
                targets.push({
                    op: 'remove_clip',
                    label: `Remove clip ${formatEntityName(locatedClip?.clip.name ?? null, dso.clip_id)}`,
                    fingerprint: {
                        kind: 'clip',
                        clipId: dso.clip_id,
                        clipName: locatedClip?.clip.name ?? null,
                        trackId: locatedClip?.track.id ?? null,
                        trackName: locatedClip?.track.name ?? null,
                    },
                });
                break;
            }

            case 'remove_device': {
                const locatedDevice = findDevice({ tracks, deviceId: dso.device_id });
                const fallbackTrack = tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
                const track = locatedDevice?.track ?? fallbackTrack;
                const trackLabel = track ? ` on track ${formatEntityName(track.name, track.id)}` : '';
                targets.push({
                    op: 'remove_device',
                    label: `Remove device ${formatEntityName(
                        locatedDevice?.device.name ?? null,
                        dso.device_id
                    )}${trackLabel}`,
                    fingerprint: {
                        kind: 'device',
                        deviceId: dso.device_id,
                        deviceName: locatedDevice?.device.name ?? null,
                        trackId: track?.id ?? null,
                        trackName: track?.name ?? null,
                    },
                });
                break;
            }

            default:
                break;
        }
    }

    return targets;
}

function findClip(input: { tracks: TrackMetadata[]; clipId: string }): LocatedClip | null {
    for (const track of input.tracks) {
        const clip = track.clips.find((candidate) => candidate.id === input.clipId) ?? null;
        if (clip) {
            return { clip, track };
        }
    }
    return null;
}

function findDevice(input: { tracks: TrackMetadata[]; deviceId: string }): LocatedDevice | null {
    for (const track of input.tracks) {
        const device = track.devices.find((candidate) => candidate.id === input.deviceId) ?? null;
        if (device) {
            return { device, track };
        }
    }
    return null;
}

function formatEntityName(name: string | null, fallbackId: string): string {
    return `"${name ?? fallbackId}"`;
}
