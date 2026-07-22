import { midiStore } from '#/modules/MIDI/stores';

import { findClipById } from '../../services/findClipById';
import { setClipClipboard } from '../../stores/clipboardStore';
import { clipSelectionStore } from '../../stores/clipSelectionStore';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { getTrackStoreState } from '../getTrackStoreState';

export function copySelectedClip(): boolean {
    const workspace = clipSelectionStore.value;
    if (!workspace) {
        return false;
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
        return false;
    }

    const selectedIds = new Set<string>();
    for (const id of ids) {
        if (selectedIds.has(id)) {
            return false;
        }
        selectedIds.add(id);

        const target = resolveEligibleClipWriteTarget({ clipId: id });
        if (target.status !== 'eligible' || !('clipId' in target)) {
            return false;
        }
    }

    const midiState = midiStore.value;
    const state = getTrackStoreState();
    if (!state) {
        return false;
    }
    const tracks = state.tracks;
    const entries = [];
    for (const id of ids) {
        const found = findClipById({ clipId: id, tracks });
        if (!found) {
            return false;
        }
        const midiNotes = found.clip.type === 'midi' ? midiState?.notesByClipId[found.clip.id] : undefined;
        entries.push({
            clip: { ...found.clip },
            midiNotes: midiNotes ? midiNotes.map((node) => ({ ...node })) : undefined,
            sourceTrackId: found.trackId,
        });
    }
    setClipClipboard(entries);
    return true;
}
