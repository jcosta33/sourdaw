import { describe, it, expect, vi, beforeEach } from 'vitest';

import { triggerLiveNoteOff } from '../triggerLiveNoteOff';
import { handleWebMidiNoteOff } from '../webMidiInput/handleWebMidiNoteOff';

vi.mock('../webMidiInput/handleWebMidiNoteOff', () => ({
    handleWebMidiNoteOff: vi.fn(),
}));

describe('triggerLiveNoteOff', () => {
    beforeEach(() => {
        vi.mocked(handleWebMidiNoteOff).mockClear();
    });

    it('should forward channel and note to the Web MIDI handler, defaulting release velocity to 0', () => {
        triggerLiveNoteOff(1, 72);

        expect(handleWebMidiNoteOff).toHaveBeenCalledTimes(1);
        // Callers without a release-velocity get the documented explicit 0 default.
        expect(handleWebMidiNoteOff).toHaveBeenCalledWith(1, 72, 0);
    });

    it('should forward an explicit release velocity to the Web MIDI handler', () => {
        triggerLiveNoteOff(1, 72, 0.5);

        expect(handleWebMidiNoteOff).toHaveBeenCalledTimes(1);
        expect(handleWebMidiNoteOff).toHaveBeenCalledWith(1, 72, 0.5);
    });
});
