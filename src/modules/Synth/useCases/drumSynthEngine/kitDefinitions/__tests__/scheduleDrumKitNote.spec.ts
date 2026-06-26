import { describe, it, expect } from 'vitest';

import { KIT_808_DEF } from '../getDrumKitDefByIndex';
import { findVoiceByNote } from '../scheduleDrumKitNote';

describe('findVoiceByNote', () => {
    it('returns the voice whose midiNote exactly matches', () => {
        const voice = findVoiceByNote(KIT_808_DEF, 36);
        expect(voice?.name).toBe('Kick');
        expect(voice?.type).toBe('kick');
    });

    it('matches by exact midiNote, not by range — an unmapped note returns null', () => {
        // 41 sits between Clap (39) and Closed HH (42) but maps to no voice.
        expect(findVoiceByNote(KIT_808_DEF, 41)).toBeNull();
    });

    it('returns null when the note is outside every voice', () => {
        expect(findVoiceByNote(KIT_808_DEF, 0)).toBeNull();
    });
});
