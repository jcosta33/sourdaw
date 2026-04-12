import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleToggleControlRoomMono } from '../handleToggleControlRoomMono';

const mocks = vi.hoisted(() => ({
    toggleMono: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    toggleMono: mocks.toggleMono,
}));

describe('handleToggleControlRoomMono', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes toggleMono', () => {
        handleToggleControlRoomMono.execute({ type: 'toggleControlRoomMono', payload: {} });
        expect(mocks.toggleMono).toHaveBeenCalledTimes(1);
    });

    it('provides a description', () => {
        const desc = handleToggleControlRoomMono.describe({ type: 'toggleControlRoomMono', payload: {} });
        expect(desc.label).toBe('Toggle Mono Monitoring');
    });

    it('is not undoable', () => {
        expect(handleToggleControlRoomMono.undoable).toBe(false);
    });
});
