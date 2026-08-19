import { logger } from '#/infra/logger/appLogger';
import { prepareMidiClipGlueState } from '#/modules/MIDI/useCases';
import { type ClipGlueActionSnapshot } from '#/utils/handlerContract';

import { type Clip } from '../../models/Track';
import { getNextClipId } from '../../repositories/clipIdCounter';
import { getTrackState } from '../../repositories/track/getTrackState';
import { createClipSatelliteTransitionPlan } from '../../stores/clipSatelliteState';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { readClipScopedAutomationLanes } from '../clip/clipAutomationLaneTransition';

import { getClipIdCensus } from './getClipIdCensus';
import { getMidiClipGlueSources } from './getMidiClipGlueSources';
import { hasClipGlueDependencies } from './hasClipGlueDependencies';
import { isPlainMidiGlueClip } from './isPlainMidiGlueClip';

type PrepareClipGlueInput = {
    clipIds: readonly string[];
    targetClipId?: string;
};

export function prepareClipGlue({ clipIds, targetClipId }: PrepareClipGlueInput): {
    previous: ClipGlueActionSnapshot;
    next: ClipGlueActionSnapshot;
    targetClipId: string;
} | null {
    if (clipIds.length < 2 || new Set(clipIds).size !== clipIds.length) {
        return null;
    }
    const state = getTrackState();
    if (!state) {
        return null;
    }
    const sourceCensus = getClipIdCensus({ clipIds, state });
    if (
        clipIds.some((clipId) => {
            const occurrences = sourceCensus.get(clipId) ?? [];
            return occurrences.length !== 1 || occurrences[0]!.location !== 'active';
        })
    ) {
        return null;
    }
    const ownerTrackIds = new Set<string>();
    for (const clipId of clipIds) {
        const resolution = resolveEligibleClipWriteTarget({ clipId });
        if (resolution.status !== 'eligible') {
            return null;
        }
        ownerTrackIds.add(resolution.trackId);
    }
    if (ownerTrackIds.size !== 1) {
        logger.warn('glueClips: clips span multiple tracks — gluing is only supported within a single track');
        return null;
    }

    const [ownerTrackId] = ownerTrackIds;
    const track = state.tracks.find((candidate) => candidate.id === ownerTrackId);
    if (!track) {
        return null;
    }
    const clips = track.clips
        .filter((clip) => clipIds.includes(clip.id))
        .toSorted((left, right) => left.startBeat - right.startBeat || left.id.localeCompare(right.id));
    if (clips.length !== clipIds.length) {
        return null;
    }
    if (clips.some((clip) => clip.type !== 'midi')) {
        logger.warn('glueClips: only MIDI clips can be glued — refusing to create a silent audio clip');
        return null;
    }
    if (track.kind !== 'midi') {
        logger.warn('glueClips: MIDI clips can only be glued on a MIDI track');
        return null;
    }
    if (clips.some((clip) => clip.loopEnabled)) {
        logger.warn('glueClips: looped MIDI clips must be flattened before gluing');
        return null;
    }
    if (clips.some((clip) => !isPlainMidiGlueClip(clip))) {
        logger.warn('glueClips: only plain, unlocked, unmuted MIDI clips can be glued safely');
        return null;
    }
    if (clips.some((clip, index) => index > 0 && clips[index - 1]!.endBeat !== clip.startBeat)) {
        logger.warn('glueClips: MIDI clips must be adjacent and non-overlapping');
        return null;
    }
    const clipsInTrackOrder = track.clips.filter((clip) => clipIds.includes(clip.id));
    const gluedId = targetClipId ?? getNextClipId();
    if (hasClipGlueDependencies([...clipIds, gluedId])) {
        logger.warn('glueClips: clip dependencies must be removed or consolidated before gluing');
        return null;
    }
    const targetIdOccurrences = getClipIdCensus({ clipIds: [gluedId], state }).get(gluedId) ?? [];
    if (gluedId.length === 0 || targetIdOccurrences.length > 0) {
        return null;
    }
    const startBeat = clips[0]!.startBeat;
    const endBeat = clips[clips.length - 1]!.endBeat;
    const glued: Clip = {
        id: gluedId,
        trackId: track.id,
        name: `${clips[0]!.name} (glued)`,
        startBeat,
        endBeat,
        type: 'midi',
        fadeInBeats: clips[0]!.fadeInBeats,
        fadeOutBeats: clips[clips.length - 1]!.fadeOutBeats,
        gain: 1,
        color: clips[0]!.color,
        locked: false,
        muted: false,
    };
    const midiPlan = prepareMidiClipGlueState({
        sources: getMidiClipGlueSources({ clips, gluedStartBeat: startBeat }),
        targetClipId: gluedId,
    });
    if (!midiPlan) {
        return null;
    }

    // Glue join semantics (Logic/Live): the surviving glued clip carries the
    // FIRST source's gain envelope and warp state — the rest retire, undoably.
    // Automation has no coherent per-clip merge, so every source's clip-scoped
    // lanes retire (including the first); none migrate to the glued clip.
    const sourceIds = clips.map((clip) => clip.id);
    const [firstSourceId, ...remainingSourceIds] = sourceIds as [string, ...string[]];
    const clipSatelliteTransitionPlan = createClipSatelliteTransitionPlan({
        removedClipIds: remainingSourceIds,
        migrations: [{ sourceClipId: firstSourceId, targetClipId: gluedId }],
    });
    if (!clipSatelliteTransitionPlan) {
        return null;
    }
    // `createClipSatelliteTransitionPlan` omits any clip id that carries no
    // satellite data at all (the common bare-clip case), so its entries may
    // not cover every id this glue touches. Pad both sides with explicit
    // empty entries for whatever is missing so restoreClipGlueState's
    // freshness guard can assert "nothing lives here" for the FULL affected
    // set — including the glued id itself when the first source had nothing
    // to migrate — not just the ids the plan happened to mention.
    const affectedClipIds = [...sourceIds, gluedId];
    const presentSatelliteIds = new Set(clipSatelliteTransitionPlan.expected.entries.map((entry) => entry.clipId));
    const emptySatelliteEntries = affectedClipIds
        .filter((clipId) => !presentSatelliteIds.has(clipId))
        .map((clipId) => ({ clipId, gainEnvelope: null, warpState: null }));
    const sourceAutomationLanes = readClipScopedAutomationLanes(sourceIds);

    return {
        previous: {
            trackId: track.id,
            clips: structuredClone(clipsInTrackOrder),
            clipOrder: track.clips.map((clip) => clip.id),
            midi: midiPlan.previous,
            clipSatellites: [...clipSatelliteTransitionPlan.expected.entries, ...emptySatelliteEntries],
            clipAutomationLanes: sourceAutomationLanes,
        },
        next: {
            trackId: track.id,
            clips: [glued],
            clipOrder: track.clips.flatMap((clip) => {
                if (clip.id === clipsInTrackOrder[0]!.id) {
                    return [glued.id];
                }
                return clipIds.includes(clip.id) ? [] : [clip.id];
            }),
            midi: midiPlan.next,
            clipSatellites: [...clipSatelliteTransitionPlan.replacement.entries, ...emptySatelliteEntries],
            clipAutomationLanes: [],
        },
        targetClipId: gluedId,
    };
}
