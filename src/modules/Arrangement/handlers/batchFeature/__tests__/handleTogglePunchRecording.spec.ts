import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleTogglePunchRecording } from '../handleTogglePunchRecording';

const mocks = vi.hoisted(() => ({
    togglePunchRecording: vi.fn(),
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    togglePunchRecording: mocks.togglePunchRecording,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('handleTogglePunchRecording', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes togglePunchRecording and notifies user', () => {
        handleTogglePunchRecording.execute({ type: 'togglePunchRecording', payload: {} });

        expect(mocks.togglePunchRecording).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Punch recording toggled');
    });

    it('provides a description', () => {
        const desc = handleTogglePunchRecording.describe({ type: 'togglePunchRecording', payload: {} });
        expect(desc.label).toBe('Toggle Punch Recording');
    });

    it('is not undoable', () => {
        expect(handleTogglePunchRecording.undoable).toBe(false);
    });
});
