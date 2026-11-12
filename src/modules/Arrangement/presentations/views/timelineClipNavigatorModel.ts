import type { getTimelineClipNavigationSnapshot } from '../../useCases/getTimelineClipNavigationSnapshot';

export type TimelineClip = ReturnType<typeof getTimelineClipNavigationSnapshot>[number];
export type ClipTypeFilter = 'all' | 'midi' | 'audio';

export function filterTimelineClips(
    clips: readonly TimelineClip[],
    query: string,
    typeFilter: ClipTypeFilter,
    currentTrackOnly: boolean,
    selectedTrackId: string | null
): readonly TimelineClip[] {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return clips.filter((item) => {
        if (typeFilter !== 'all' && item.clip.type !== typeFilter) {
            return false;
        }
        if (currentTrackOnly && selectedTrackId && item.track.id !== selectedTrackId) {
            return false;
        }
        return (
            normalizedQuery.length === 0 ||
            item.clip.name.toLocaleLowerCase().includes(normalizedQuery) ||
            item.track.name.toLocaleLowerCase().includes(normalizedQuery)
        );
    });
}
