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

type DsoConfirmationMetadata = {
    tracks: TrackMetadata[];
    trackNameCounts: Map<string, number>;
    clipNameCounts: Map<string, number>;
    clipNameByTrackCounts: Map<string, number>;
    deviceNameByTrackCounts: Map<string, number>;
};

type GetDsoConfirmationTargetsInput = {
    dsos: Dso[];
};

type GetDsoConfirmationTargetsOutput = {
    actionLabels: string[];
    confirmationTargets: DsoConfirmationTarget[];
};

export function getDsoConfirmationTargets(input: GetDsoConfirmationTargetsInput): GetDsoConfirmationTargetsOutput {
    const tracks: TrackMetadata[] = trackStore.value?.tracks ?? [];
    const metadata = buildDsoConfirmationMetadata(tracks);
    const actionLabels: string[] = [];
    const confirmationTargets: DsoConfirmationTarget[] = [];

    for (const dso of input.dsos) {
        const label = describeDsoForConfirmation({ dso, metadata });
        actionLabels.push(label);

        switch (dso.op) {
            case 'remove_track': {
                const track = tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
                confirmationTargets.push({
                    op: 'remove_track',
                    label,
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
                confirmationTargets.push({
                    op: 'remove_clip',
                    label,
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
                confirmationTargets.push({
                    op: 'remove_device',
                    label,
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

    return { actionLabels, confirmationTargets };
}

function describeDsoForConfirmation(input: { dso: Dso; metadata: DsoConfirmationMetadata }): string {
    const { dso, metadata } = input;
    switch (dso.op) {
        case 'add_track':
            return `Add ${dso.kind} track ${formatEntityName(dso.name, dso.track_id ?? dso.name)}`;
        case 'remove_track': {
            const track = metadata.tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
            return `Remove track ${formatTrackReference({ track, fallbackId: dso.track_id, metadata })}`;
        }
        case 'rename_track': {
            const track = metadata.tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
            return `Rename track ${formatTrackReference({ track, fallbackId: dso.track_id, metadata })} to ${formatEntityName(
                dso.name,
                dso.name
            )}`;
        }
        case 'set_track_volume': {
            const track = metadata.tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
            return `Set track ${formatTrackReference({ track, fallbackId: dso.track_id, metadata })} volume to ${(
                dso.gain * 100
            ).toFixed(0)}%`;
        }
        case 'set_track_pan': {
            const track = metadata.tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
            return `Set track ${formatTrackReference({ track, fallbackId: dso.track_id, metadata })} pan to ${dso.pan}`;
        }
        case 'mute_track': {
            const track = metadata.tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
            return `${dso.muted ? 'Mute' : 'Unmute'} track ${formatTrackReference({
                track,
                fallbackId: dso.track_id,
                metadata,
            })}`;
        }
        case 'solo_track': {
            const track = metadata.tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
            return `${dso.soloed ? 'Solo' : 'Unsolo'} track ${formatTrackReference({
                track,
                fallbackId: dso.track_id,
                metadata,
            })}`;
        }
        case 'arm_track': {
            const track = metadata.tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
            return `${dso.armed ? 'Arm' : 'Disarm'} track ${formatTrackReference({
                track,
                fallbackId: dso.track_id,
                metadata,
            })}`;
        }
        case 'color_track': {
            const track = metadata.tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
            return `Set track ${formatTrackReference({ track, fallbackId: dso.track_id, metadata })} color to ${
                dso.color
            }`;
        }
        case 'reorder_track': {
            const track = metadata.tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
            return `Move track ${formatTrackReference({ track, fallbackId: dso.track_id, metadata })} to position ${
                dso.new_index
            }`;
        }
        case 'duplicate_clip': {
            const locatedClip = findClip({ tracks: metadata.tracks, clipId: dso.clip_id });
            const destinationTrack =
                metadata.tracks.find((candidate) => candidate.id === dso.destination_track_id) ?? null;
            return `Duplicate clip ${formatClipReference({
                locatedClip,
                fallbackId: dso.clip_id,
                metadata,
            })} to track ${formatTrackReference({
                track: destinationTrack,
                fallbackId: dso.destination_track_id,
                metadata,
            })} at beat ${dso.destination_start_beats}`;
        }
        case 'move_clip': {
            const locatedClip = findClip({ tracks: metadata.tracks, clipId: dso.clip_id });
            const destinationTrack =
                metadata.tracks.find((candidate) => candidate.id === dso.destination_track_id) ?? null;
            return `Move clip ${formatClipReference({
                locatedClip,
                fallbackId: dso.clip_id,
                metadata,
            })} to track ${formatTrackReference({
                track: destinationTrack,
                fallbackId: dso.destination_track_id,
                metadata,
            })} at beat ${dso.destination_start_beats}`;
        }
        case 'add_clip': {
            const track = metadata.tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
            return `Add ${dso.type} clip ${formatEntityName(dso.name, dso.name)} to track ${formatTrackReference({
                track,
                fallbackId: dso.track_id,
                metadata,
            })} from beat ${dso.start_beats} to ${dso.end_beats}`;
        }
        case 'remove_clip': {
            const locatedClip = findClip({ tracks: metadata.tracks, clipId: dso.clip_id });
            return `Remove clip ${formatClipReference({ locatedClip, fallbackId: dso.clip_id, metadata })}`;
        }
        case 'rename_clip': {
            const locatedClip = findClip({ tracks: metadata.tracks, clipId: dso.clip_id });
            return `Rename clip ${formatClipReference({
                locatedClip,
                fallbackId: dso.clip_id,
                metadata,
            })} to ${formatEntityName(dso.name, dso.name)}`;
        }
        case 'split_clip': {
            const locatedClip = findClip({ tracks: metadata.tracks, clipId: dso.clip_id });
            return `Split clip ${formatClipReference({
                locatedClip,
                fallbackId: dso.clip_id,
                metadata,
            })} at beat ${dso.split_at_beats}`;
        }
        case 'insert_device': {
            const track = metadata.tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
            return `Add device ${formatEntityName(dso.device_type, dso.device_type)} to track ${formatTrackReference({
                track,
                fallbackId: dso.track_id,
                metadata,
            })}`;
        }
        case 'remove_device': {
            const locatedDevice = findDevice({ tracks: metadata.tracks, deviceId: dso.device_id });
            const fallbackTrack = metadata.tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
            return `Remove device ${formatDeviceReference({
                locatedDevice,
                fallbackDeviceId: dso.device_id,
                fallbackTrack,
                metadata,
            })}`;
        }
        case 'bypass_device': {
            const locatedDevice = findDevice({ tracks: metadata.tracks, deviceId: dso.device_id });
            return `${dso.bypassed ? 'Bypass' : 'Enable'} device ${formatDeviceReference({
                locatedDevice,
                fallbackDeviceId: dso.device_id,
                fallbackTrack: null,
                metadata,
            })}`;
        }
        case 'set_tempo':
            return `Set tempo to ${dso.bpm} BPM`;
        case 'set_time_signature':
            return `Set time signature to ${dso.numerator}/${dso.denominator}`;
        case 'transpose_notes': {
            const locatedClip = findClip({ tracks: metadata.tracks, clipId: dso.clip_id });
            return `Transpose notes in clip ${formatClipReference({
                locatedClip,
                fallbackId: dso.clip_id,
                metadata,
            })} by ${dso.semitones} semitones`;
        }
        case 'humanize_midi': {
            const locatedClip = findClip({ tracks: metadata.tracks, clipId: dso.clip_id });
            return `Humanize MIDI in clip ${formatClipReference({
                locatedClip,
                fallbackId: dso.clip_id,
                metadata,
            })}`;
        }
        case 'create_send': {
            const fromTrack = metadata.tracks.find((candidate) => candidate.id === dso.from_track_id) ?? null;
            const toTrack = metadata.tracks.find((candidate) => candidate.id === dso.to_track_id) ?? null;
            return `Create send from track ${formatTrackReference({
                track: fromTrack,
                fallbackId: dso.from_track_id,
                metadata,
            })} to track ${formatTrackReference({ track: toTrack, fallbackId: dso.to_track_id, metadata })}`;
        }
        case 'set_loop':
            return dso.enabled ? `Set loop from beat ${dso.start_beats} to ${dso.end_beats}` : 'Disable loop';
        case 'set_device_param': {
            const locatedDevice = findDevice({ tracks: metadata.tracks, deviceId: dso.device_id });
            return `Set ${dso.param_name} on device ${formatDeviceReference({
                locatedDevice,
                fallbackDeviceId: dso.device_id,
                fallbackTrack: null,
                metadata,
            })} to ${dso.value}`;
        }
        case 'add_midi_notes': {
            const locatedClip = findClip({ tracks: metadata.tracks, clipId: dso.clip_id });
            return `Add ${dso.notes.length} MIDI note${dso.notes.length === 1 ? '' : 's'} to clip ${formatClipReference(
                {
                    locatedClip,
                    fallbackId: dso.clip_id,
                    metadata,
                }
            )}`;
        }
        case 'set_clip_gain': {
            const locatedClip = findClip({ tracks: metadata.tracks, clipId: dso.clip_id });
            return `Set clip ${formatClipReference({ locatedClip, fallbackId: dso.clip_id, metadata })} gain to ${
                dso.gain
            }`;
        }
        case 'generate_melody': {
            const track = metadata.tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
            return `Generate ${dso.style} melody on track ${formatTrackReference({
                track,
                fallbackId: dso.track_id,
                metadata,
            })}`;
        }
        case 'generate_chords': {
            const track = metadata.tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
            return `Generate ${dso.progression} chords on track ${formatTrackReference({
                track,
                fallbackId: dso.track_id,
                metadata,
            })}`;
        }
        case 'generate_drums': {
            const track = metadata.tracks.find((candidate) => candidate.id === dso.track_id) ?? null;
            return `Generate ${dso.style} drums on track ${formatTrackReference({
                track,
                fallbackId: dso.track_id,
                metadata,
            })}`;
        }
    }

    return 'Unknown DSO operation';
}

function buildDsoConfirmationMetadata(tracks: TrackMetadata[]): DsoConfirmationMetadata {
    const trackNameCounts = new Map<string, number>();
    const clipNameCounts = new Map<string, number>();
    const clipNameByTrackCounts = new Map<string, number>();
    const deviceNameByTrackCounts = new Map<string, number>();

    for (const track of tracks) {
        incrementCount({ counts: trackNameCounts, key: track.name });
        for (const clip of track.clips) {
            incrementCount({ counts: clipNameCounts, key: clip.name });
            incrementCount({ counts: clipNameByTrackCounts, key: `${track.id}:${clip.name}` });
        }
        for (const device of track.devices) {
            incrementCount({ counts: deviceNameByTrackCounts, key: `${track.id}:${device.name}` });
        }
    }

    return { tracks, trackNameCounts, clipNameCounts, clipNameByTrackCounts, deviceNameByTrackCounts };
}

function incrementCount(input: { counts: Map<string, number>; key: string }): void {
    input.counts.set(input.key, (input.counts.get(input.key) ?? 0) + 1);
}

function formatTrackReference(input: {
    track: TrackMetadata | null;
    fallbackId: string;
    metadata: DsoConfirmationMetadata;
}): string {
    if (!input.track) {
        return formatEntityName(null, input.fallbackId);
    }

    const reference = formatEntityName(input.track.name, input.track.id);
    if ((input.metadata.trackNameCounts.get(input.track.name) ?? 0) > 1) {
        return `${reference} (id: ${input.track.id})`;
    }
    return reference;
}

function formatClipReference(input: {
    locatedClip: LocatedClip | null;
    fallbackId: string;
    metadata: DsoConfirmationMetadata;
}): string {
    if (!input.locatedClip) {
        return formatEntityName(null, input.fallbackId);
    }

    const clip = input.locatedClip.clip;
    const track = input.locatedClip.track;
    const reference = formatEntityName(clip.name, clip.id);
    const clipNameCount = input.metadata.clipNameCounts.get(clip.name) ?? 0;
    if (clipNameCount <= 1) {
        return reference;
    }

    const trackReference = formatTrackReference({ track, fallbackId: track.id, metadata: input.metadata });
    const duplicateOnTrackCount = input.metadata.clipNameByTrackCounts.get(`${track.id}:${clip.name}`) ?? 0;
    if (duplicateOnTrackCount > 1) {
        return `${reference} on track ${trackReference} (id: ${clip.id})`;
    }
    return `${reference} on track ${trackReference}`;
}

function formatDeviceReference(input: {
    locatedDevice: LocatedDevice | null;
    fallbackDeviceId: string;
    fallbackTrack: TrackMetadata | null;
    metadata: DsoConfirmationMetadata;
}): string {
    const track = input.locatedDevice?.track ?? input.fallbackTrack;
    const reference = formatEntityName(input.locatedDevice?.device.name ?? null, input.fallbackDeviceId);
    if (!track) {
        return reference;
    }

    const trackReference = formatTrackReference({ track, fallbackId: track.id, metadata: input.metadata });
    if (!input.locatedDevice) {
        return `${reference} on track ${trackReference}`;
    }

    const duplicateOnTrackCount =
        input.metadata.deviceNameByTrackCounts.get(`${track.id}:${input.locatedDevice.device.name}`) ?? 0;
    if (duplicateOnTrackCount > 1) {
        return `${reference} on track ${trackReference} (id: ${input.locatedDevice.device.id})`;
    }
    return `${reference} on track ${trackReference}`;
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
