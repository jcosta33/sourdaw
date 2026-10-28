import type { ProjectClip } from '../../../models/ProjectData';

import type { HydratableProjectData, HydratableProjectTrack } from './isHydratableProjectData';

function addTrackHashes(tracks: readonly HydratableProjectTrack[], hashes: Set<string>): void {
    const addClip = (clip: ProjectClip): void => {
        if (clip.type === 'audio' && clip.assetHash) {
            hashes.add(clip.assetHash);
        }
    };
    for (const track of tracks) {
        for (const clip of track.clips) {
            addClip(clip);
        }
        for (const alternative of track.alternatives ?? []) {
            for (const clip of alternative.clips) {
                addClip(clip);
            }
        }
    }
}

/** Include inactive arrangements and take alternatives, not only the visible timeline. */
export function collectProjectOriginalHashes(data: HydratableProjectData): string[] {
    const hashes = new Set<string>();
    addTrackHashes(data.arrangement.tracks, hashes);
    for (const arrangement of data.arrangements ?? []) {
        addTrackHashes(arrangement.tracks?.tracks ?? [], hashes);
    }
    return [...hashes];
}

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

export function collectProjectFreezeOnlyBufferIds(data: HydratableProjectData): string[] {
    const frozen = new Set<string>();
    const ordinary = new Set<string>();
    const visit = (tracks: readonly HydratableProjectTrack[]): void => {
        for (const track of tracks) {
            const frozenId = track.freezeState?.frozenBufferId ?? track.frozenBufferId;
            if (frozenId) {
                frozen.add(frozenId);
            }
            for (const clip of [
                ...track.clips,
                ...(track.alternatives ?? []).flatMap((alternative) => alternative.clips),
            ]) {
                const id = clip.bufferId ?? clip.audioBufferId;
                if (id) {
                    ordinary.add(id);
                }
            }
        }
    };
    visit(data.arrangement.tracks);
    for (const arrangement of data.arrangements ?? []) {
        visit(arrangement.tracks?.tracks ?? []);
    }
    return Array.from(frozen).filter((id) => !ordinary.has(id));
}
