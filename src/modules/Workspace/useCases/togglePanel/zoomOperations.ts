import { getWorkspaceState } from '../../repositories/workspace';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';

/**
 * Note: DOM CustomEvent dispatch is part of the codebase-wide `sourdaw:*`
 * notification system. Deferred to the EventBus migration sprint
 * (see also goToItem.ts, scripting.ts).
 */
export function zoomToFit(): void {
    document.dispatchEvent(new CustomEvent('sourdaw:zoom-to-fit'));
}

export function zoomToSelection(): void {
    const ws = getWorkspaceState();
    const state = trackStore.value;
    if (!ws || !state) { return; }

    const selectedIds =
        ws.selectedClipIds.length > 0 ? ws.selectedClipIds : ws.selectedClipId ? [ws.selectedClipId] : [];

    if (selectedIds.length === 0) { return; }

    let minStart = Infinity;
    let maxEnd = -Infinity;
    for (const track of state.tracks) {
        for (const clip of track.clips) {
            if (selectedIds.includes(clip.id)) {
                if (clip.startBeat < minStart) { minStart = clip.startBeat; }
                if (clip.endBeat > maxEnd) { maxEnd = clip.endBeat; }
            }
        }
    }

    if (minStart === Infinity || maxEnd === -Infinity || maxEnd <= minStart) { return; }

    document.dispatchEvent(
        new CustomEvent('sourdaw:zoom-to-selection', {
            detail: { startBeat: minStart, endBeat: maxEnd },
        })
    );
}

export function cycleAutomationVisibility(): void {
    document.dispatchEvent(new CustomEvent('sourdaw:show-automation-tab'));
}
