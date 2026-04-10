import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { audioToMidi } from './audioToMidi';

describe('audioToMidi (AudioAnalysis)', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns early when no clip matches the id', () => {
        const getTransportState = vi.fn();
        const getAllTracks = vi.fn().mockReturnValue([]);
        const addTrack = vi.fn();
        const addClip = vi.fn();
        const addMidiNote = vi.fn();
        injectDependencies(audioToMidi, {
            getTransportState,
            getAllTracks,
            addTrack,
            addClip,
            addMidiNote,
        });

        audioToMidi({ clipId: 'missing', trackId: 't1' });

        expect(addTrack).not.toHaveBeenCalled();
        expect(addClip).not.toHaveBeenCalled();
    });
});
