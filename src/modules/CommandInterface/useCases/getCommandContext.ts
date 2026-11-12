import { clipSelectionStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';

import { type CommandContext } from '../models/CommandContext';

type ContextSnapshots = {
    tracks: ReturnType<typeof trackStore.getSnapshot>;
    selection: ReturnType<typeof clipSelectionStore.getSnapshot>;
    automation: ReturnType<typeof automationStore.getSnapshot>;
};

export function getCommandContext(
    snapshots: ContextSnapshots = {
        tracks: trackStore.value,
        selection: clipSelectionStore.value,
        automation: automationStore.value,
    }
): CommandContext {
    let selectedClipIds: string[];
    if (snapshots.selection?.selectedClipIds.length) {
        selectedClipIds = [...snapshots.selection.selectedClipIds];
    } else if (snapshots.selection?.selectedClipId) {
        selectedClipIds = [snapshots.selection.selectedClipId];
    } else {
        selectedClipIds = [];
    }
    const selectedClipId = selectedClipIds[0] ?? null;
    const selectedClip = snapshots.tracks?.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === selectedClipId);
    return {
        selectedClipId,
        selectedClipIds,
        selectedClipType: selectedClip?.type ?? null,
        hasAutomationLane: (snapshots.automation?.lanes.length ?? 0) > 0,
    };
}
