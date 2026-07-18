import { midiStore } from '#/modules/MIDI/stores';

import { findClipById } from '../../services/findClipById';
import { setClipClipboard } from '../../stores/clipboardStore';
import { clipSelectionStore } from '../../stores/clipSelectionStore';
import { removeClip } from '../clip/removeClip';
import { getTrackStoreState } from '../getTrackStoreState';

export function cutSelectedClip(): void {
    const workspace = clipSelectionStore.value;
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
    const tracks = getTrackStoreState()?.tracks ?? [];
    const entries = [];
    for (const id of ids) {
        const found = findClipById({ clipId: id, tracks });
        if (!found) {
            continue;
        }
        const midiNotes = found.clip.type === 'midi' ? midiState?.notesByClipId[found.clip.id] : undefined;
        entries.push({
            clip: { ...found.clip },
            midiNotes: midiNotes ? midiNotes.map((node) => ({ ...node })) : undefined,
            sourceTrackId: found.trackId,
        });
    }
    for (const id of ids) {
        removeClip(id);
    }

    setClipClipboard(entries);
}
