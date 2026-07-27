import { describe, expect, it } from 'vitest';

import { resolveToasterPadIndex, TOASTER_NEUTRAL_MIDI_NOTE } from '../toasterNoteProjection';

describe('toasterNoteProjection', () => {
    it('maps both supported MIDI banks onto the same sixteen pads', () => {
        expect([
            resolveToasterPadIndex(36),
            resolveToasterPadIndex(51),
            resolveToasterPadIndex(60),
            resolveToasterPadIndex(75),
        ]).toEqual([0, 15, 0, 15]);
        expect(TOASTER_NEUTRAL_MIDI_NOTE).toBe(60);
    });

    it('rejects notes outside the supported banks and fractional notes', () => {
        expect([
            resolveToasterPadIndex(35),
            resolveToasterPadIndex(52),
            resolveToasterPadIndex(59),
            resolveToasterPadIndex(76),
            resolveToasterPadIndex(36.5),
        ]).toEqual([null, null, null, null, null]);
    });
});
