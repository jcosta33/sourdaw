import { type HydratableProjectData, type HydratableProjectTrack } from './isHydratableProjectData';

function collectTrackBufferIds({ ids, tracks }: { ids: Set<string>; tracks: readonly HydratableProjectTrack[] }): void {
    for (const track of tracks) {
        const frozenBufferId = track.freezeState?.frozenBufferId ?? track.frozenBufferId;
        if (frozenBufferId) {
            ids.add(frozenBufferId);
        }
        for (const clip of track.clips) {
            const bufferId = clip.bufferId ?? clip.audioBufferId;
            if (bufferId) {
                ids.add(bufferId);
            }
        }
        for (const alternative of track.alternatives ?? []) {
            for (const clip of alternative.clips) {
                const bufferId = clip.bufferId ?? clip.audioBufferId;
                if (bufferId) {
                    ids.add(bufferId);
                }
            }
        }
    }
}

type CollectProjectAudioBufferIdsInput = {
    data: HydratableProjectData;
};

export function collectProjectAudioBufferIds({ data }: CollectProjectAudioBufferIdsInput): string[] {
    const ids = new Set<string>();
    collectTrackBufferIds({ ids, tracks: data.arrangement.tracks });
    return [...ids];
}
