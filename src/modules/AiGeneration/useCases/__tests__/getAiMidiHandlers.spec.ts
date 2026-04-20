import { describe, it, expect } from 'vitest';

import { handleAddNotes } from '../../handlers/aiMidi/handleAddNotes';
import { handleStemSeparate } from '../../handlers/aiMidi/handleStemSeparate';
import { getAiMidiHandlers } from '../getAiMidiHandlers';

describe('getAiMidiHandlers', () => {
    it('returns a map of AI MIDI action handlers', () => {
        const handlers = getAiMidiHandlers();

        expect(handlers).toHaveProperty('addNotes');
        expect(handlers).toHaveProperty('stemSeparate');

        expect(handlers.addNotes).toBe(handleAddNotes);
        expect(handlers.stemSeparate).toBe(handleStemSeparate);
    });
});
