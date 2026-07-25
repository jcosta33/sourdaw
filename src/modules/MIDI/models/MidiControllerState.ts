/**
 * Channel-mode decoding for incoming Control Change traffic (audit MD-7, MD-8).
 *
 * Two things ride the same CC byte stream and neither was decoded before:
 *
 *  • **High-resolution (14-bit) controllers.** Controllers 0–31 carry the MSB
 *    of a value whose LSB arrives on controller `n + 32`. Treating every CC as
 *    7-bit collapses a 16384-step controller to 128 steps (MD-7).
 *  • **Registered Parameters (RPN).** Controllers 101/100 select a parameter
 *    number and 6/38/96/97 write it. RPN 0 is Pitch Bend Sensitivity — the
 *    controller telling us what its own bend range is, which we previously
 *    ignored in favour of a hard-coded ±2 / ±48 (MD-8).
 *
 * The two overlap on purpose: Data Entry is controllers 6/38, which is itself
 * an MSB/LSB pair inside the 0–31 / 32–63 range. Parameter selection therefore
 * has to be decoded *first*, or setting a bend range would also move whatever
 * the user mapped to controller 6.
 *
 * Everything here is pure: state is passed in and read, never fetched. The
 * mutable per-channel holder lives in the repository layer.
 */

/** Lowest controller number that carries the MSB of a 14-bit pair. */
export const HIGH_RESOLUTION_MSB_MIN = 0;
/** Highest controller number that carries the MSB of a 14-bit pair. */
export const HIGH_RESOLUTION_MSB_MAX = 31;
/** Distance from a 14-bit controller's MSB number to its LSB number. */
export const HIGH_RESOLUTION_LSB_OFFSET = 32;

export const CC_DATA_ENTRY_MSB = 6;
export const CC_DATA_ENTRY_LSB = 38;
export const CC_DATA_INCREMENT = 96;
export const CC_DATA_DECREMENT = 97;
export const CC_NRPN_LSB = 98;
export const CC_NRPN_MSB = 99;
export const CC_RPN_LSB = 100;
export const CC_RPN_MSB = 101;

/**
 * Channel-mode messages (MIDI 1.0 Table 3). They share the Control Change
 * status byte but are not controllers: they address the channel itself.
 */
export const CC_ALL_SOUND_OFF = 120;
export const CC_RESET_ALL_CONTROLLERS = 121;
export const CC_ALL_NOTES_OFF = 123;

/** RPN 0 — Pitch Bend Sensitivity: MSB is semitones, LSB is cents. */
export const RPN_PITCH_BEND_SENSITIVITY = 0;

/**
 * Parameter number 0x3FFF — the Null RPN. Controllers send it after a data
 * entry precisely so a later, unrelated Data Entry cannot land on the
 * parameter they just wrote. Selecting it means "nothing is selected".
 */
export const PARAMETER_NUMBER_NULL = 0x3fff;

/** Bend range of a non-MPE channel that has never sent RPN 0 (MIDI 1.0 default). */
export const STANDARD_BEND_RANGE_SEMITONES = 2;

/** Widest bend range RPN 0's semitone byte can express. */
export const MAX_BEND_RANGE_SEMITONES = 127;

/** Full-scale value of a 14-bit controller pair. */
export const HIGH_RESOLUTION_MAX = 16383;

/** Full-scale value of a single 7-bit controller byte. */
export const SEVEN_BIT_MAX = 127;

/** MPE lower-zone master channel (zero-based), where zone-wide RPN 0 lands. */
export const MPE_MASTER_CHANNEL = 0;

/** First MPE member channel (zero-based); members own per-note expression. */
export const MPE_FIRST_MEMBER_CHANNEL = 1;

/** Which parameter bank the last 98/99/100/101 selected. */
export type SelectedParameterKind = 'rpn' | 'nrpn';

/** One MIDI channel's decoded controller state. */
export type MidiChannelControllerState = {
    /**
     * Latched high-resolution pairs, keyed by MSB controller number. `lsb`
     * stays `undefined` until the controller actually sends one — a device
     * that only ever sends the MSB keeps full 7-bit semantics (127 means
     * full scale, not 16256/16383).
     */
    highResolution: Map<number, { msb: number; lsb: number | undefined }>;
    /** Bank the last parameter-select CC chose. */
    selectedParameterKind: SelectedParameterKind | null;
    /** Selected parameter number MSB (controller 101 for RPN, 99 for NRPN). */
    selectedParameterMsb: number;
    /** Selected parameter number LSB (controller 100 for RPN, 98 for NRPN). */
    selectedParameterLsb: number;
    /** Last Data Entry MSB written to the selected parameter. */
    dataEntryMsb: number;
    /** Last Data Entry LSB written to the selected parameter. */
    dataEntryLsb: number;
    /**
     * Pitch-bend sensitivity in semitones as this channel declared it via
     * RPN 0. `undefined` means the controller never said, so the caller's
     * default applies.
     */
    bendRangeSemitones: number | undefined;
};

export function createMidiChannelControllerState(): MidiChannelControllerState {
    return {
        highResolution: new Map(),
        selectedParameterKind: null,
        selectedParameterMsb: 0,
        selectedParameterLsb: 0,
        dataEntryMsb: 0,
        dataEntryLsb: 0,
        bendRangeSemitones: undefined,
    };
}

/** True for a controller number that carries the MSB half of a 14-bit pair. */
export function isHighResolutionMsbCc(cc: number): boolean {
    return cc >= HIGH_RESOLUTION_MSB_MIN && cc <= HIGH_RESOLUTION_MSB_MAX;
}

/** True for a controller number that carries the LSB half of a 14-bit pair. */
export function isHighResolutionLsbCc(cc: number): boolean {
    return (
        cc >= HIGH_RESOLUTION_MSB_MIN + HIGH_RESOLUTION_LSB_OFFSET &&
        cc <= HIGH_RESOLUTION_MSB_MAX + HIGH_RESOLUTION_LSB_OFFSET
    );
}

/** The MSB controller number an LSB controller number refines. */
export function highResolutionMsbCcFor(lsbCc: number): number {
    return lsbCc - HIGH_RESOLUTION_LSB_OFFSET;
}

/** True for the four controllers that exist only to select a parameter number. */
export function isParameterSelectCc(cc: number): boolean {
    return cc === CC_NRPN_LSB || cc === CC_NRPN_MSB || cc === CC_RPN_LSB || cc === CC_RPN_MSB;
}

/** True for the four controllers that write the selected parameter's value. */
export function isDataEntryCc(cc: number): boolean {
    return cc === CC_DATA_ENTRY_MSB || cc === CC_DATA_ENTRY_LSB || cc === CC_DATA_INCREMENT || cc === CC_DATA_DECREMENT;
}

/** Assemble a 14-bit controller value from its two 7-bit halves. */
export function combineHighResolution(msb: number, lsb: number): number {
    return ((clampSevenBit(msb) << 7) | clampSevenBit(lsb)) & HIGH_RESOLUTION_MAX;
}

/** Clamp a byte to the 0..127 range a MIDI data byte can legally hold. */
export function clampSevenBit(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(SEVEN_BIT_MAX, Math.trunc(value)));
}

/**
 * The parameter number currently selected on a channel, or `null` when none is
 * — either nothing was ever selected or the controller sent the Null RPN.
 */
export function getSelectedParameterNumber(state: MidiChannelControllerState): number | null {
    if (state.selectedParameterKind === null) {
        return null;
    }
    const number = combineHighResolution(state.selectedParameterMsb, state.selectedParameterLsb);
    if (number === PARAMETER_NUMBER_NULL) {
        return null;
    }
    return number;
}

/** True when this channel's selected parameter is RPN 0, Pitch Bend Sensitivity. */
export function isPitchBendSensitivitySelected(state: MidiChannelControllerState): boolean {
    if (state.selectedParameterKind !== 'rpn') {
        return false;
    }
    return getSelectedParameterNumber(state) === RPN_PITCH_BEND_SENSITIVITY;
}

/**
 * RPN 0's two bytes as a semitone range: MSB is whole semitones, LSB is cents.
 * Cents are clamped to 0..99 — a controller sending 100+ would otherwise push
 * the range past the next whole semitone the MSB already accounts for.
 */
export function toBendRangeSemitones(dataEntryMsb: number, dataEntryLsb: number): number {
    const semitones = Math.max(0, Math.min(MAX_BEND_RANGE_SEMITONES, clampSevenBit(dataEntryMsb)));
    const cents = Math.max(0, Math.min(99, clampSevenBit(dataEntryLsb)));
    return semitones + cents / 100;
}
