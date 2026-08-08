import { logger } from '#/infra/logger/appLogger';
import { prepareMidiClipGlueState } from '#/modules/MIDI/useCases';
import { type ClipGlueActionSnapshot } from '#/utils/handlerContract';

import { type Clip } from '../../models/Track';
import { getNextClipId } from '../../repositories/clipIdCounter';
import { getTrackState } from '../../repositories/track/getTrackState';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';

import { hasClipGlueDependencies } from './hasClipGlueDependencies';

type PrepareClipGlueInput = {
    clipIds: readonly string[];
    targetClipId?: string;
};

function hasUnsupportedMidiGlueState(clip: Clip): boolean {
    return (
        clip.locked ||
        clip.muted ||
        clip.gain !== 1 ||
        (clip.stretchMode !== undefined && clip.stretchMode !== 'off') ||
        (clip.stretchRatio !== undefined && clip.stretchRatio !== 1) ||
        clip.followAction !== undefined ||
        clip.generating === true ||
        clip.isGhost === true ||
        clip.parentClipId !== undefined ||
        clip.isLinkedInstance === true ||
        clip.sourceKeyRoot !== undefined ||
        clip.sourceScaleName !== undefined ||
        clip.overrides !== undefined ||
        clip.kneadState !== undefined
    );
}

export function prepareClipGlue({ clipIds, targetClipId }: PrepareClipGlueInput): {
    previous: ClipGlueActionSnapshot;
    next: ClipGlueActionSnapshot;
    targetClipId: string;
} | null {
    if (clipIds.length < 2 || new Set(clipIds).size !== clipIds.length) {
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

    const state = getTrackState();
    const [ownerTrackId] = ownerTrackIds;
    const track = state?.tracks.find((candidate) => candidate.id === ownerTrackId);
    if (!state || !track) {
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
    if (clips.some(hasUnsupportedMidiGlueState)) {
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
    const idAlreadyUsed =
        (state.ghostClips ?? []).some((clip) => clip.id === gluedId) ||
        state.tracks.some(
            (candidate) =>
                candidate.clips.some((clip) => clip.id === gluedId) ||
                candidate.alternatives.some((alternative) => alternative.clips.some((clip) => clip.id === gluedId))
        );
    if (gluedId.length === 0 || idAlreadyUsed) {
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
        sources: clips.map((clip) => {
            const midiOffsetBeats = clip.midiOffsetBeats ?? 0;
            return {
                clipId: clip.id,
                beatOffset: clip.startBeat - startBeat - midiOffsetBeats,
                visibleStartBeat: midiOffsetBeats,
                visibleEndBeat: midiOffsetBeats + (clip.endBeat - clip.startBeat),
            };
        }),
        targetClipId: gluedId,
    });
    if (!midiPlan) {
        return null;
    }

    return {
        previous: {
            trackId: track.id,
            clips: structuredClone(clipsInTrackOrder),
            clipOrder: track.clips.map((clip) => clip.id),
            midi: midiPlan.previous,
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
        },
        targetClipId: gluedId,
    };
}
