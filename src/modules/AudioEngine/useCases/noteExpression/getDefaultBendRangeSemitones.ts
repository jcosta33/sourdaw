import { MPE_MEMBER_BEND_RANGE_SEMITONES } from '../../engine/noteExpression';

/**
 * The bend range `applyNoteExpression` assumes when a caller does not supply
 * one — the MPE member-channel default of ±48 semitones (MPE v1.0 §2.2).
 *
 * Exposed so the MIDI module's RPN 0 resolver (audit MD-8) can fall back to
 * the *same* number the expression surface would have used, instead of
 * restating 48 next to it. There is one definition of this constant
 * (`engine/noteExpression.ts`) and this is its only way out of the module.
 */
export function getDefaultBendRangeSemitones(): number {
    return MPE_MEMBER_BEND_RANGE_SEMITONES;
}
