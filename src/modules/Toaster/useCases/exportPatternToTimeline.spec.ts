import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { exportPatternToTimeline } from './exportPatternToTimeline';

describe('exportPatternToTimeline', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not add clips when there are no tracks', () => {
        const addClip = vi.fn();
        const addMidiNote = vi.fn();
        injectDependencies(exportPatternToTimeline, {
            getAllTracks: () => [],
            addClip,
            addMidiNote,
            playheadPositionRef: { current: 0 },
        });

        exportPatternToTimeline();

        expect(addClip).not.toHaveBeenCalled();
        expect(addMidiNote).not.toHaveBeenCalled();
    });
});
