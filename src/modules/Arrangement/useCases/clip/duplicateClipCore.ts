import { duplicateClipAutomation } from '#/modules/Automation/useCases';
import { duplicateClipNotes } from '#/modules/MIDI/useCases';

import { type Clip } from '../../models/Track';
import { getNextClipId } from '../../repositories/clipIdCounter';
import { getTrackState } from '../../repositories/track/getTrackState';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { getWarpState, isDefaultWarpState, setWarpState } from '../../stores/warpStates';

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
    // The readers that decide whether a clip "has warp state" —
    // `hasClipSatelliteState` (see `isGeneratedMidiStateCurrent`) and
    // `hasClipGlueDependencies` (`clipEditing/hasClipGlueDependencies.ts`) —
    // call `hasNonDefaultWarpState`, which compares a clip's warp state
    // against `defaultWarpState` by content rather than asking whether the
    // map merely has an entry. That makes this guard no longer load-bearing
    // for their correctness. It still matters for its own reason: skipping
    // the write when the cloned state is value-identical to the default
    // keeps `warpStates` from filling up with a noise entry for every plain
    // duplicate, which matters for anything that iterates the map, such as
    // `readClipSatelliteEntry`'s snapshots.
    if (!isDefaultWarpState(clonedWarp)) {
        setWarpState(newClip.id, clonedWarp);
    }

    if (clip.type === 'midi') {
        duplicateClipNotes(clipId, newClip.id);
    }

    return true;
}
