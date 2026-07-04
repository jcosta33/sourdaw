import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    asAudioNode,
    asBaseAudioContext,
    createMockAudioContext,
} from '../../../../../../helpers/__tests__/audioContext.mock';
import { scheduleDrumVoice } from '../../../../engine/drumSynthVoices';
import { findVoiceByNote } from '../findVoiceByNote';
import { KIT_808_DEF } from '../getDrumKitDefByIndex';
import { scheduleDrumKitNote } from '../scheduleDrumKitNote';

vi.mock('../../../../engine/drumSynthVoices', () => ({
    scheduleDrumVoice: vi.fn(),
}));

describe('findVoiceByNote', () => {
    it('should return the voice whose midiNote exactly matches', () => {
        const voice = findVoiceByNote(KIT_808_DEF, 36);
        expect(voice?.name).toBe('Kick');
        expect(voice?.type).toBe('kick');
    });

    it('should match by exact midiNote, not by range', () => {
        // 41 sits between Clap (39) and Closed HH (42) but maps to no voice.
        expect(findVoiceByNote(KIT_808_DEF, 41)).toBeNull();
    });

    it('should return null when the note is outside every voice', () => {
        expect(findVoiceByNote(KIT_808_DEF, 0)).toBeNull();
    });
});

describe('scheduleDrumKitNote', () => {
    beforeEach(() => {
        vi.mocked(scheduleDrumVoice).mockClear();
    });

    it('should not schedule when the note has no matching voice', () => {
        const ctx = createMockAudioContext();

        scheduleDrumKitNote(asBaseAudioContext(ctx), asAudioNode(ctx.destination), KIT_808_DEF, 41, 1.25, 100);

        expect(scheduleDrumVoice).not.toHaveBeenCalled();
    });

    it('should schedule the matched voice through scheduleDrumVoice', () => {
        const ctx = createMockAudioContext();
        const context = asBaseAudioContext(ctx);
        const destination = asAudioNode(ctx.destination);

        scheduleDrumKitNote(context, destination, KIT_808_DEF, 36, 1.25, 64);

        expect(scheduleDrumVoice).toHaveBeenCalledWith(context, destination, 'kick', 1.25, 64);
    });

    it('should clamp velocity after applying clip gain', () => {
        const ctx = createMockAudioContext();
        const context = asBaseAudioContext(ctx);
        const destination = asAudioNode(ctx.destination);

        scheduleDrumKitNote(context, destination, KIT_808_DEF, 36, 1.25, 100, 2);
        scheduleDrumKitNote(context, destination, KIT_808_DEF, 38, 1.5, 64, -1);

        expect(scheduleDrumVoice).toHaveBeenNthCalledWith(1, context, destination, 'kick', 1.25, 127);
        expect(scheduleDrumVoice).toHaveBeenNthCalledWith(2, context, destination, 'snare', 1.5, 0);
    });
});
