import { duplicateClipAutomation } from '#/modules/Automation/useCases';
import { duplicateClipNotes } from '#/modules/MIDI/useCases';

import { type Clip } from '../../models/Track';
import { defaultWarpState } from '../../models/WarpMarker';
import { getNextClipId } from '../../repositories/clipIdCounter';
import { getTrackState } from '../../repositories/track/getTrackState';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { getWarpState, setWarpState } from '../../stores/warpStates';

import { addClip } from './addClip';

type DuplicateClipCoreInput = {
    clipId: string;
    targetClipId?: string;
    computeStartBeat: (clip: Clip) => number;
};

export function duplicateClipCore(input: DuplicateClipCoreInput): boolean;
export function duplicateClipCore(clipId: string, computeStartBeat: (clip: Clip) => number): boolean;
export function duplicateClipCore(
    input: DuplicateClipCoreInput | string,
    legacyComputeStartBeat?: (clip: Clip) => number
): boolean {
    const clipId = typeof input === 'string' ? input : input.clipId;
    const targetClipId = typeof input === 'string' ? undefined : input.targetClipId;
    const computeStartBeat = typeof input === 'string' ? legacyComputeStartBeat : input.computeStartBeat;
    if (!computeStartBeat) {
        return false;
    }

    const sourceTarget = resolveEligibleClipWriteTarget({ clipId });
    if (sourceTarget.status !== 'eligible' || !('clipId' in sourceTarget)) {
        return false;
    }

    const destinationTarget = resolveEligibleClipWriteTarget({ trackId: sourceTarget.trackId });
    if (destinationTarget.status !== 'eligible') {
        return false;
    }

    const effectiveTargetClipId = targetClipId ?? getNextClipId();
    if (effectiveTargetClipId.length === 0) {
        return false;
    }

    const existingTarget = resolveEligibleClipWriteTarget({ clipId: effectiveTargetClipId });
    if (existingTarget.status !== 'missing') {
        return false;
    }

    const state = getTrackState();
    if (!state) {
        return false;
    }

    const track = state.tracks.find((candidate) => candidate.id === sourceTarget.trackId);
    const clip = track?.clips.find((candidate) => candidate.id === clipId);
    if (!track || !clip) {
        return false;
    }

    const duration = clip.endBeat - clip.startBeat;
    const startBeat = computeStartBeat(clip);
    const newClip = addClip({
        id: effectiveTargetClipId,
        trackId: track.id,
        startBeat,
        endBeat: startBeat + duration,
        name: `${clip.name} (copy)`,
        type: clip.type,
        audioBufferId: clip.audioBufferId,
        assetHash: clip.assetHash,
        audioOffsetBeats: clip.audioOffsetBeats,
        midiOffsetBeats: clip.midiOffsetBeats,
        fadeInBeats: clip.fadeInBeats,
        fadeOutBeats: clip.fadeOutBeats,
        gain: clip.gain,
        color: clip.color,
        locked: clip.locked,
        muted: clip.muted,
        stretchMode: clip.stretchMode,
        stretchRatio: clip.stretchRatio,
        loopEnabled: clip.loopEnabled,
        loopLength: clip.loopLength,
        followAction: clip.followAction,
    });
    if (!newClip) {
        return false;
    }

    duplicateClipAutomation(clipId, newClip.id);

    const sourceWarp = getWarpState(clipId);
    const clonedWarp = {
        ...sourceWarp,
        markers: sourceWarp.markers.map((marker) => ({ ...marker })),
    };
    // Only stamp a map entry when the source clip carries actual warp state to
    // preserve. `getWarpState` already falls back to `defaultWarpState` for a
    // clip with no entry, so writing an entry that is value-identical to that
    // fallback is a no-op for every reader — except `hasClipSatelliteState`
    // (see `isGeneratedMidiStateCurrent`), which treats *any* map entry as
    // user-added state that must block a blind undo. Without this guard every
    // duplicate — even of a clip with no warp markers — would poison its own
    // undo guard the instant it is created.
    const isDefaultWarp =
        clonedWarp.enabled === defaultWarpState.enabled &&
        clonedWarp.markers.length === 0 &&
        clonedWarp.stretchMode === defaultWarpState.stretchMode &&
        clonedWarp.originalTempo === defaultWarpState.originalTempo;
    if (!isDefaultWarp) {
        setWarpState(newClip.id, clonedWarp);
    }

    if (clip.type === 'midi') {
        duplicateClipNotes(clipId, newClip.id);
    }

    return true;
}
