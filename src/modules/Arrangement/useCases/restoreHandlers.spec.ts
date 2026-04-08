import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeRestoreClip } from './restoreHandlers';

describe('restoreHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeRestoreClip calls updateTrack when ripplePlan is absent', () => {
        const updateTrack = vi.fn();
        const undoRippleDelete = vi.fn();
        const midiStore = {
            value: null as null,
            set: vi.fn(),
        };
        injectDependencies(executeRestoreClip, { updateTrack, undoRippleDelete, midiStore });

        executeRestoreClip({
            type: 'restoreClip',
            payload: {
                clipId: 'c1',
                trackId: 't1',
                clipSnapshot: { id: 'c1' } as never,
                ripplePlan: undefined,
                midiNotesSnapshot: undefined,
                midiCcSnapshot: undefined,
                midiPitchBendSnapshot: undefined,
            },
        });

        expect(updateTrack).toHaveBeenCalled();
        expect(undoRippleDelete).not.toHaveBeenCalled();
    });
});
