import { shiftClipAutomation } from '#/modules/Automation/useCases';
import { readTempoAtBeat } from '#/modules/Transport/stores';
import { type AudioSourceStateSnapshot, type TakeSourceDepthSnapshot } from '#/utils/handlerContract';

import { type Clip, type Track } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { audioSourceAtBeat } from '../clipEditing/audioSourceAtBeat';
import { isAudioSourceStateSnapshot } from '../clipEditing/isAudioSourceStateSnapshot';
import { prepareTakeSourceDepthMove } from '../comping/prepareTakeSourceDepthMove';

import { isClipDropCompatible } from './isClipDropCompatible';

type MoveClipOptions = {
    /**
     * Marks an undo/redo replay: the target names a placement the document
     * itself held before the move being restored. Undo returns the document
     * to a state it was actually in, and a project saved before the placement
     * rule can hold an audio clip on a MIDI track — the kind guard governs
     * new placements, so it must not refuse that return. Every other guard
     * still applies.
     */
    historicalPlacement?: boolean;
    /** Exact captured end when restoring a historical placement. */
    historicalEndBeat?: number;
    historicalAudioSource?: AudioSourceStateSnapshot;
    historicalTakeSources?: readonly TakeSourceDepthSnapshot[];
};

function hasValidMoveCoordinates(startBeat: number, options?: MoveClipOptions): boolean {
    if (!Number.isFinite(startBeat) || startBeat < 0) {
        return false;
    }
    const endBeat = options?.historicalEndBeat;
    if (options?.historicalAudioSource && !isAudioSourceStateSnapshot(options.historicalAudioSource)) {
        return false;
    }
    if (endBeat === undefined) {
        return true;
    }
    return options?.historicalPlacement === true && Number.isFinite(endBeat) && endBeat > startBeat;
}

function isUnchangedPlacement(
    sourceTrackId: string,
    targetTrackId: string,
    oldStartBeat: number,
    oldEndBeat: number,
    startBeat: number,
    options?: MoveClipOptions
): boolean {
    return (
        sourceTrackId === targetTrackId &&
        Object.is(oldStartBeat, startBeat) &&
        (options?.historicalEndBeat === undefined || Object.is(oldEndBeat, options.historicalEndBeat))
    );
}

function resolveMovedAudioClip(
    sourceClip: Clip,
    movedClip: Clip,
    startBeat: number,
    options?: MoveClipOptions
): Clip | null {
    if (sourceClip.type !== 'audio') {
        return movedClip;
    }
    const source = options?.historicalAudioSource;
    if (source) {
        const restored: Clip = {
            ...movedClip,
            audioOffsetSeconds: source.audioOffsetSeconds ?? undefined,
            audioOffsetBeats: source.audioOffsetBeats ?? undefined,
        };
        if (source.audioOffsetSeconds === null) {
            delete restored.audioOffsetSeconds;
        }
        if (source.audioOffsetBeats === null) {
            delete restored.audioOffsetBeats;
        }
        return restored;
    }
    const sourceSeconds = audioSourceAtBeat(sourceClip, sourceClip.startBeat).audioOffsetSeconds;
    const targetTempo = readTempoAtBeat({ beat: startBeat });
    const targetBeats = (sourceSeconds * targetTempo) / 60;
    if (!Number.isFinite(sourceSeconds) || !Number.isFinite(targetBeats)) {
        return null;
    }
    return { ...movedClip, audioOffsetSeconds: sourceSeconds, audioOffsetBeats: targetBeats };
}

function prepareClipMovement(
    tracks: readonly Track[],
    clipId: string,
    targetTrackId: string,
    startBeat: number,
    options?: MoveClipOptions
): { sourceClip: Clip; movedClip: Clip; sourceTrackId: string; tracksWithoutClip: Track[] } | null {
    let sourceClip: Clip | undefined;
    let movedClip: Clip | undefined;
    let sourceTrackId: string | undefined;
    const tracksWithoutClip = tracks.map((track) => {
        const clip = track.clips.find((candidate) => candidate.id === clipId);
        if (clip) {
            if (clip.locked) {
                return track;
            }
            sourceClip = clip;
            sourceTrackId = track.id;
            movedClip = {
                ...clip,
                trackId: targetTrackId,
                startBeat,
                endBeat: options?.historicalEndBeat ?? startBeat + (clip.endBeat - clip.startBeat),
            };
        }
        return { ...track, clips: track.clips.filter((candidate) => candidate.id !== clipId) };
    });
    if (!sourceClip || !movedClip || !sourceTrackId) {
        return null;
    }
    return { sourceClip, movedClip, sourceTrackId, tracksWithoutClip };
}

export function moveClip(
    clipId: string,
    targetTrackId: string,
    startBeat: number,
    originalStartBeat?: number,
    moveAutomation = true,
    options?: MoveClipOptions
): boolean {
    const state = getTrackState();
    if (!state || !hasValidMoveCoordinates(startBeat, options)) {
        return false;
    }

    const targetTrack = state.tracks.find((track) => track.id === targetTrackId);
    if (!targetTrack || !getTrackEligibility(targetTrack.kind).acceptsClipUpdate) {
        return false;
    }

    const candidate = prepareClipMovement(state.tracks, clipId, targetTrackId, startBeat, options);
    if (!candidate) {
        return false;
    }
    const { sourceClip, sourceTrackId, tracksWithoutClip } = candidate;
    let movedClip = candidate.movedClip;
    // `acceptsClipUpdate` is true for bus/master/folder, but none of them
    // renders clip content: a clip moved there is never scheduled. The same
    // rule the timeline drop enforces, applied to every route through here —
    // except the undo replay, which restores a historical placement the
    // document already held (see `MoveClipOptions.historicalPlacement`), and
    // except a same-host move, which changes no placement: the host is
    // whatever the document already holds, so the rule has nothing to govern.
    // Refusing a same-host retime would strand a legacy misplaced clip (an
    // audio clip a pre-rule project parked on a MIDI track) against every
    // later drag on its own track. The AI placement bridge applies the same
    // exemption for its `moveClip`/`moveClips` arms, so a provider-driven
    // retime of such a clip is not rejected pre-dispatch with its own host
    // named as an invalid destination.
    const sameHost = sourceTrackId === targetTrackId;
    if (!sameHost && options?.historicalPlacement !== true && !isClipDropCompatible(movedClip.type, targetTrack.kind)) {
        return false;
    }
    if (
        isUnchangedPlacement(sourceTrackId, targetTrackId, sourceClip.startBeat, sourceClip.endBeat, startBeat, options)
    ) {
        return false;
    }

    const adjustedClip = resolveMovedAudioClip(sourceClip, movedClip, startBeat, options);
    if (!adjustedClip) {
        return false;
    }
    movedClip = adjustedClip;
    let takeSourcePlan: ReturnType<typeof prepareTakeSourceDepthMove> = null;
    if (sourceClip.type === 'audio') {
        takeSourcePlan = prepareTakeSourceDepthMove({
            clipId,
            oldTempo: readTempoAtBeat({ beat: sourceClip.startBeat }),
            newTempo: readTempoAtBeat({ beat: startBeat }),
            restore: options?.historicalTakeSources,
        });
        if (!takeSourcePlan) {
            return false;
        }
    }

    setTrackState({
        ...state,
        tracks: tracksWithoutClip.map((time) =>
            time.id === targetTrackId ? { ...time, clips: [...time.clips, movedClip] } : time
        ),
    });
    takeSourcePlan?.apply();

    // Automation: shift from the original drag start (preview doesn't shift automation)
    const automationDelta = startBeat - (originalStartBeat ?? sourceClip.startBeat);
    if (moveAutomation) {
        shiftClipAutomation(clipId, automationDelta, targetTrackId);
    }

    // MIDI: no shift — notes are stored clip-relative (playback position is
    // clip.startBeat + note.startBeat - midiOffsetBeats), so they follow the
    // clip's rectangle automatically. Shifting them here double-moved every
    // note on every drag (re-validation finding, ledger M-025 family).
    return true;
}
