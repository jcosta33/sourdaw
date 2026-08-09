import { type Clip, type TrackStoreState } from '../../stores/trackStore';

type ClipIdOccurrence = Readonly<{
    clip: Clip;
    location: 'active' | 'alternative' | 'ghost';
    trackId: string;
}>;

type GetClipIdCensusInput = Readonly<{
    clipIds: readonly string[];
    state: TrackStoreState;
}>;

export function getClipIdCensus({ clipIds, state }: GetClipIdCensusInput): Map<string, ClipIdOccurrence[]> {
    const requestedIds = new Set(clipIds);
    const census = new Map<string, ClipIdOccurrence[]>(clipIds.map((clipId) => [clipId, []]));
    function record(clip: Clip, location: ClipIdOccurrence['location'], trackId: string): void {
        if (!requestedIds.has(clip.id)) {
            return;
        }
        census.get(clip.id)!.push({ clip, location, trackId });
    }

    for (const track of state.tracks) {
        for (const clip of track.clips) {
            record(clip, 'active', track.id);
        }
        for (const alternative of track.alternatives) {
            for (const clip of alternative.clips) {
                record(clip, 'alternative', track.id);
            }
        }
    }
    for (const clip of state.ghostClips ?? []) {
        record(clip, 'ghost', clip.trackId);
    }

    return census;
}
