import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleToggleControlRoomDim } from '../handleToggleControlRoomDim';

const mocks = vi.hoisted(() => ({
    toggleDim: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    toggleDim: mocks.toggleDim,
}));

describe('handleToggleControlRoomDim', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes toggleDim', () => {
        void handleToggleControlRoomDim.execute({ type: 'toggleControlRoomDim', payload: {} });
        expect(mocks.toggleDim).toHaveBeenCalledTimes(1);
    });

    it('provides a description', () => {
        const desc = handleToggleControlRoomDim.describe({ type: 'toggleControlRoomDim', payload: {} });
        expect(desc.label).toBe('Toggle Dim Monitoring');
    });

    it('is not undoable', () => {
        expect(handleToggleControlRoomDim.undoable).toBe(false);
    });
});
