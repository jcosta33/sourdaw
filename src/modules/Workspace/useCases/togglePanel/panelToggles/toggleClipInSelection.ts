import { getWorkspaceState } from '../../../repositories/getWorkspaceState';
import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const toggleClipInSelection = (clipId: string): void => {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    const ids = new Set(current.selectedClipIds);
    if (ids.has(clipId)) {
        ids.delete(clipId);
    } else {
        ids.add(clipId);
    }
    updateWorkspaceState({ selectedClipId: clipId, selectedClipIds: [...ids] });
};
