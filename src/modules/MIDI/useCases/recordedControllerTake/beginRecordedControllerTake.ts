import { activeRecordingRef, trackStore } from '#/modules/Arrangement/stores';

import { getTargetTrackId } from '../../repositories/webMidi/getTargetTrackId';
import { recordedControllerTakeState } from '../../repositories/webMidi/recordedControllerTakeState';

import { readBendRangeSeedRows } from './readBendRangeSeedRows';
import { readHeldPedalRows } from './readHeldPedalRows';
import { readHeldWheelRows } from './readHeldWheelRows';
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
 * both are seeded whether or not the take records anything else. So is the pitch wheel held
 * off centre, because a note struck before the wheel next moves sounds bent live and the
 * take records a bend only when a message arrives. A take that records
 * into a clip an earlier take holds rows in (an existing clip, or a carried-over one, whose
 * buffer length now marks where the earlier take's rows end) has no seed there, so the
 * state the input held when the take first records into that clip is kept on its buffer
 * (`captureRegisteredStateAtFirstRow`) for `endRecordedControllerTake` to declare there.
 * A carried-over buffer forgets the previous take's. The clips the recorder just opened are
 * the ones whose commit flushes their rows; `startRecording` opens them before
 * the transport reports recording.
 */
export function beginRecordedControllerTake(): void {
    const {
        buffers,
        openedClipIds,
        committedClipIds,
        carriedOverClips,
        heldPedalSeeds,
        bendRangeSeeds,
        pitchBendSeeds,
    } = recordedControllerTakeState;
    const awaitingCommit = readClipsAwaitingCommit();
    for (const clipId of [...buffers.keys()]) {
        if (!awaitingCommit.has(clipId)) {
            buffers.delete(clipId);
        }
    }
    for (const seeds of [heldPedalSeeds, bendRangeSeeds, pitchBendSeeds]) {
        for (const clipId of [...seeds.keys()]) {
            if (!awaitingCommit.has(clipId)) {
                seeds.delete(clipId);
            }
        }
    }
    committedClipIds.clear();
    openedClipIds.clear();
    carriedOverClips.clear();
    for (const clipId of awaitingCommit) {
        const buffer = buffers.get(clipId);
        openedClipIds.add(clipId);
        carriedOverClips.set(clipId, { cc: buffer?.cc.length ?? 0, pitchBend: buffer?.pitchBend.length ?? 0 });
        if (buffer) {
            buffer.registeredStateAtFirstRow = undefined;
        }
    }
    for (const clipId of activeRecordingRef.current) {
        openedClipIds.add(clipId);
    }

    const trackId = getTargetTrackId();
    const seededClipId = trackId === null ? undefined : findOpenedClipOnTrack(trackId);
    if (seededClipId !== undefined) {
        seedClipWithLiveInputState(seededClipId);
    }
}

/**
 * Owe `clipId` the live input's pedals, declared bend range and held wheel. A clip carried
 * over from an earlier take already holds its own declaration, with the ids its redo snapshot
 * names, and its own wheel: a second one would replace them, and a loop pass is no new take.
 */
function seedClipWithLiveInputState(clipId: string): void {
    const { carriedOverClips, heldPedalSeeds, bendRangeSeeds, pitchBendSeeds } = recordedControllerTakeState;
    const pedalRows = readHeldPedalRows();
    if (pedalRows.length > 0) {
        heldPedalSeeds.set(clipId, pedalRows);
    }
    if (carriedOverClips.has(clipId)) {
        return;
    }
    const bendRangeRows = readBendRangeSeedRows();
    if (bendRangeRows.length > 0) {
        bendRangeSeeds.set(clipId, bendRangeRows);
    }
    const wheelRows = readHeldWheelRows();
    if (wheelRows.length > 0) {
        pitchBendSeeds.set(clipId, wheelRows);
    }
}
