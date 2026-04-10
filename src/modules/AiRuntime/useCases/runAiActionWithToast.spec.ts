import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { runAiActionWithToast } from './runAiActionWithToast';

describe('runAiActionWithToast injectable', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('notifies start, runs action, then notifies success', async () => {
        const notifyUser = vi.fn();
        const notifyAiChange = vi.fn();
        injectDependencies(runAiActionWithToast, { notifyUser, notifyAiChange });

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
        const notifyUser = vi.fn();
        const notifyAiChange = vi.fn();
        injectDependencies(runAiActionWithToast, { notifyUser, notifyAiChange });

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
