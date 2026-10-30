import type { HydratableProjectData, HydratableProjectTrack } from './isHydratableProjectData';
import type { ProjectClip } from '../../../models/ProjectData';

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
