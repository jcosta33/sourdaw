import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { applyChordProgressionToTrack } from './applyToTrack';

describe('applyChordProgressionToTrack', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not add notes when addClip fails', () => {
        const addClip = vi.fn().mockReturnValue(null);
        const addMidiNote = vi.fn();
        injectDependencies(applyChordProgressionToTrack, { addClip, addMidiNote });

        applyChordProgressionToTrack('t1', { style: 'pop', key: 0, scale: 'major', bars: 1 }, 0);

        expect(addMidiNote).not.toHaveBeenCalled();
    });
});
