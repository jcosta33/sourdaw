import { resolveEligibleClipWriteTarget, trackStore } from '#/modules/Arrangement/stores';
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
        // Even a zero-distance trim can wrap an unnormalized old offset and
        // move every row. Today's phase cannot authenticate those prior figures.
        return 'The legacy MIDI trim has no captured offset for this loop';
    }
    return null;
}
