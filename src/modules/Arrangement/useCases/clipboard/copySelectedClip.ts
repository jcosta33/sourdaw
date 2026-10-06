import { findClipById } from '../../services/findClipById';
import { setClipClipboard } from '../../stores/clipboardStore';
import { readClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { clipSelectionStore } from '../../stores/clipSelectionStore';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { readClipScopedAutomationLanes } from '../clip/readClipScopedAutomationLanes';
import { getTrackStoreState } from '../getTrackStoreState';

import { captureMidiClipRows } from './captureMidiClipRows';

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
        entries.push({
            clip: { ...found.clip },
            ...captureMidiClipRows(found.clip),
            // The payload must be self-contained: the source clip may be deleted
            // before the paste, so the clip-id-keyed satellites are read here,
            // at copy time, exactly where the clip rectangle and the notes are
            // captured. Take lanes are deliberately not part of the snapshot —
            // see `pasteClip`.
            satellites: readClipSatelliteEntry(found.clip.id),
            // Clip-scoped automation lanes are the other clip-id-keyed records
            // the paste must carry; read here for the same self-containment
            // reason (`duplicateClipAutomation` is their carry-over contract).
            automationLanes: readClipScopedAutomationLanes([found.clip.id]),
            sourceTrackId: found.trackId,
        });
    }
    setClipClipboard(entries);
    return true;
}
