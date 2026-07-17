import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleTogglePunchRecording } from '../handleTogglePunchRecording';

const mocks = vi.hoisted(() => ({
    notifyUser: vi.fn(),
    togglePunchRecording: vi.fn(),
}));

vi.mock('../../../useCases/punchRecording/togglePunchRecording', () => ({
    togglePunchRecording: mocks.togglePunchRecording,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

describe('PunchRecording Handlers', () => {
    beforeEach(() => vi.clearAllMocks());

    it('handleTogglePunchRecording delegates to use case and notifies the user', () => {
        handleTogglePunchRecording.execute({ type: 'togglePunchRecording', payload: undefined });
        expect(mocks.togglePunchRecording).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Punch recording toggled');
    });
});
