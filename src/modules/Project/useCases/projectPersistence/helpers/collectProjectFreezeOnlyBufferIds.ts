import type { HydratableProjectData, HydratableProjectTrack } from './isHydratableProjectData';

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
