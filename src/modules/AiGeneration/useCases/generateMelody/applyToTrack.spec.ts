import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { applyMelodyToTrack } from './applyToTrack';

describe('applyMelodyToTrack', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not add notes when addClip fails', () => {
        const addClip = vi.fn().mockReturnValue(null);
        const addMidiNote = vi.fn();
        injectDependencies(applyMelodyToTrack, { addClip, addMidiNote });

        applyMelodyToTrack('t1', { style: 'simple', key: 0, scale: 'major', bars: 1 }, 0);

        expect(addMidiNote).not.toHaveBeenCalled();
    });
});
