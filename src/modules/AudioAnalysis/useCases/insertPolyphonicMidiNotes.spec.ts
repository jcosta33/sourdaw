import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { insertPolyphonicMidiNotes } from './insertPolyphonicMidiNotes';

describe('insertPolyphonicMidiNotes', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns null when a new MIDI track cannot be created', () => {
        const getTransportState = vi.fn().mockReturnValue({ tempo: 120 });
        const getAllTracks = vi.fn().mockReturnValue([]);
        const addTrack = vi.fn().mockReturnValue(null);
        const addClip = vi.fn();
        const batchAddMidiNotes = vi.fn();
        injectDependencies(insertPolyphonicMidiNotes, {
            getTransportState,
            getAllTracks,
            addTrack,
            addClip,
            batchAddMidiNotes,
        });

        const result = insertPolyphonicMidiNotes([], { startBeat: 0, endBeat: 1, name: 'x' }, 'missing-track');

        expect(result).toBeNull();
        expect(addClip).not.toHaveBeenCalled();
        expect(batchAddMidiNotes).not.toHaveBeenCalled();
    });
});
