import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { applyDrumPatternToTrack } from './applyToTrack';

describe('applyDrumPatternToTrack', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not add notes when addClip fails', () => {
        const addClip = vi.fn().mockReturnValue(null);
        const addMidiNote = vi.fn();
        injectDependencies(applyDrumPatternToTrack, { addClip, addMidiNote });

        applyDrumPatternToTrack(
            't1',
            { style: 'house', bars: 1, timeSignature: [4, 4] },
            0
        );

        expect(addMidiNote).not.toHaveBeenCalled();
    });
});
