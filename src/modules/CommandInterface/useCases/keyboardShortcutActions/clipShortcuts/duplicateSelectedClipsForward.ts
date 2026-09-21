import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { addClip, captureRetiredTakeLanes, removeClip, restoreTakesForClip } from '#/modules/Arrangement/useCases';
import { duplicateClipAutomation } from '#/modules/Automation/useCases';
import { pushUndoEntry, REDO_NOT_APPLIED } from '#/modules/Command/useCases';
import { type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

type ClipInfo = {
    clipId: string;
    trackId: string;
    startBeat: number;
    endBeat: number;
    name: string;
    type: 'audio' | 'midi';
    audioBufferId?: string;
};

type ClipCopy = {
    info: ClipInfo;
    createdId: string;
};

/** The selected clips with the placement data a copy needs, in track order. */
function collectSelectedClips(tracks: readonly Track[], selectedClipIds: readonly string[]): ClipInfo[] {
    const selected: ClipInfo[] = [];
    for (const track of tracks) {
        for (const clip of track.clips) {
            if (!selectedClipIds.includes(clip.id)) {
                continue;
            }
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
    return selected;
}

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

    const selected = collectSelectedClips(state.tracks, selectedClipIds);
    if (selected.length === 0) {
        return;
    }

    const earliestStart = Math.min(...selected.map((context) => context.startBeat));
    const latestEnd = Math.max(...selected.map((context) => context.endBeat));
    const span = latestEnd - earliestStart;

    if (span <= 0) {
        return;
    }

    const copies: ClipCopy[] = [];

    for (const info of selected) {
        const newClip = addClip({
            trackId: info.trackId,
            startBeat: info.startBeat + span,
            endBeat: info.endBeat + span,
            name: `${info.name} (copy)`,
            type: info.type,
            audioBufferId: info.audioBufferId,
        });
        if (!newClip) {
            continue;
        }
        copies.push({ info, createdId: newClip.id });
        duplicateClipAutomation(info.clipId, newClip.id);
    }

    if (copies.length === 0) {
        return;
    }

    const createdIds = copies.map((copy) => copy.createdId);

    // Redo re-creates every copy under the id it was minted with, so the takes the
    // undo retires come back under the same clip identity. Only the undo knows what
    // the copies are carrying by the time they leave, so it takes the capture.
    let retiredTakeLanes: readonly RetiredTakeLaneSnapshot[] = [];

    pushUndoEntry(
        `Duplicate ${createdIds.length} clip${createdIds.length > 1 ? 's' : ''} forward`,
        () => {
            retiredTakeLanes = captureRetiredTakeLanes(createdIds);
            for (const id of createdIds) {
                removeClip(id);
            }
        },
        () => {
            let recreated = 0;
            for (const copy of copies) {
                const newClip = addClip({
                    id: copy.createdId,
                    trackId: copy.info.trackId,
                    startBeat: copy.info.startBeat + span,
                    endBeat: copy.info.endBeat + span,
                    name: `${copy.info.name} (copy)`,
                    type: copy.info.type,
                    audioBufferId: copy.info.audioBufferId,
                });
                if (!newClip) {
                    continue;
                }
                recreated += 1;
                duplicateClipAutomation(copy.info.clipId, newClip.id);
            }
            if (recreated === 0) {
                // The destination track is gone, or the id is taken: nothing came back,
                // so putting the capture back would insert a lane for a track and a clip
                // that exist nowhere. The redo reports that it did not apply instead.
                return REDO_NOT_APPLIED;
            }
            restoreTakesForClip(retiredTakeLanes);
            return undefined;
        }
    );
}
