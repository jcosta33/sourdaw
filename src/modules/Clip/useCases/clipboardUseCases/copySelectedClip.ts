import { findClipById } from '#/modules/Clip/helpers/findClipById';
import { midiStore } from '#/modules/Midi/stores/midiStore';
import { getWorkspaceState } from '#/modules/Workspace/repositories/workspaceRepository';
import { setClipClipboard } from '#/modules/Clip/stores/clipboardStore';

export function copySelectedClip(): void {
    const workspace = getWorkspaceState();
    if (!workspace) {
        return;
    }
    const ids =
        workspace.selectedClipIds.length > 0
            ? workspace.selectedClipIds
            : workspace.selectedClipId
              ? [workspace.selectedClipId]
              : [];
    if (ids.length === 0) {
        return;
    }

    const midiState = midiStore.value;
    const entries = [];
    for (const id of ids) {
        const found = findClipById(id);
        if (!found) {
            continue;
        }
        const midiNotes = found.clip.type === 'midi' ? midiState?.notesByClipId[found.clip.id] : undefined;
        entries.push({
            clip: { ...found.clip },
            midiNotes: midiNotes ? midiNotes.map((n) => ({ ...n })) : undefined,
            sourceTrackId: found.trackId,
        });
    }
    setClipClipboard(entries);
}
