import { shiftClipAutomation } from '#/modules/Automation/useCases';

import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { applyTakeReKeyTransitions } from '../comping/applyTakeReKeyTransitions';
import { captureClipMoveTakeReKeyTransitions } from '../comping/captureClipMoveTakeReKey';
import { type TakeReKeyLaneTransition } from '../comping/takeReKeyTransition';

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
};

export function moveClip(
    clipId: string,
    targetTrackId: string,
    startBeat: number,
    originalStartBeat?: number,
    moveAutomation = true,
    options?: MoveClipOptions
): boolean {
    const state = getTrackState();
    if (!state || !Number.isFinite(startBeat) || startBeat < 0) {
        return false;
    }

    const targetTrack = state.tracks.find((track) => track.id === targetTrackId);
    if (!targetTrack || !getTrackEligibility(targetTrack.kind).acceptsClipUpdate) {
        return false;
    }

    let movedClip: Clip | undefined;
    let oldStartBeat: number | undefined;
    let sourceTrackId: string | undefined;
    const tracksWithoutClip = state.tracks.map((time) => {
        const clip = time.clips.find((context) => context.id === clipId);
        if (clip) {
            if (clip.locked) {
                return time;
            }
            oldStartBeat = clip.startBeat;
            sourceTrackId = time.id;
            movedClip = {
                ...clip,
                trackId: targetTrackId,
                startBeat,
                endBeat: startBeat + (clip.endBeat - clip.startBeat),
            };
        }
        return { ...time, clips: time.clips.filter((context) => context.id !== clipId) };
    });

    if (!movedClip || oldStartBeat === undefined || sourceTrackId === undefined) {
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
    if (sameHost && Object.is(oldStartBeat, startBeat)) {
        return false;
    }

    // #5100 — the comping travels with the clip: takes and comp regions are
    // timeline-anchored, so the moved clip's lane re-keys onto the new span the
    // same way Delete Time re-keys regions (#4841). The undo/redo replays of
    // this use case (restoreClipPlacement, restoreClipMoves) pass through here
    // with the reverse geometry, so the same capture restores what the forward
    // move shifted. A cross-host move would have to migrate the lane to the
    // target track — no route owns that, so the comp stays behind, as before.
    let takeReKeyTransitions: readonly TakeReKeyLaneTransition[] = [];
    if (sameHost) {
        takeReKeyTransitions = captureClipMoveTakeReKeyTransitions({
            trackId: sourceTrackId,
            clipId,
            fromStartBeat: oldStartBeat,
            fromEndBeat: oldStartBeat + (movedClip.endBeat - movedClip.startBeat),
            toStartBeat: movedClip.startBeat,
            toEndBeat: movedClip.endBeat,
        });
    }

    setTrackState({
        ...state,
        tracks: tracksWithoutClip.map((time) =>
            time.id === targetTrackId ? { ...time, clips: [...time.clips, movedClip!] } : time
        ),
    });

    if (takeReKeyTransitions.length > 0) {
        applyTakeReKeyTransitions(takeReKeyTransitions);
    }

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
