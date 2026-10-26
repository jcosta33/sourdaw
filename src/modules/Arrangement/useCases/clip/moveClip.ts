import { shiftClipAutomation } from '#/modules/Automation/useCases';
import { shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';

import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { getTrackEligibility } from '../../stores/trackEligibility';

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
    /** Original cross-track array slot and its immediate neighbors. */
    historicalSlot?: { clipIndex: number; beforeClipId?: string; afterClipId?: string };
};

function historicalInsertionIndex(
    clips: readonly Clip[],
    clipId: string,
    slot: NonNullable<MoveClipOptions['historicalSlot']>
): number | null {
    const { clipIndex, beforeClipId, afterClipId } = slot;
    if (!validHistoricalSlot(slot, clipId)) {
        return null;
    }
    const before: number[] = [];
    const after: number[] = [];
    for (const [index, clip] of clips.entries()) {
        if (clip.id === beforeClipId) {
            before.push(index);
        }
        if (clip.id === afterClipId) {
            after.push(index);
        }
    }
    if (
        before.length > 1 ||
        after.length > 1 ||
        (before.length === 1 && after.length === 1 && before[0]! >= after[0]!)
    ) {
        return null;
    }
    if (after.length === 1) {
        return after[0]!;
    }
    if (before.length === 1) {
        return before[0]! + 1;
    }
    return Math.min(clipIndex, clips.length);
}

function validHistoricalSlot(slot: NonNullable<MoveClipOptions['historicalSlot']>, clipId: string): boolean {
    const { clipIndex, beforeClipId, afterClipId } = slot;
    if (
        !Number.isSafeInteger(clipIndex) ||
        clipIndex < 0 ||
        clipIndex > 0 !== (beforeClipId !== undefined) ||
        (beforeClipId !== undefined &&
            (typeof beforeClipId !== 'string' || beforeClipId.length === 0 || beforeClipId === clipId)) ||
        (afterClipId !== undefined &&
            (typeof afterClipId !== 'string' || afterClipId.length === 0 || afterClipId === clipId)) ||
        (beforeClipId !== undefined && beforeClipId === afterClipId)
    ) {
        return false;
    }
    return true;
}

function hasValidMoveCoordinates(startBeat: number, options?: MoveClipOptions): boolean {
    if (!Number.isFinite(startBeat) || startBeat < 0) {
        return false;
    }
    const endBeat = options?.historicalEndBeat;
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

function insertedCrossTrackClips(clips: readonly Clip[], clip: Clip, index: number): Clip[] {
    const result = [...clips];
    result.splice(index, 0, clip);
    return result;
}

function moveInsertionIndex(
    targetClips: readonly Clip[],
    clipId: string,
    sameHost: boolean,
    slot?: MoveClipOptions['historicalSlot']
): number | null {
    if (!sameHost && slot !== undefined) {
        return historicalInsertionIndex(targetClips, clipId, slot);
    }
    return targetClips.length;
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

    let movedClip: Clip | undefined;
    let oldStartBeat: number | undefined;
    let oldEndBeat: number | undefined;
    let sourceTrackId: string | undefined;
    const tracksWithoutClip = state.tracks.map((time) => {
        const clip = time.clips.find((context) => context.id === clipId);
        if (clip) {
            if (clip.locked) {
                return time;
            }
            oldStartBeat = clip.startBeat;
            oldEndBeat = clip.endBeat;
            sourceTrackId = time.id;
            movedClip = {
                ...clip,
                trackId: targetTrackId,
                startBeat,
                endBeat: options?.historicalEndBeat ?? startBeat + (clip.endBeat - clip.startBeat),
                // A drag changes the placement, never the content offset: the
                // loop anchor rides the same delta or every move re-derives
                // the loop window and the pass count from the new placement
                // (#4988) — a one-loop-length drag would silence the clip.
                ...shiftLoopOriginEntry(clip, startBeat - clip.startBeat),
            };
        }
        return { ...time, clips: time.clips.filter((context) => context.id !== clipId) };
    });

    if (!movedClip || oldStartBeat === undefined || oldEndBeat === undefined || sourceTrackId === undefined) {
        return false;
    }
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
    if (isUnchangedPlacement(sourceTrackId, targetTrackId, oldStartBeat, oldEndBeat, startBeat, options)) {
        return false;
    }

    const insertionIndex = moveInsertionIndex(targetTrack.clips, clipId, sameHost, options?.historicalSlot);
    if (insertionIndex === null) {
        return false;
    }

    const clipToMove = movedClip;
    // Array order controls overlap drawing and edge hit testing. A retime
    // keeps its slot so the forward move and historical restore preserve it.
    const tracks = (sameHost ? state.tracks : tracksWithoutClip).map((time) => {
        if (time.id !== targetTrackId) {
            return time;
        }
        let clips: Clip[];
        if (sameHost) {
            clips = time.clips.map((clip) => (clip.id === clipId ? clipToMove : clip));
        } else {
            clips = insertedCrossTrackClips(time.clips, clipToMove, insertionIndex);
        }
        return { ...time, clips };
    });
    setTrackState({ ...state, tracks });

    // Automation: shift from the original drag start (preview doesn't shift automation)
    const automationDelta = startBeat - (originalStartBeat ?? oldStartBeat);
    if (moveAutomation) {
        shiftClipAutomation(clipId, automationDelta, targetTrackId);
    }

    // MIDI: no shift — notes are stored clip-relative (playback position is
    // clip.startBeat + note.startBeat - midiOffsetBeats), so they follow the
    // clip's rectangle automatically. Shifting them here double-moved every
    // note on every drag (re-validation finding, ledger M-025 family).
    return true;
}
