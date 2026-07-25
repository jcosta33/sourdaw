import {
    CC_DATA_DECREMENT,
    CC_DATA_ENTRY_LSB,
    CC_DATA_ENTRY_MSB,
    CC_DATA_INCREMENT,
    CC_NRPN_LSB,
    CC_NRPN_MSB,
    CC_RPN_LSB,
    CC_RPN_MSB,
    HIGH_RESOLUTION_MAX,
    MAX_BEND_RANGE_SEMITONES,
    SEVEN_BIT_MAX,
    clampSevenBit,
    combineHighResolution,
    createMidiChannelControllerState,
    getSelectedParameterNumber,
    highResolutionMsbCcFor,
    isDataEntryCc,
    isHighResolutionLsbCc,
    isHighResolutionMsbCc,
    isParameterSelectCc,
    isPitchBendSensitivitySelected,
    toBendRangeSemitones,
    type MidiChannelControllerState,
    type SelectedParameterKind,
} from '../../models/MidiControllerState';

import { channelControllerState } from './channelControllerState';

type IngestChannelControlChangeInput = {
    /** Zero-based MIDI channel the message arrived on. */
    channel: number;
    /** Controller number exactly as it came off the wire. */
    cc: number;
    /** Controller value exactly as it came off the wire (0..127). */
    value: number;
};

export type IngestChannelControlChangeOutput = {
    /**
     * True when the RPN/NRPN state machine took the message: parameter-number
     * selects (98/99/100/101) always, and Data Entry (6/38/96/97) while a
     * parameter is actually selected. A consumed message must not also be
     * dispatched as an ordinary CC, or setting a bend range would move
     * whatever the user mapped to controller 6.
     */
    consumed: boolean;
    /**
     * Controller the value belongs to. For the LSB half of a 14-bit pair this
     * is the *MSB* controller number, so a high-resolution device addresses
     * the same control it would at 7-bit.
     */
    cc: number;
    /** 7-bit value for consumers whose downstream contract is a MIDI data byte. */
    value: number;
    /** Full-resolution value, 0..16383. */
    value14: number;
    /**
     * Position in 0..1, exact at whichever resolution actually arrived —
     * `value / 127` for a 7-bit control and `value14 / 16383` for a resolved
     * pair. Never `value14 / 16383` on a 7-bit control: that would cap a
     * full-scale 127 at 0.992 and a volume CC could no longer reach unity.
     */
    normalized: number;
    /** True when an MSB/LSB pair was assembled for this controller. */
    highResolution: boolean;
};

function resolveChannelState(channel: number): MidiChannelControllerState {
    const existing = channelControllerState.get(channel);
    if (existing) {
        return existing;
    }
    const created = createMidiChannelControllerState();
    channelControllerState.set(channel, created);
    return created;
}

function sevenBitResult(cc: number, value: number): IngestChannelControlChangeOutput {
    return {
        consumed: false,
        cc,
        value,
        value14: value << 7,
        normalized: value / SEVEN_BIT_MAX,
        highResolution: false,
    };
}

function highResolutionResult(cc: number, value14: number): IngestChannelControlChangeOutput {
    return {
        consumed: false,
        cc,
        value: value14 >> 7,
        value14,
        normalized: value14 / HIGH_RESOLUTION_MAX,
        highResolution: true,
    };
}

function consumedResult(cc: number, value: number): IngestChannelControlChangeOutput {
    return { ...sevenBitResult(cc, value), consumed: true };
}

function selectParameter(
    state: MidiChannelControllerState,
    kind: SelectedParameterKind,
    isMsb: boolean,
    value: number
): void {
    if (state.selectedParameterKind !== kind) {
        // Switching banks abandons the other bank's half-written number; keeping
        // it would let an RPN MSB and an NRPN LSB compose a parameter neither
        // the device nor we ever meant to select.
        state.selectedParameterMsb = 0;
        state.selectedParameterLsb = 0;
    }
    state.selectedParameterKind = kind;
    if (isMsb) {
        state.selectedParameterMsb = value;
    } else {
        state.selectedParameterLsb = value;
    }
    // A new parameter starts with no data written to it.
    state.dataEntryMsb = 0;
    state.dataEntryLsb = 0;
}

function applyParameterSelect(state: MidiChannelControllerState, cc: number, value: number): void {
    if (cc === CC_RPN_MSB) {
        selectParameter(state, 'rpn', true, value);
        return;
    }
    if (cc === CC_RPN_LSB) {
        selectParameter(state, 'rpn', false, value);
        return;
    }
    if (cc === CC_NRPN_MSB) {
        selectParameter(state, 'nrpn', true, value);
        return;
    }
    if (cc === CC_NRPN_LSB) {
        selectParameter(state, 'nrpn', false, value);
    }
}

function stepBendRange(state: MidiChannelControllerState, step: number): void {
    const current = state.bendRangeSemitones ?? toBendRangeSemitones(state.dataEntryMsb, state.dataEntryLsb);
    const next = Math.max(0, Math.min(MAX_BEND_RANGE_SEMITONES, current + step));
    const semitones = Math.trunc(next);
    state.bendRangeSemitones = next;
    state.dataEntryMsb = semitones;
    state.dataEntryLsb = Math.round((next - semitones) * 100);
}

function applyDataEntry(state: MidiChannelControllerState, cc: number, value: number): void {
    // Data Entry always advances the selected parameter's tracked bytes. Only
    // RPN 0 has a meaning we act on; an NRPN or any other RPN writes its own
    // parameter, which we do not implement — the bytes are consumed and
    // deliberately dropped rather than leaking into the bend range.
    const isPitchBendSensitivity = isPitchBendSensitivitySelected(state);

    if (cc === CC_DATA_ENTRY_MSB) {
        state.dataEntryMsb = value;
        // The MSB is the whole-unit half; a fresh one supersedes the fractional
        // remainder of the previous value rather than combining with it.
        state.dataEntryLsb = 0;
        if (isPitchBendSensitivity) {
            state.bendRangeSemitones = toBendRangeSemitones(value, 0);
        }
        return;
    }

    if (cc === CC_DATA_ENTRY_LSB) {
        state.dataEntryLsb = value;
        if (isPitchBendSensitivity) {
            state.bendRangeSemitones = toBendRangeSemitones(state.dataEntryMsb, value);
        }
        return;
    }

    if (!isPitchBendSensitivity) {
        return;
    }
    if (cc === CC_DATA_INCREMENT) {
        stepBendRange(state, 1);
        return;
    }
    if (cc === CC_DATA_DECREMENT) {
        stepBendRange(state, -1);
    }
}

function ingestHighResolutionMsb(
    state: MidiChannelControllerState,
    cc: number,
    value: number
): IngestChannelControlChangeOutput {
    const entry = state.highResolution.get(cc);
    if (!entry) {
        state.highResolution.set(cc, { msb: value, lsb: undefined });
        return sevenBitResult(cc, value);
    }

    entry.msb = value;
    if (entry.lsb === undefined) {
        // This device has never sent the LSB half, so the controller is still
        // a plain 7-bit control and 127 must still mean full scale.
        return sevenBitResult(cc, value);
    }
    entry.lsb = 0;
    return highResolutionResult(cc, combineHighResolution(value, 0));
}

function ingestHighResolutionLsb(
    state: MidiChannelControllerState,
    cc: number,
    value: number
): IngestChannelControlChangeOutput {
    const msbCc = highResolutionMsbCcFor(cc);
    const entry = state.highResolution.get(msbCc);
    if (!entry) {
        // An LSB with no MSB ever seen is not half of a pair — controllers
        // 32..63 are legal 7-bit controls in their own right, and a mapping
        // learned directly on one must keep working.
        return sevenBitResult(cc, value);
    }
    entry.lsb = value;
    return highResolutionResult(msbCc, combineHighResolution(entry.msb, value));
}

/**
 * Decode one incoming Control Change against its channel's controller state,
 * assembling 14-bit pairs (MD-7) and running the RPN state machine that owns
 * pitch-bend sensitivity (MD-8).
 *
 * Wire format is untouched: the caller still receives the raw bytes and this
 * only tells it what they mean.
 */
export function ingestChannelControlChange({
    channel,
    cc,
    value,
}: IngestChannelControlChangeInput): IngestChannelControlChangeOutput {
    const state = resolveChannelState(channel);
    const byte = clampSevenBit(value);

    if (isParameterSelectCc(cc)) {
        applyParameterSelect(state, cc, byte);
        return consumedResult(cc, byte);
    }

    // Data Entry only belongs to a parameter while one is selected. After the
    // Null RPN (0x3FFF) nothing is, which is exactly why controllers send it —
    // so controller 6 goes back to being an ordinary control.
    if (isDataEntryCc(cc) && getSelectedParameterNumber(state) !== null) {
        applyDataEntry(state, cc, byte);
        return consumedResult(cc, byte);
    }

    if (isHighResolutionMsbCc(cc)) {
        return ingestHighResolutionMsb(state, cc, byte);
    }

    if (isHighResolutionLsbCc(cc)) {
        return ingestHighResolutionLsb(state, cc, byte);
    }

    return sevenBitResult(cc, byte);
}
