import { projectClipLoopExpansion } from '../../useCases/clipLoop/projectClipLoopExpansion';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export type ClipLoopLengthState = { present: boolean; value: number };

export function findClipForLoopLength(clipId: string) {
    return getTrackStoreState()
        ?.tracks.flatMap((track) => track.clips)
        .find((clip) => clip.id === clipId);
}

export function readClipLoopLengthState(clip: { loopLength?: number }): ClipLoopLengthState {
    return { present: clip.loopLength !== undefined, value: clip.loopLength ?? 0 };
}

export function clipLoopLengthStatesMatch(left: ClipLoopLengthState, right: ClipLoopLengthState): boolean {
    return left.present === right.present && (!left.present || left.value === right.value);
}

export function isSafeRequestedClipLoopLength(
    clip: { startBeat: number; endBeat: number },
    loopLength: number
): boolean {
    const clipDurationBeats = clip.endBeat - clip.startBeat;
    if (
        !Number.isFinite(loopLength) ||
        loopLength <= 0 ||
        !Number.isFinite(clipDurationBeats) ||
        clipDurationBeats <= 0
    ) {
        return false;
    }
    const projected = projectClipLoopExpansion({
        clipDurationBeats,
        configuredLoopLengthBeats: loopLength,
        loopEnabled: true,
    });
    return projected.loopLengthBeats === loopLength;
}
