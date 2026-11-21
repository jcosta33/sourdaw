import { describe, expect, it } from 'vitest';

import { pitchEditDependenciesPort, setPitchEditDependencies } from '../pitchEditDependencies';

function commitPitchEdit(): Promise<{ renderedAudioBufferId: string }> {
    return Promise.resolve({ renderedAudioBufferId: 'audio-pitch:test_pitch.wav' });
}

function otherCommitPitchEdit(): Promise<{ renderedAudioBufferId: string }> {
    return Promise.resolve({ renderedAudioBufferId: 'audio-pitch:other.wav' });
}

describe('pitchEditDependencies', () => {
    it('throws naming the registrar when read before registration', () => {
        expect(() => pitchEditDependenciesPort.read()).toThrow(
            'pitchEditDependenciesPort.read: pitch edit dependencies are not registered; call setPitchEditDependencies() from #/app/bootstrap'
        );
    });

    it('returns what was filled', () => {
        setPitchEditDependencies({ commitPitchEdit });

        expect(pitchEditDependenciesPort.read().commitPitchEdit).toBe(commitPitchEdit);
    });

    it('replaces the first fill with a second', () => {
        setPitchEditDependencies({ commitPitchEdit });
        setPitchEditDependencies({ commitPitchEdit: otherCommitPitchEdit });

        expect(pitchEditDependenciesPort.read().commitPitchEdit).toBe(otherCommitPitchEdit);
    });
});
