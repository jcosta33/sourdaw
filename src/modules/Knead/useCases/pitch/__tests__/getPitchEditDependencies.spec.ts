import { describe, expect, it } from 'vitest';

import { getPitchEditDependencies } from '../getPitchEditDependencies';
import { setPitchEditDependencies } from '../pitchEditDependencies';

describe('getPitchEditDependencies', () => {
    it('throws when no dependencies have been registered yet', () => {
        expect(() => getPitchEditDependencies()).toThrow('Pitch edit dependencies not initialized');
    });

    it('returns the exact registered dependencies once set', () => {
        function commitPitchEdit(): Promise<{ renderedAudioBufferId: string }> {
            return Promise.resolve({ renderedAudioBufferId: 'audio-pitch:test_pitch.wav' });
        }
        setPitchEditDependencies({ commitPitchEdit });

        expect(getPitchEditDependencies().commitPitchEdit).toBe(commitPitchEdit);
    });
});
