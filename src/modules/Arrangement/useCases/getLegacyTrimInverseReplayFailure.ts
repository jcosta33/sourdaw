import { type AppAction } from '#/utils/handlerContract';

import { resolveEligibleClipWriteTarget } from '../stores/resolveEligibleClipWriteTarget';
import { trackStore } from '../stores/trackStore';

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

/**
 * Admission for recorded inverses only; fresh trims never pass through this
 * seam. Command's undo, redo and group revert ask it through
 * `legacyInverseReplayAdmission`, and only for an action list that holds a
 * keyless `trimClipStart` inverse.
 */
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
        if (clip.type !== 'midi') {
            continue;
        }
        // Today's loop mode and phase cannot authenticate the old coordinates:
        // a peer may disable looping after the trim already wrapped every row.
        return 'The legacy MIDI trim has no captured offset';
    }
    return null;
}
