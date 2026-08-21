import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type AutomationLane } from '../../models/Automation';

/** `parameterId` of a track's own fader lane. */
const GAIN_PARAMETER_ID = 'gain';

/**
 * The ceiling a gain lane carried before the fader gained its `+6 dB` of
 * headroom, and the only stored value this derivation reinterprets.
 */
const LEGACY_GAIN_MAX_VALUE = 1;

/**
 * The ceiling a lane can actually be drawn to, derived from the fader law
 * rather than read straight off the stored scalar.
 *
 * `maxValue` is durable CRDT state written once when the lane is created, so a
 * gain lane made before the fader widened still stores `1` while one made after
 * stores {@link FADER_MAX_GAIN}. Left unreconciled that is two gain lanes in one
 * project with different Y scales, and the older one cannot be drawn into
 * headroom its own track's fader now reaches.
 *
 * Reconciling it at read time rather than by rewriting the stored value is not
 * a preference — a sanitizer that rewrites a scalar is indistinguishable from
 * document corruption to `findAutomergeStorageRawProjectionLosses`, which
 * compares the projection against the raw document with `Object.is`, and a
 * project holding a legacy gain lane would stall at repair-required instead of
 * opening. See the note on `automationStore`'s `sanitize`.
 *
 * Only the exact legacy default is reinterpreted: a lane whose range came from
 * a parameter-range resolver keeps the range that parameter defined, and a lane
 * for any other parameter is returned untouched.
 */
export function getAutomationLaneCeiling(lane: Pick<AutomationLane, 'parameterId' | 'maxValue'>): number {
    if (lane.parameterId === GAIN_PARAMETER_ID && lane.maxValue === LEGACY_GAIN_MAX_VALUE) {
        return FADER_MAX_GAIN;
    }
    return lane.maxValue;
}
