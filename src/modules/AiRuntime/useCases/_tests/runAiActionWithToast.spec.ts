import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAiActionWithToast } from '../runAiActionWithToast';

vi.mock('#/helpers/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('../notifyAiChange', () => ({
    notifyAiChange: vi.fn(),
}));

describe('runAiActionWithToast injectable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('notifies start, runs action, then notifies success', async () => {
        const { notifyUser } = await import('#/helpers/Notification/notifyUser');
        const { notifyAiChange } = await import('../notifyAiChange');

        const action = vi.fn().mockResolvedValue(undefined);
        const messages = {
            startMsg: 'Starting',
            successMsg: 'Done',
            successDetails: ['a'],
            failMsg: 'Failed',
        };

        await runAiActionWithToast(action, messages);

        expect(notifyUser).toHaveBeenCalledWith('Starting');
        expect(action).toHaveBeenCalledTimes(1);
        expect(notifyAiChange).toHaveBeenCalledWith('Done', ['a']);
    });

    it('notifies error on failure', async () => {
        const { notifyUser } = await import('#/helpers/Notification/notifyUser');
        const { notifyAiChange } = await import('../notifyAiChange');

        const action = vi.fn().mockRejectedValue(new Error('x'));
        await runAiActionWithToast(action, {
            startMsg: 'Starting',
            successMsg: 'Done',
            successDetails: [],
            failMsg: 'Failed',
        });

        expect(notifyUser).toHaveBeenCalledWith('Failed', 'error');
        expect(notifyAiChange).not.toHaveBeenCalled();
    });
});
