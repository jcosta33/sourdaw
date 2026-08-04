import { describe, it, expect } from 'vitest';

import {
    combineHighResolution,
    clampSevenBit,
    toBendRangeSemitones,
    getSelectedParameterNumber,
    isPitchBendSensitivitySelected,
    isHighResolutionMsbCc,
    isHighResolutionLsbCc,
    highResolutionMsbCcFor,
    isParameterSelectCc,
    isDataEntryCc,
    createMidiChannelControllerState,
    HIGH_RESOLUTION_MSB_MIN,
    HIGH_RESOLUTION_MSB_MAX,
    HIGH_RESOLUTION_LSB_OFFSET,
    HIGH_RESOLUTION_MAX,
    RPN_PITCH_BEND_SENSITIVITY,
    CC_DATA_ENTRY_MSB,
    CC_DATA_ENTRY_LSB,
    CC_DATA_INCREMENT,
    CC_DATA_DECREMENT,
    CC_NRPN_LSB,
    CC_NRPN_MSB,
    CC_RPN_LSB,
    CC_RPN_MSB,
} from '../MidiControllerState';

describe('clampSevenBit', () => {
    it('returns 0 for NaN', () => {
        expect(clampSevenBit(Number.NaN)).toBe(0);
    });

    it('returns 0 for Infinity', () => {
        expect(clampSevenBit(Number.POSITIVE_INFINITY)).toBe(0);
    });

    it('clamps negative values to 0', () => {
        expect(clampSevenBit(-5)).toBe(0);
    });

    it('clamps values > 127 to 127', () => {
        expect(clampSevenBit(200)).toBe(127);
    });

    it('truncates floats to integers', () => {
        expect(clampSevenBit(64.9)).toBe(64);
    });

    it('passes valid values through (truncated)', () => {
        expect(clampSevenBit(0)).toBe(0);
        expect(clampSevenBit(127)).toBe(127);
        expect(clampSevenBit(64)).toBe(64);
    });
});

describe('combineHighResolution', () => {
    it('assembles a 14-bit value from MSB and LSB halves', () => {
        // MSB=1 (<<7 = 128), LSB=0 → 128
        expect(combineHighResolution(1, 0)).toBe(128);
        // MSB=0, LSB=127 → 127
        expect(combineHighResolution(0, 127)).toBe(127);
    });

    it('maximum value is 16383 (MSB=127, LSB=127)', () => {
        expect(combineHighResolution(127, 127)).toBe(HIGH_RESOLUTION_MAX);
    });

    it('minimum value is 0 (MSB=0, LSB=0)', () => {
        expect(combineHighResolution(0, 0)).toBe(0);
    });

    it('clamps MSB and LSB to 7-bit before combining', () => {
        // MSB=200 → clamped to 127, LSB=200 → clamped to 127 → 16383
        expect(combineHighResolution(200, 200)).toBe(HIGH_RESOLUTION_MAX);
    });

    it('treats NaN inputs as 0', () => {
        expect(combineHighResolution(Number.NaN, Number.NaN)).toBe(0);
    });

    it('MSB and LSB with known bit pattern', () => {
        // MSB=64 (1000000), LSB=64 (1000000) → 10000001000000 = 8256
        expect(combineHighResolution(64, 64)).toBe(8256);
    });
});

describe('toBendRangeSemitones', () => {
    it('converts whole semitones with zero cents', () => {
        expect(toBendRangeSemitones(12, 0)).toBe(12);
    });

    it('adds fractional cents (50 cents = 0.5 semitones)', () => {
        expect(toBendRangeSemitones(2, 50)).toBeCloseTo(2.5, 5);
    });

    it('clamps cents to a maximum of 99 (not 127)', () => {
        // 127 cents would be > 1 semitone. Clamped to 99 → 0.99.
        expect(toBendRangeSemitones(0, 127)).toBeCloseTo(0.99, 5);
    });

    it('clamps semitones to a maximum of 127', () => {
        expect(toBendRangeSemitones(200, 0)).toBe(127);
    });

    it('clamps negative values to 0', () => {
        expect(toBendRangeSemitones(-5, -10)).toBe(0);
    });

    it('full range: 127 semitones + 99 cents = 127.99', () => {
        expect(toBendRangeSemitones(127, 99)).toBeCloseTo(127.99, 5);
    });
});

describe('getSelectedParameterNumber', () => {
    it('returns null when no parameter kind is selected', () => {
        const state = createMidiChannelControllerState();
        expect(getSelectedParameterNumber(state)).toBeNull();
    });

    it('returns the assembled 14-bit parameter number for RPN', () => {
        const state = createMidiChannelControllerState();
        state.selectedParameterKind = 'rpn';
        state.selectedParameterMsb = 0;
        state.selectedParameterLsb = 0;
        expect(getSelectedParameterNumber(state)).toBe(RPN_PITCH_BEND_SENSITIVITY);
    });

    it('returns null when the selected number equals PARAMETER_NUMBER_NULL (0x3FFF)', () => {
        const state = createMidiChannelControllerState();
        state.selectedParameterKind = 'rpn';
        state.selectedParameterMsb = 127;
        state.selectedParameterLsb = 127;
        expect(getSelectedParameterNumber(state)).toBeNull();
    });

    it('returns a non-null number for NRPN selection', () => {
        const state = createMidiChannelControllerState();
        state.selectedParameterKind = 'nrpn';
        state.selectedParameterMsb = 1;
        state.selectedParameterLsb = 0;
        // 1 << 7 = 128
        expect(getSelectedParameterNumber(state)).toBe(128);
    });
});

describe('isPitchBendSensitivitySelected', () => {
    it('returns true when RPN 0 is selected', () => {
        const state = createMidiChannelControllerState();
        state.selectedParameterKind = 'rpn';
        state.selectedParameterMsb = 0;
        state.selectedParameterLsb = 0;
        expect(isPitchBendSensitivitySelected(state)).toBe(true);
    });

    it('returns false when NRPN is selected (even with number 0)', () => {
        const state = createMidiChannelControllerState();
        state.selectedParameterKind = 'nrpn';
        state.selectedParameterMsb = 0;
        state.selectedParameterLsb = 0;
        expect(isPitchBendSensitivitySelected(state)).toBe(false);
    });

    it('returns false when a different RPN is selected', () => {
        const state = createMidiChannelControllerState();
        state.selectedParameterKind = 'rpn';
        state.selectedParameterMsb = 1;
        state.selectedParameterLsb = 0;
        expect(isPitchBendSensitivitySelected(state)).toBe(false);
    });

    it('returns false when nothing is selected', () => {
        const state = createMidiChannelControllerState();
        expect(isPitchBendSensitivitySelected(state)).toBe(false);
    });
});

describe('CC classification predicates', () => {
    describe('isHighResolutionMsbCc', () => {
        it('returns true for CC 0..31', () => {
            expect(isHighResolutionMsbCc(HIGH_RESOLUTION_MSB_MIN)).toBe(true);
            expect(isHighResolutionMsbCc(HIGH_RESOLUTION_MSB_MAX)).toBe(true);
            expect(isHighResolutionMsbCc(15)).toBe(true);
        });

        it('returns false outside 0..31', () => {
            expect(isHighResolutionMsbCc(32)).toBe(false);
            expect(isHighResolutionMsbCc(64)).toBe(false);
        });
    });

    describe('isHighResolutionLsbCc', () => {
        it('returns true for CC 32..63', () => {
            expect(isHighResolutionLsbCc(HIGH_RESOLUTION_MSB_MIN + HIGH_RESOLUTION_LSB_OFFSET)).toBe(true);
            expect(isHighResolutionLsbCc(HIGH_RESOLUTION_MSB_MAX + HIGH_RESOLUTION_LSB_OFFSET)).toBe(true);
            expect(isHighResolutionLsbCc(47)).toBe(true);
        });

        it('returns false outside 32..63', () => {
            expect(isHighResolutionLsbCc(31)).toBe(false);
            expect(isHighResolutionLsbCc(64)).toBe(false);
        });
    });

    describe('highResolutionMsbCcFor', () => {
        it('returns the MSB CC number for a given LSB CC', () => {
            expect(highResolutionMsbCcFor(32)).toBe(0);
            expect(highResolutionMsbCcFor(63)).toBe(31);
            expect(highResolutionMsbCcFor(38)).toBe(CC_DATA_ENTRY_MSB);
        });
    });

    describe('isParameterSelectCc', () => {
        it('returns true for CC 98, 99, 100, 101', () => {
            expect(isParameterSelectCc(CC_NRPN_LSB)).toBe(true);
            expect(isParameterSelectCc(CC_NRPN_MSB)).toBe(true);
            expect(isParameterSelectCc(CC_RPN_LSB)).toBe(true);
            expect(isParameterSelectCc(CC_RPN_MSB)).toBe(true);
        });

        it('returns false for non-parameter-select CCs', () => {
            expect(isParameterSelectCc(0)).toBe(false);
            expect(isParameterSelectCc(64)).toBe(false);
            expect(isParameterSelectCc(96)).toBe(false);
        });
    });

    describe('isDataEntryCc', () => {
        it('returns true for CC 6, 38, 96, 97', () => {
            expect(isDataEntryCc(CC_DATA_ENTRY_MSB)).toBe(true);
            expect(isDataEntryCc(CC_DATA_ENTRY_LSB)).toBe(true);
            expect(isDataEntryCc(CC_DATA_INCREMENT)).toBe(true);
            expect(isDataEntryCc(CC_DATA_DECREMENT)).toBe(true);
        });

        it('returns false for non-data-entry CCs', () => {
            expect(isDataEntryCc(0)).toBe(false);
            expect(isDataEntryCc(101)).toBe(false);
        });
    });
});

describe('createMidiChannelControllerState', () => {
    it('returns a fresh state with defaults', () => {
        const state = createMidiChannelControllerState();
        expect(state.highResolution.size).toBe(0);
        expect(state.selectedParameterKind).toBeNull();
        expect(state.selectedParameterMsb).toBe(0);
        expect(state.selectedParameterLsb).toBe(0);
        expect(state.dataEntryMsb).toBe(0);
        expect(state.dataEntryLsb).toBe(0);
        expect(state.bendRangeSemitones).toBeUndefined();
    });

    it('returns independent instances (no shared Map reference)', () => {
        const a = createMidiChannelControllerState();
        const b = createMidiChannelControllerState();
        a.highResolution.set(0, { msb: 1, lsb: 2 });
        expect(b.highResolution.has(0)).toBe(false);
    });
});
