import type { HydratableProjectData, HydratableProjectTrack } from './isHydratableProjectData';

function addTrackBufferIds(tracks: readonly HydratableProjectTrack[], ids: Set<string>): void {
    for (const track of tracks) {
        const frozenId = track.freezeState?.frozenBufferId ?? track.frozenBufferId;
        if (frozenId) {
            ids.add(frozenId);
        }
        for (const clip of [
            ...track.clips,
            ...(track.alternatives ?? []).flatMap((alternative) => alternative.clips),
        ]) {
            const bufferId = clip.bufferId ?? clip.audioBufferId;
            if (bufferId) {
                ids.add(bufferId);
            }
        }
    }
}

export function collectProjectAllBufferIds(data: HydratableProjectData): string[] {
    const ids = new Set<string>();
    addTrackBufferIds(data.arrangement.tracks, ids);
    for (const arrangement of data.arrangements ?? []) {
        addTrackBufferIds(arrangement.tracks?.tracks ?? [], ids);
    }
    return [...ids];
}
