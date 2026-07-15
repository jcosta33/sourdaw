import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDawApi } from '../createDawApi';

type TestAction = {
    type: string;
    payload?: unknown;
};

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn<(action: TestAction, options?: { source?: 'ai' }) => Promise<void>>(),
    notifyUser: vi.fn<(message: string) => void>(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('createDawApi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.executeAppAction.mockResolvedValue(undefined);
    });

    it('should expose version, notify, and executeAction', () => {
        const api = createDawApi();

        expect(api.version).toBe('0.1.0');
        expect(typeof api.notify).toBe('function');
        expect(typeof api.executeAction).toBe('function');
    });

    it('should route notifications and actions through their owners', async () => {
        const api = createDawApi();
        const action = { type: 'transport/play', payload: { source: 'script' } };

        api.notify('Script says hello');
        await api.executeAction(action);

        expect(mocks.notifyUser).toHaveBeenCalledWith('Script says hello');
        expect(mocks.executeAppAction).toHaveBeenCalledWith(action, { source: 'ai' });
    });
});
