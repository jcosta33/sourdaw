import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleToggleSoloSafe } from '../toggleSoloSafe';

const mocks = vi.hoisted(() => ({
    toggleSoloSafe: vi.fn(),
}));

vi.mock('../../../useCases/toggleTrackState/toggleSoloSafe', () => ({
    toggleSoloSafe: mocks.toggleSoloSafe,
}));

describe('handleToggleSoloSafe', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes toggleSoloSafe with payload', () => {
        handleToggleSoloSafe.execute({
            type: 'toggleSoloSafe',
            payload: { trackId: 't1' },
        });

        expect(mocks.toggleSoloSafe).toHaveBeenCalledWith('t1');
    });

    it('provides a description', () => {
        const desc = handleToggleSoloSafe.describe({
            type: 'toggleSoloSafe',
            payload: { trackId: 't1' },
        });
        expect(desc.label).toBe('Toggle solo safe');
    });

    it('is undoable', () => {
        expect(handleToggleSoloSafe.undoable).toBe(true);
    });
});
