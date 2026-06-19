import { describe, it, expect, vi, beforeEach } from 'vitest';

import { runAiActionWithToast } from '../runAiActionWithToast';

const mocks = vi.hoisted(() => ({
    notifyUser: vi.fn(),
    notifyAiChange: vi.fn(),
    loggerError: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('../notifyAiChange', () => ({
    notifyAiChange: mocks.notifyAiChange,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: mocks.loggerError },
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

    it('logs the cause and surfaces it in the error toast on failure', async () => {
        const cause = new Error('engine offline');
        const action = vi.fn().mockRejectedValue(cause);
        await runAiActionWithToast(action, {
            startMsg: 'Starting',
            successMsg: 'Done',
            successDetails: [],
            failMsg: 'Failed',
        });

        // The error must be logged (the old bare `catch {}` swallowed it).
        expect(mocks.loggerError).toHaveBeenCalledWith(cause);
        // The toast must include the cause's message, not just a bare label.
        expect(mocks.notifyUser).toHaveBeenCalledWith('Failed: engine offline', 'error');
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
    });

    it('wraps a non-Error rejection before logging and surfacing it', async () => {
        const action = vi.fn().mockRejectedValue('plain string failure');
        await runAiActionWithToast(action, {
            startMsg: 'Starting',
            successMsg: 'Done',
            successDetails: [],
            failMsg: 'Failed',
        });

        // A thrown non-Error is normalized to an Error so logger.error(Error) holds.
        expect(mocks.loggerError).toHaveBeenCalledWith(expect.any(Error));
        expect(mocks.loggerError.mock.calls[0]?.[0]).toMatchObject({ message: 'plain string failure' });
        expect(mocks.notifyUser).toHaveBeenCalledWith('Failed: plain string failure', 'error');
        expect(mocks.notifyAiChange).not.toHaveBeenCalled();
    });
});
