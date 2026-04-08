import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeRemoveChordEvent } from './chordTrackHandlers';

describe('chordTrackHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeRemoveChordEvent forwards event id', () => {
        const removeChordEvent = vi.fn();
        injectDependencies(executeRemoveChordEvent, { removeChordEvent });

        executeRemoveChordEvent({ type: 'removeChordEvent', payload: { eventId: 'e1' } });

        expect(removeChordEvent).toHaveBeenCalledWith('e1');
    });
});
