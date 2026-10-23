import { activeRecordingRef, trackStore } from '#/modules/Arrangement/stores';

import { getTargetTrackId } from '../../repositories/webMidi/getTargetTrackId';
import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';

import { readBendRangeSeedRows } from './readBendRangeSeedRows';
import { readHeldPedalRows } from './readHeldPedalRows';
import { readLiveClipIds } from './readLiveClipIds';

/** The clips of an earlier take that are still on the timeline and whose commit has not run yet. */
function readClipsAwaitingCommit(): Set<string> {
    const { openedClipIds, committedClipIds } = recordedControllerTakeState;
    const liveClipIds = readLiveClipIds();
    const awaitingCommit = new Set<string>();
    for (const clipId of openedClipIds) {
        if (!committedClipIds.has(clipId) && liveClipIds.has(clipId)) {
            awaitingCommit.add(clipId);
        }
    }
    return awaitingCommit;
}

/** The first clip the recorder opened on `trackId`, the one a take's starting pedals belong to. */
function findOpenedClipOnTrack(trackId: string): string | undefined {
    const trackClipIds = new Set(
        trackStore.value?.tracks.find((track) => track.id === trackId)?.clips.map((clip) => clip.id)
    );
    return activeRecordingRef.current.find((clipId) => trackClipIds.has(clipId));
}

/**
 * Start a take's controller recording at the transport's recording rising edge.
 *
 * What the previous take left behind is settled first. A clip it opened whose
 * commit has not run (the commit waits behind a collaboration persist, so a new
 * take can begin first) keeps its buffer and its pedals until that commit, a
 * discard, or the clip's removal; everything else is dropped, because nothing
 * will claim it.
 *
 * The pedals held on the live input are read now, before the take's own
 * messages move them, because a pedal pressed before the take is still down when
 * it begins and no message will say so. So is the pitch-bend range the input
 * declared, which the clip's own rows could not otherwise tell stored playback;
 * both are seeded whether or not the take records anything else. The clips the recorder just opened are
 * the ones whose commit flushes their rows; `startRecording` opens them before
 * the transport reports recording.
 */
export function beginRecordedControllerTake(): void {
    const { buffers, openedClipIds, committedClipIds, carriedOverClipIds, heldPedalSeeds, bendRangeSeeds } =
        recordedControllerTakeState;
    const awaitingCommit = readClipsAwaitingCommit();
    for (const clipId of [...buffers.keys()]) {
        if (!awaitingCommit.has(clipId)) {
            buffers.delete(clipId);
        }
    }
    for (const seeds of [heldPedalSeeds, bendRangeSeeds]) {
        for (const clipId of [...seeds.keys()]) {
            if (!awaitingCommit.has(clipId)) {
                seeds.delete(clipId);
            }
        }
    }
    committedClipIds.clear();
    openedClipIds.clear();
    carriedOverClipIds.clear();
    for (const clipId of awaitingCommit) {
        openedClipIds.add(clipId);
        carriedOverClipIds.add(clipId);
    }
    for (const clipId of activeRecordingRef.current) {
        openedClipIds.add(clipId);
    }

    const trackId = getTargetTrackId();
    const seededClipId = trackId === null ? undefined : findOpenedClipOnTrack(trackId);
    const pedalRows = readHeldPedalRows();
    if (seededClipId !== undefined && pedalRows.length > 0) {
        heldPedalSeeds.set(seededClipId, pedalRows);
    }
    // A clip carried over from an earlier take already holds its own declaration,
    // with the ids its redo snapshot names; a second one would replace them.
    const bendRangeRows = readBendRangeSeedRows();
    if (seededClipId !== undefined && bendRangeRows.length > 0 && !carriedOverClipIds.has(seededClipId)) {
        bendRangeSeeds.set(seededClipId, bendRangeRows);
    }
}
