import { midiStore } from '#/modules/MIDI/stores';
import { getWorkspaceState } from '#/modules/Workspace/useCases';

import { findClipById } from '../../services/findClipById';
import { setClipClipboard } from '../../stores/clipboardStore';
import { removeClip } from '../clip/removeClip';

export function cutSelectedClip(): void {
    const workspace = getWorkspaceState();
    if (!workspace) {
        return;
    }
    let ids: string[];
    if (workspace.selectedClipIds.length > 0) {
        ids = workspace.selectedClipIds;
    } else if (workspace.selectedClipId) {
        ids = [workspace.selectedClipId];
    } else {
        ids = [];
    }
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
