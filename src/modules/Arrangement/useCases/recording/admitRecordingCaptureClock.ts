import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { takeLaneStore } from '../../stores/takeLaneStore';

import { recordingPassTiming } from './recordingPassTiming';
import { stageRecordingTake } from './stageRecordingTake';

type CaptureBoundary = {
    originalTakeId: string;
    loopStart: number;
    loopEnd: number;
    endBeat: number;
    nextPassStartBeat: number;
    contextSeconds: number;
    planned: boolean;
};

/** The scheduler's pass calculation, limited to this original recording owner. */
function stageOwnedBoundary(clipId: string, boundary: CaptureBoundary): boolean {
    const timing = recordingPassTiming.ownedTakes(clipId);
    const track = getTrackState()?.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId));
    const clip = track?.clips.find((candidate) => candidate.id === clipId);
    const lane = takeLaneStore.value?.lanes.find((candidate) => candidate.trackId === track?.id);
    if (
        !timing ||
        timing.pendingNative ||
        timing.originalTakeId !== boundary.originalTakeId ||
        !clip ||
        !track ||
        !lane?.takes.some((take) => take.id === boundary.originalTakeId && take.clipId === clipId)
    ) {
        return false;
    }
    const priorPassTakes = lane.takes.filter((take) => timing.ownedTakeIds.has(take.id)).length;
    const passIndex = Math.max(0, priorPassTakes - 1);
    const loopLength = boundary.loopEnd - boundary.loopStart;
    const runUpBeats = Math.max(0, boundary.loopStart - clip.startBeat);
    const startedInsideLoop = clip.startBeat > boundary.loopStart && clip.startBeat < boundary.loopEnd;
    const firstPassLength = startedInsideLoop ? boundary.loopEnd - clip.startBeat : loopLength;
    const sourceOffsetBeats = runUpBeats + (passIndex === 0 ? 0 : firstPassLength + (passIndex - 1) * loopLength);
    stageRecordingTake({
        trackId: track.id,
        clipId,
        name: `Take ${lane.takes.length + 1}`,
        startBeat: boundary.loopStart,
        endBeat: boundary.endBeat,
        sourceOffsetBeats,
        passEndContextSeconds: boundary.contextSeconds,
        plannedPassEnd: boundary.planned,
        nextPassStartBeat: boundary.nextPassStartBeat,
    });
    return true;
}

/** Only a pending native recording's original provisional geometry is admitted. */
export function admitRecordingCaptureClock(
    clipId: string,
    beat: number | undefined,
    contextSeconds: number | undefined,
    ending: () => { contextSeconds: number; beatAtContextSeconds: (seconds: number) => number } | undefined,
    boundary?: CaptureBoundary
): string | null {
    recordingPassTiming.setEndingClock(clipId, ending);
    const state = getTrackState();
    if (!state?.tracks.some((track) => track.clips.some((clip) => clip.id === clipId))) {
        return null;
    }
    const timing = recordingPassTiming.ownedTakes(clipId);
    const originalId = timing?.originalTakeId;
    if (!originalId) {
        return null;
    }
    if (boundary) {
        return stageOwnedBoundary(clipId, boundary) ? originalId : null;
    }
    if (
        beat === undefined ||
        contextSeconds === undefined ||
        !recordingPassTiming.admitNative(clipId, beat, contextSeconds)
    ) {
        return originalId;
    }
    const endBeat = timing?.ending ? Math.max(beat, timing.ending.endBeat) : beat;
    setTrackState({
        ...state,
        tracks: state.tracks.map((track) => ({
            ...track,
            clips: track.clips.map((clip) => (clip.id === clipId ? { ...clip, startBeat: beat, endBeat } : clip)),
        })),
    });
    const lanes = takeLaneStore.value;
    if (lanes) {
        takeLaneStore.set({
            lanes: lanes.lanes.map((lane) => ({
                ...lane,
                takes: lane.takes.map((take) =>
                    take.id === originalId ? { ...take, startBeat: beat, endBeat } : take
                ),
            })),
        });
    }
    return originalId;
}
