import { type ProjectContext } from '../../models/ProjectContext';

export function getSelectedClipReferenceIds(context: ProjectContext): string[] {
    return [
        ...new Set([...context.selectedClipIds, ...(context.selectedClipId === null ? [] : [context.selectedClipId])]),
    ];
}

export function getUniqueSelectedClipReferenceId(context: ProjectContext): string | null {
    const selectedIds = getSelectedClipReferenceIds(context);
    if (selectedIds.length !== 1) {
        return null;
    }
    const selectedId = selectedIds[0]!;
    return context.tracks.some((track) => track.clips.some((clip) => clip.id === selectedId)) ? selectedId : null;
}
