import { prepareClipMidiRowCoordinateShift } from '#/modules/MIDI/useCases';
import { hasExactAudioSourceFields } from '#/utils/hasExactAudioSourceFields';

import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { findClipById } from '../../services/findClipById';

import { planStartTrim } from './planStartTrim';
import { prepareAudioClipStartTrim } from './prepareAudioClipStartTrim';

function requiresAudioSourceTrim(clip: Clip, restoredAnchor: number | null | undefined): boolean {
    // An old anchor-bearing inverse captured beat coordinates only. Keep its
    // absent source tuple absent so earlier whole-track captures still match.
    // Present malformed modern fields must still reach strict source validation.
    return (
        clip.type === 'audio' &&
        (restoredAnchor === undefined || Object.hasOwn(clip, 'audioOffsetSeconds') || !hasExactAudioSourceFields(clip))
    );
}

function canTrimClipStart(clipId: string, newStartBeat: number, restoreAnchorBeat: number | null | undefined): boolean {
    try {
        const state = getTrackState();
        if (state) {
            const target = findClipById({ clipId, tracks: state.tracks });
            if (target && newStartBeat >= target.clip.endBeat) {
                return false;
            }
            if (
                target &&
                requiresAudioSourceTrim(target.clip, restoreAnchorBeat) &&
                !prepareAudioClipStartTrim(target.clip, newStartBeat)
            ) {
                return false;
            }
        }
    } catch {
        return false;
    }

    return true;
}

function trimAudioSource(context: Clip, newStartBeat: number, restoreAnchorBeat: number | null | undefined): Clip {
    const trimmed = prepareAudioClipStartTrim(context, newStartBeat);
    if (!trimmed || restoreAnchorBeat === undefined) {
        return trimmed ?? context;
    }
    if (restoreAnchorBeat === null) {
        delete trimmed.loopOriginBeat;
    } else {
        trimmed.loopOriginBeat = restoreAnchorBeat;
    }
    return trimmed;
}

/**
 * Trims a clip's start. `anchorBeat` is the restore leg's exact-anchor form
 * (#5198): a recorded inverse carries the pre-action anchor state so BOTH
 * replay directions restore it — a value puts that anchor back, `null`
 * records a clip that carried none and removes any key the action minted (an
 * extension-undo replaying a rightward trim must stay anchorless, not mint at
 * the extension start). Absent — a fresh trim, or a legacy entry — keeps the
 * mint law below exactly as it always was. `restoredMidiOffsetBeats` is the
 * restore leg's exact-offset form (#5512): the pre-action stored offset a
 * recorded inverse captures, restored verbatim — see the midi branch below
 * for the arithmetic that demands it. Absent keeps the re-wrapping law.
 */
export function trimClipStart(
    clipId: string,
    newStartBeat: number,
    anchorBeat?: number | null,
    restoredMidiOffsetBeats?: number,
    rowCoordinates?: {
        restore?: unknown;
        refused?: boolean;
        capture?: Extract<ReturnType<typeof prepareClipMidiRowCoordinateShift>, { status: 'prepared' }>['capture'];
    }
): boolean {
    if (!Number.isFinite(newStartBeat)) {
        return false;
    }
    // A non-finite anchor is corrupted data, not an anchor state (#5198): a
    // persisted `1e999` decodes as Infinity, and writing it into clip state
    // derives a NaN loop window in every reader. Drop it to the absent form —
    // exactly the behavior a payload without the field gets.
    const restoreAnchorBeat = anchorBeat !== null && !Number.isFinite(anchorBeat) ? undefined : anchorBeat;
    // A non-finite offset capture is corrupted data on the same channel as the
    // anchor above (#5512): a persisted `1e999` decodes as Infinity, and
    // restoring it verbatim writes Infinity into clip state and shifts every
    // stored row by it. Drop it to the absent form — exactly the behavior a
    // payload without the field gets.
    const restoreMidiOffsetBeats =
        restoredMidiOffsetBeats !== undefined && !Number.isFinite(restoredMidiOffsetBeats)
            ? undefined
            : restoredMidiOffsetBeats;

    if (!canTrimClipStart(clipId, newStartBeat, restoreAnchorBeat)) {
        return false;
    }

    const refused = new Error('The complete MIDI coordinate shift could not be applied');
    let capture:
        Extract<ReturnType<typeof prepareClipMidiRowCoordinateShift>, { status: 'prepared' }>['capture'] | undefined;
    function applyMidiRows(beatDelta: number): void {
        const plan = prepareClipMidiRowCoordinateShift({ clipId, beatDelta, restore: rowCoordinates?.restore });
        if (plan.status === 'refused' || !plan.apply()) {
            throw refused;
        }
        capture = plan.capture;
    }
    try {
        const didWrite = updateClip(clipId, (context) => {
            if (requiresAudioSourceTrim(context, restoreAnchorBeat)) {
                return trimAudioSource(context, newStartBeat, restoreAnchorBeat);
            }
            const plan = planStartTrim(context, newStartBeat, restoreAnchorBeat, restoreMidiOffsetBeats);
            if (plan === null) {
                return context;
            }
            if (plan === 'refused') {
                throw refused;
            }
            if (plan.rowShiftBeats !== null) {
                applyMidiRows(plan.rowShiftBeats);
            }
            return plan.clip;
        });
        if (didWrite && rowCoordinates && capture) {
            rowCoordinates.capture = capture;
        }
        return didWrite;
    } catch (error) {
        if (error === refused) {
            if (rowCoordinates) {
                rowCoordinates.refused = true;
            }
            return false;
        }
        throw error;
    }
}
