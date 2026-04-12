import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAiActionWithToast } from '../runAiActionWithToast';

const mocks = vi.hoisted(() => ({
    notifyUser: vi.fn(),
    notifyAiChange: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('../notifyAiChange', () => ({
    notifyAiChange: mocks.notifyAiChange,
}));

describe('runAiActionWithToast injectable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('notifies start, runs action, then notifies success', async () => {
        const action = vi.fn().mockResolvedValue(undefined);
        const messages = {
            startMsg: 'Starting',
            successMsg: 'Done',
            successDetails: ['a'],
            failMsg: 'Failed',
        };

        await runAiActionWithToast(action, messages);

        expect(mocks.notifyUser).toHaveBeenCalledWith('Starting');
        expect(action).toHaveBeenCalledTimes(1);
        expect(mocks.notifyAiChange).toHaveBeenCalledWith('Done', ['a']);
    });

    it('notifies error on failure', async () => {
        const action = vi.fn().mockRejectedValue(new Error('x'));
        await runAiActionWithToast(action, {
            startMsg: 'Starting',
            successMsg: 'Done',
            successDetails: [],
            failMsg: 'Failed',
        });

        expect(mocks.notifyUser).toHaveBeenCalledWith('Failed', 'error');
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
    });
});
