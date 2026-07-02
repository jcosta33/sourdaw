import { describe, it, expect, vi, beforeEach } from 'vitest';

import { triggerLiveNoteOn } from '../triggerLiveNoteOn';
import { handleWebMidiNoteOn } from '../webMidiInput/handleWebMidiNoteOn';

vi.mock('../webMidiInput/handleWebMidiNoteOn', () => ({
    handleWebMidiNoteOn: vi.fn(),
}));

describe('triggerLiveNoteOn', () => {
    beforeEach(() => {
        vi.mocked(handleWebMidiNoteOn).mockClear();
    });

    it('should forward channel, note, and velocity to the Web MIDI handler', () => {
        triggerLiveNoteOn(2, 60, 100);

        expect(handleWebMidiNoteOn).toHaveBeenCalledTimes(1);
        expect(handleWebMidiNoteOn).toHaveBeenCalledWith(2, 60, 100);
    });
});
