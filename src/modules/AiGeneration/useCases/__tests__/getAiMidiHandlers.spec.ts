import { describe, it, expect } from 'vitest';

import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';

import { handleReplayGeneratedMidi } from '../../handlers/aiMidi/handleReplayGeneratedMidi';
import { handleStemSeparate } from '../../handlers/aiMidi/handleStemSeparate';
import { getAiMidiHandlers } from '../getAiMidiHandlers';

describe('getAiMidiHandlers', () => {
    it('should return a map of AI MIDI action handlers without MIDI-owned addNotes', () => {
        const handlers = getAiMidiHandlers();
        const midi_handlers = getMidiNoteTransformHandlers();

        expect(handlers).not.toHaveProperty('addNotes');
        expect(midi_handlers).toHaveProperty('addNotes');
        expect(handlers).toHaveProperty('stemSeparate');
        expect(handlers.replayGeneratedMidi).toBe(handleReplayGeneratedMidi);

        expect(handlers.stemSeparate).toBe(handleStemSeparate);
    });
});
