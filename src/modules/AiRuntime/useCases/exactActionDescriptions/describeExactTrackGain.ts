import { resolveLevelFields, TRACK_FADER_LAW } from '#/utils/audioLevelLaw';
import { type AppAction } from '#/utils/handlerContract';

import { formatDecibelsFromGain } from './formatDecibelsFromGain';

/**
 * A level a command asked for in one of three forms, as the decibel figure it
 * lands on. The request is resolved against the level it is measured from —
 * the same measurement the handler makes — because a relative request states
 * a change, not a destination, and a confirmation that echoed the change as
 * though it were the destination would name a level the user never gets.
 * `null` when the request cannot land at all, so the caller can say what it
 * knows rather than invent a figure.
 */
function formatRequestedLevel(
    fields: { linear?: number; absoluteDb?: number; deltaDb?: number },
    current: number
): string | null {
    const requested = resolveLevelFields(fields, current, TRACK_FADER_LAW);
    return requested.ok ? formatDecibelsFromGain(requested.linear) : null;
}

/** The fader move of a bus the batch creates, or `null` for any other track. */
export function describeExactTrackGain(
    action: Extract<AppAction, { type: 'setTrackGain' }>,
    actions: readonly AppAction[]
): string | null {
    const createdTrack = actions.find(
        (candidate) => candidate.type === 'createBus' && candidate.payload.busId === action.payload.trackId
    );
    if (createdTrack?.type !== 'createBus') {
        return null;
    }
    const landing = formatRequestedLevel(
        {
            linear: action.payload.gain,
            absoluteDb: action.payload.gainDb,
            deltaDb: action.payload.deltaDb,
        },
        action.payload.expectedGain
    );
    if (landing === null) {
        return null;
    }
    return `Set "${createdTrack.payload.name}" (${action.payload.trackId}) fader from ${formatDecibelsFromGain(action.payload.expectedGain)} to ${landing}`;
}
