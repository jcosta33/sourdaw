import {
    CC_DATA_DECREMENT,
    CC_DATA_ENTRY_LSB,
    CC_DATA_ENTRY_MSB,
    CC_DATA_INCREMENT,
    CC_NRPN_LSB,
    CC_NRPN_MSB,
    CC_RPN_LSB,
    CC_RPN_MSB,
    MAX_BEND_RANGE_SEMITONES,
    getSelectedParameterNumber,
    isDataEntryCc,
    isParameterSelectCc,
    isPitchBendSensitivitySelected,
    toBendRangeSemitones,
    type MidiChannelControllerState,
    type SelectedParameterKind,
} from '../models/MidiControllerState';

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

/**
 * Run one Control Change through a channel's RPN/NRPN state machine (MD-8): parameter-number
 * selects (98 to 101) always, and Data Entry (6, 38, 96, 97) while a parameter is selected.
 * Returns whether the machine took the message; one it did not take is an ordinary controller,
 * so after the Null RPN (0x3FFF) controller 6 goes back to being a plain control.
 *
 * The one machine both the live input (`ingestChannelControlChange`) and stored playback
 * (`createStoredBendRangeReader`, reading the RPN rows a take recorded) decode through, so a
 * bend range means the same thing live and replayed.
 */
export function applyRegisteredParameterChange(state: MidiChannelControllerState, cc: number, value: number): boolean {
    if (isParameterSelectCc(cc)) {
        applyParameterSelect(state, cc, value);
        return true;
    }
    if (isDataEntryCc(cc) && getSelectedParameterNumber(state) !== null) {
        applyDataEntry(state, cc, value);
        return true;
    }
    return false;
}
