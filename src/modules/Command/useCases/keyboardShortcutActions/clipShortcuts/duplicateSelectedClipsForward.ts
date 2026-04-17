import { trackStore } from '#/modules/Arrangement/stores';
import { addClip, removeClip } from '#/modules/Arrangement/useCases';
import { duplicateClipAutomation } from '#/modules/Automation/useCases';
import { pushUndoEntry } from '../../pushUndoEntry';

/**
 * Duplicates all selected clips forward by the selection's total time span (R-B2).
 *
 * Selection span = latestEnd - earliestStart.
 * All clips are offset forward by that span.
 * Repeated invocations stack — each press adds another copy immediately after the previous.
 */
export function duplicateSelectedClipsForward(selectedClipIds: string[]): void {
    if (selectedClipIds.length === 0) {
        return;
    }

    const state = trackStore.value;
    if (!state) {
        return;
    }

    // Collect selected clips with their track info
    type ClipInfo = {
        clipId: string;
        trackId: string;
        startBeat: number;
        endBeat: number;
        name: string;
        type: 'audio' | 'midi';
        audioBufferId?: string;
    };

    const selected: ClipInfo[] = [];
    for (const track of state.tracks) {
        for (const clip of track.clips) {
            if (selectedClipIds.includes(clip.id)) {
                selected.push({
                    clipId: clip.id,
                    trackId: track.id,
                    startBeat: clip.startBeat,
                    endBeat: clip.endBeat,
                    name: clip.name,
                    type: clip.type,
                    audioBufferId: clip.audioBufferId,
                });
            }
        }
    }

    if (selected.length === 0) {
        return;
    }

    const earliestStart = Math.min(...selected.map((c) => c.startBeat));
    const latestEnd = Math.max(...selected.map((c) => c.endBeat));
    const span = latestEnd - earliestStart;

    if (span <= 0) {
        return;
    }

    const createdIds: string[] = [];

    for (const info of selected) {
        const newClip = addClip({
            trackId: info.trackId,
            startBeat: info.startBeat + span,
            endBeat: info.endBeat + span,
            name: `${info.name} (copy)`,
            type: info.type,
            audioBufferId: info.audioBufferId,
        });
        if (newClip) {
            createdIds.push(newClip.id);
            duplicateClipAutomation(info.clipId, newClip.id);
        }
    }

    if (createdIds.length === 0) {
        return;
    }

    // Capture the exact clips+positions for redo so we don't re-enter pushUndoEntry
    const redoInfos = selected.map((info, i) => ({
        trackId: info.trackId,
        startBeat: info.startBeat + span,
        endBeat: info.endBeat + span,
        name: `${info.name} (copy)`,
        type: info.type,
        audioBufferId: info.audioBufferId,
        sourceClipId: info.clipId,
        createdId: createdIds[i]!,
    }));

    // Mutable tracking: redo creates new clip IDs, so undo must reference the latest set.
    let currentIds = [...createdIds];

    pushUndoEntry(
        `Duplicate ${createdIds.length} clip${createdIds.length > 1 ? 's' : ''} forward`,
        () => {
            for (const id of currentIds) {
                removeClip(id);
            }
        },
        () => {
            const newIds: string[] = [];
            for (const ri of redoInfos) {
                const newClip = addClip({
                    trackId: ri.trackId,
                    startBeat: ri.startBeat,
                    endBeat: ri.endBeat,
                    name: ri.name,
                    type: ri.type,
                    audioBufferId: ri.audioBufferId,
                });
                if (newClip) {
                    newIds.push(newClip.id);
                    duplicateClipAutomation(ri.sourceClipId, newClip.id);
                }
            }
            currentIds = newIds;
        }
    );
}
