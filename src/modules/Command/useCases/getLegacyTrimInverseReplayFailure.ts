import { resolveEligibleClipWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { resolveLoopedOffsetBeats } from '#/utils/clipLoopOrigin';
import { type AppAction } from '#/utils/handlerContract';

function preservesTrimCoordinates(action: AppAction): boolean {
    switch (action.type) {
        case 'renameClip':
        case 'setClipColor':
        case 'setClipGain':
        case 'setClipFade':
        case 'muteClip':
            return true;
        default:
            // A target-free payload can still replace or move project content.
            // Only the known metadata operations above prove preservation here.
            return false;
    }
}

/** Admission for recorded inverses only; fresh trims never pass through this seam. */
export function getLegacyTrimInverseReplayFailure(actions: readonly AppAction[]): string | null {
    for (const [index, action] of actions.entries()) {
        if (action.type !== 'trimClipStart' || action.payload.midiOffsetBeats !== undefined) {
            continue;
        }
        const target = resolveEligibleClipWriteTarget({ clipId: action.payload.clipId });
        if (target.status !== 'eligible') {
            return 'The legacy trim target cannot be identified safely';
        }
        const clip = trackStore.value?.tracks
            .find((track) => track.id === target.trackId)
            ?.clips.find((candidate) => candidate.id === action.payload.clipId);
        if (!clip) {
            return 'The legacy trim target cannot be identified safely';
        }
        if (!actions.slice(0, index).every(preservesTrimCoordinates)) {
            return 'An earlier inverse cannot prove the legacy trim coordinates';
        }
        if (clip.type !== 'midi' || clip.loopEnabled !== true) {
            continue;
        }
        const restoredStart = Math.max(0, action.payload.newStartBeat);
        const offset = clip.midiOffsetBeats ?? 0;
        const unchangedOffset = resolveLoopedOffsetBeats({
            offsetBeats: offset,
            loopEnabled: true,
            clipDurationBeats: clip.endBeat - clip.startBeat,
            configuredLoopLengthBeats: clip.loopLength,
        });
        // A loop wrap discarded its quotient. Without the old capture, today's
        // phase cannot identify the offset or row displacement the inverse owes.
        if (restoredStart !== clip.startBeat || !Object.is(offset, unchangedOffset)) {
            return 'The legacy MIDI trim has no captured offset for this loop';
        }
    }
    return null;
}
