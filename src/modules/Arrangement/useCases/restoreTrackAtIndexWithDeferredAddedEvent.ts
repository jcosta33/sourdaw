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
    const clipIds = new Set(restoredTrack.clips.map((clip) => clip.id));
    const hasCollision = state.tracks.some(
        (candidate) => candidate.id === restoredTrack.id || candidate.clips.some((clip) => clipIds.has(clip.id))
    );
    if (hasCollision) {
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
