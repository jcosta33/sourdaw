import { transportStore } from '#/modules/Transport/stores';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export type ClipLoopLengthState = { present: boolean; value: number };

// Read the transport through its store, not through `#/modules/Transport/useCases`. That barrel
// pulls in `getTransportHandlers`, and a clip handler reaching it closes an
// Arrangement -> Transport -> Collaboration -> CrdtDocument -> Yeast -> MIDI -> AudioEngine ->
// Arrangement cycle (293 no-circular rows). `getTransportState()` is itself only
// `transportStore.value`.
export function transportIsBusy(): boolean {
    const transport = transportStore.value;
    return transport?.isPlaying === true || transport?.isRecording === true;
}

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
