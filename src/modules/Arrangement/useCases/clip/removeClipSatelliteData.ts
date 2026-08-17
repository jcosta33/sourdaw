import { getAutomationLanes, removeAutomationLane } from '#/modules/Automation/useCases';

import { activeRecordingRef } from '../../stores/activeRecordingRef';
import { clipboardStore } from '../../stores/clipboardStore';
import { clipDragPreviewRef } from '../../stores/clipDragPreviewRef';
import { removeEnvelope } from '../../stores/gainEnvelopeStore';
import { removeWarpState } from '../../stores/warpStates';

/**
 * Drop every per-clip satellite record keyed by a retired clip id.
 *
 * A clip id leaves the arrangement two ways: the clip is deleted, or an edit
 * re-identifies it — a global Delete Time re-keys the surviving right-hand
 * fragment of a clip that starts inside the deleted range. Both retire the id,
 * and every store keyed by clip id has to let go of it. A surviving clip-scoped
 * automation lane makes Automation reject every later global time operation,
 * and surviving gain/warp entries bloat the project file and re-attach to
 * whatever clip later reuses the id.
 *
 * Every removal is a no-op when the id is already absent, so a caller that
 * dropped some satellites transactionally can still sweep the rest here.
 *
 * MIDI clip data is not covered: it is owned by MIDI's `removeMidiClipData`,
 * which callers invoke directly (`removeClip`) or through their own transaction
 * (the global time operation's MIDI owner handle).
 */
export function removeClipSatelliteData(clipIds: readonly string[]): void {
    if (clipIds.length === 0) {
        return;
    }
    const retiredIds = new Set(clipIds);

    for (const clipId of retiredIds) {
        // Gain envelope keyed by clip id.
        removeEnvelope(clipId);

        // Warp markers keyed by clip id.
        removeWarpState(clipId);
    }

    // Clip-scoped automation lanes (track-level lanes have no clipId and stay).
    for (const lane of getAutomationLanes()) {
        if (lane.clipId !== undefined && retiredIds.has(lane.clipId)) {
            removeAutomationLane(lane.id);
        }
    }

    // Clipboard: drop any copied entry that points at a retired clip so a later
    // paste can't resurrect a clip whose backing data is gone.
    const clipboard = clipboardStore.value;
    if (clipboard) {
        const filtered = clipboard.clipClipboard.filter((entry) => !retiredIds.has(entry.clip.id));
        if (filtered.length !== clipboard.clipClipboard.length) {
            clipboardStore.set({ ...clipboard, clipClipboard: filtered });
        }
    }

    // Ephemeral drag-preview ref: drop any in-progress preview/original keyed
    // to a retired clip.
    const preview = clipDragPreviewRef.current;
    if (preview) {
        for (const clipId of retiredIds) {
            preview.positions.delete(clipId);
            preview.originals.delete(clipId);
        }
    }

    // Ephemeral active-recording ref: stop tracking clips that no longer exist.
    if (activeRecordingRef.current.some((id) => retiredIds.has(id))) {
        activeRecordingRef.current = activeRecordingRef.current.filter((id) => !retiredIds.has(id));
    }
}
