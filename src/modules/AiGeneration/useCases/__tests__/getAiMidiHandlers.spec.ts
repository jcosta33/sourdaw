import { describe, it, expect } from 'vitest';
import { getAiMidiHandlers } from '../getAiMidiHandlers';
import { handleAddNotes } from '../../handlers/aiMidi/handleAddNotes';
import { handleAudioToMidiAiMidi } from '../../handlers/aiMidi/handleAudioToMidiAiMidi';

describe('getAiMidiHandlers', () => {
    it('returns a map of AI MIDI action handlers', () => {
        const handlers = getAiMidiHandlers();
        
        expect(handlers).toHaveProperty('addNotes');
        expect(handlers).toHaveProperty('audioToMidi');
        expect(handlers).toHaveProperty('stemSeparate');
        
        // Check that it's exporting the exact handlers we expect
        expect(handlers.addNotes).toBe(handleAddNotes);
        expect(handlers.audioToMidi).toBe(handleAudioToMidiAiMidi);
    });
});
