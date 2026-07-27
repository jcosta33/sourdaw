export const TOASTER_NEUTRAL_MIDI_NOTE = 60;

const TOASTER_LOW_BANK_START = 36;
const TOASTER_HIGH_BANK_START = 60;
const TOASTER_PAD_COUNT = 16;

export function resolveToasterPadIndex(midiNote: number): number | null {
    if (!Number.isInteger(midiNote)) {
        return null;
    }

    const lowBankPad = midiNote - TOASTER_LOW_BANK_START;
    if (lowBankPad >= 0 && lowBankPad < TOASTER_PAD_COUNT) {
        return lowBankPad;
    }

    const highBankPad = midiNote - TOASTER_HIGH_BANK_START;
    if (highBankPad >= 0 && highBankPad < TOASTER_PAD_COUNT) {
        return highBankPad;
    }

    return null;
}
