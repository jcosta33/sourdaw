import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleArmTrack } from '../armTrack';

const mocks = vi.hoisted(() => ({
    armTrack: vi.fn(),
}));

vi.mock('../../../useCases/recording/armTrack', () => ({
    armTrack: mocks.armTrack,
}));

describe('handleArmTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes armTrack with the provided payload', () => {
        handleArmTrack.execute({
            type: 'armTrack',
            payload: { trackId: 't1', armed: true },
        });

        expect(mocks.armTrack).toHaveBeenCalledWith('t1', true);
    });

    it('provides a description reflecting armed state', () => {
        const desc1 = handleArmTrack.describe({
            type: 'armTrack',
            payload: { trackId: 't1', armed: true },
        });
        expect(desc1.label).toBe('Arm track');

        const desc2 = handleArmTrack.describe({
            type: 'armTrack',
            payload: { trackId: 't1', armed: false },
        });
        expect(desc2.label).toBe('Disarm track');
    });

    it('is undoable', () => {
        expect(handleArmTrack.undoable).toBe(true);
    });
});
