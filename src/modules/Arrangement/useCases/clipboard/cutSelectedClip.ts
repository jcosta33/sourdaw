import { findClipById } from '../../services/findClipById';
import { midiStore } from '#/modules/MIDI/stores';
import { getWorkspaceState } from '#/modules/Workspace/useCases';
import { removeClip } from '../clip/removeClip';
import { setClipClipboard } from '../../stores/clipboardStore';

export function cutSelectedClip(): void {
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

    for (const id of ids) {
        removeClip(id);
    }
}
