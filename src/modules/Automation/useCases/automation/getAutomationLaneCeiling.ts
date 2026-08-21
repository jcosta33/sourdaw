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
 * Only the exact legacy default is reinterpreted, and only on a lane that is
 * unambiguously a track fader's own:
 *
 * - `maxValue` must be the legacy `1`. A lane whose range came from a
 *   parameter-range resolver keeps the range that parameter defined.
 * - `minValue` must be `0`. A gain lane with `minValue < 0` is a **decibel**
 *   lane — `automationScheduling.ts` reads exactly that predicate and applies
 *   `dbToGain(value)` — so its `maxValue: 1` means `+1 dB`, and reinterpreting
 *   it as {@link FADER_MAX_GAIN} would hand back a number in the wrong unit.
 * - `clipId` must be absent. A clip's own gain lane is bounded by the clip, not
 *   by the track fader that this widening is about.
 */
export function getAutomationLaneCeiling(
    lane: Pick<AutomationLane, 'parameterId' | 'maxValue' | 'minValue' | 'clipId'>
): number {
    if (
        lane.parameterId === GAIN_PARAMETER_ID &&
        lane.maxValue === LEGACY_GAIN_MAX_VALUE &&
        lane.minValue === 0 &&
        lane.clipId === undefined
    ) {
        return FADER_MAX_GAIN;
    }
    return lane.maxValue;
}
