import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSetTrackHeight } from '../setTrackHeight';

const mocks = vi.hoisted(() => ({
    setTrackHeight: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/setTrackHeight', () => ({
    setTrackHeight: mocks.setTrackHeight,
}));

describe('handleSetTrackHeight', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setTrackHeight with the provided payload', () => {
        handleSetTrackHeight.execute({
            type: 'setTrackHeight',
            payload: { trackId: 't1', height: 150 },
        });

        expect(mocks.setTrackHeight).toHaveBeenCalledWith('t1', 150);
    });

    it('provides a description', () => {
        const desc = handleSetTrackHeight.describe({
            type: 'setTrackHeight',
            payload: { trackId: 't1', height: 100 },
        });
        expect(desc.label).toBe('Set track height');
    });

    it('is undoable', () => {
        expect(handleSetTrackHeight.undoable).toBe(true);
    });
});
