import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { sanitizeTrackSnapshot, type Track } from '../stores/trackStore';

import { getTrackById } from './getTrackById';
import { publishTrackAdded } from './publishTrackAdded';

type RestoreTrackAtIndexWithDeferredAddedEventInput = {
    trackJson: string;
    trackIndex: number;
};

type RestoreTrackAtIndexWithDeferredAddedEventOutput = {
    track: Track;
    afterCommit: () => Promise<void>;
    afterAmbiguousCommit: () => Promise<void>;
};

type RestoredTrackIdentities = {
    clipIds: Set<string>;
    deviceIds: Set<string>;
    alternativeIds: Set<string>;
};

function addUniqueId(ids: Set<string>, id: string): boolean {
    if (ids.has(id)) {
        return false;
    }
    ids.add(id);
    return true;
}

function collectRestoredTrackIdentities(track: Track): RestoredTrackIdentities | null {
    const identities: RestoredTrackIdentities = {
        clipIds: new Set<string>(),
        deviceIds: new Set<string>(),
        alternativeIds: new Set<string>(),
    };
    for (const clip of track.clips) {
        if (!addUniqueId(identities.clipIds, clip.id)) {
            return null;
        }
    }
    for (const alternative of track.alternatives) {
        if (!addUniqueId(identities.alternativeIds, alternative.id)) {
            return null;
        }
        for (const clip of alternative.clips) {
            if (!addUniqueId(identities.clipIds, clip.id)) {
                return null;
            }
        }
    }
    for (const device of track.devices) {
        if (!addUniqueId(identities.deviceIds, device.id)) {
            return null;
        }
    }
    for (const midiFx of track.midiFx) {
        if (!addUniqueId(identities.deviceIds, midiFx.id)) {
            return null;
        }
    }
    return identities;
}

function hasRestoredIdentityCollision(input: {
    state: NonNullable<ReturnType<typeof getTrackState>>;
    track: Track;
    identities: RestoredTrackIdentities;
}): boolean {
    if (input.state.ghostClips?.some((clip) => input.identities.clipIds.has(clip.id))) {
        return true;
    }
    for (const candidate of input.state.tracks) {
        if (candidate.id === input.track.id) {
            return true;
        }
        if (candidate.clips.some((clip) => input.identities.clipIds.has(clip.id))) {
            return true;
        }
        if (
            candidate.alternatives.some(
                (alternative) =>
                    input.identities.alternativeIds.has(alternative.id) ||
                    alternative.clips.some((clip) => input.identities.clipIds.has(clip.id))
            )
        ) {
            return true;
        }
        if (candidate.devices.some((device) => input.identities.deviceIds.has(device.id))) {
            return true;
        }
        if (candidate.midiFx.some((midiFx) => input.identities.deviceIds.has(midiFx.id))) {
            return true;
        }
    }
    return false;
}

function parseCanonicalTrack(trackJson: string): Track | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(trackJson);
    } catch {
        return null;
    }
    const normalized = sanitizeTrackSnapshot({ tracks: [parsed], selectedTrackId: null });
    if (normalized.tracks.length !== 1) {
        return null;
    }
    const [track] = normalized.tracks;
    if (!track || JSON.stringify(track) !== trackJson) {
        return null;
    }
    return track;
}

export function restoreTrackAtIndexWithDeferredAddedEvent(
    input: RestoreTrackAtIndexWithDeferredAddedEventInput
): RestoreTrackAtIndexWithDeferredAddedEventOutput | null {
    const state = getTrackState();
    const track = parseCanonicalTrack(input.trackJson);
    if (
        !state ||
        !track ||
        !Number.isInteger(input.trackIndex) ||
        input.trackIndex < 0 ||
        input.trackIndex > state.tracks.length
    ) {
        return null;
    }
    const restoredTrack = track;
    const identities = collectRestoredTrackIdentities(restoredTrack);
    if (!identities || hasRestoredIdentityCollision({ state, track: restoredTrack, identities })) {
        return null;
    }

    const tracks = [...state.tracks];
    tracks.splice(input.trackIndex, 0, restoredTrack);
    setTrackState({ ...state, tracks });

    function publish(): Promise<void> {
        return publishTrackAdded({
            trackId: restoredTrack.id,
            name: restoredTrack.name,
            kind: restoredTrack.kind,
        });
    }

    return {
        track: restoredTrack,
        afterCommit: publish,
        afterAmbiguousCommit: async () => {
            const durableTrack = getTrackById(restoredTrack.id);
            if (durableTrack && JSON.stringify(durableTrack) === input.trackJson) {
                await publish();
            }
        },
    };
}
