import { findClipById } from '../../services/findClipById';
import { setClipClipboard } from '../../stores/clipboardStore';
import { readClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { clipSelectionStore } from '../../stores/clipSelectionStore';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { readClipScopedAutomationLanes } from '../clip/readClipScopedAutomationLanes';
import { removeClip } from '../clip/removeClip';
import { audioSourceAtBeat } from '../clipEditing/audioSourceAtBeat';
import { getTrackStoreState } from '../getTrackStoreState';

import { captureMidiClipRows } from './captureMidiClipRows';

export function cutSelectedClip(): boolean {
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
        const clip = { ...found.clip };
        if (clip.type === 'audio' && (clip.audioOffsetSeconds !== undefined || clip.audioOffsetBeats !== undefined)) {
            clip.audioOffsetSeconds = audioSourceAtBeat(found.clip, found.clip.startBeat).audioOffsetSeconds;
        }
        entries.push({
            clip,
            ...captureMidiClipRows(found.clip),
            // Same self-contained payload `copySelectedClip` builds: cut is a
            // copy whose paste must carry the notes, controller streams,
            // satellites and clip-scoped automation lanes too, and the removal
            // below retires the live copies right after this read.
            satellites: readClipSatelliteEntry(found.clip.id),
            automationLanes: readClipScopedAutomationLanes([found.clip.id]),
            sourceTrackId: found.trackId,
        });
    }
    for (const id of ids) {
        removeClip(id);
    }

    setClipClipboard(entries);
    return true;
}
