import { describe, it, expect } from 'vitest';
import { type DrumKit } from './drumKitSynth';

describe('drumKitSynth types', () => {
    it('DrumKit type is structurally compatible with the engine model', () => {
        const kit: DrumKit = {
            id: 'test',
            name: 'Test Kit',
            voices: [
                {
                    name: 'Kick',
                    pitchRange: [36, 36],
                    params: {} as never,
                },
            ],
        };

        expect(kit.voices).toHaveLength(1);
        expect(kit.voices[0]!.pitchRange).toEqual([36, 36]);
    });
});
