import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeAddNotes } from './aiMidiHandlers';

describe('aiMidiHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeAddNotes forwards notes to addMidiNote', () => {
        const addMidiNote = vi.fn();
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        injectDependencies(executeAddNotes, { addMidiNote, logger });

        executeAddNotes({
            type: 'addNotes',
            payload: {
                clipId: 'clip1',
                notes: [{ pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            },
        });

        expect(addMidiNote).toHaveBeenCalledWith('clip1', 60, 0, 1, 100);
    });
});
