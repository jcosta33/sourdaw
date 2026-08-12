import { describe, it, expect, vi, beforeEach } from 'vitest';

import { notifyUser } from '#/utils/Notification/notifyUser';

import { connectPush } from '../../../useCases/pushIntegration/connectPush';
import { disconnectPush } from '../../../useCases/pushIntegration/disconnectPush';
import { handleConnectPush } from '../handleConnectPush';
import { handleDisconnectPush } from '../handleDisconnectPush';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('../../../useCases/pushIntegration/connectPush', () => ({ connectPush: vi.fn() }));
vi.mock('../../../useCases/pushIntegration/disconnectPush', () => ({ disconnectPush: vi.fn() }));

describe('ControlSurface push handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleConnectPush notifies only after the transport connects', async () => {
        vi.mocked(connectPush).mockResolvedValue();
        await handleConnectPush.execute({ type: 'connectPush', payload: { model: 'push2' } });
        expect(connectPush).toHaveBeenCalledWith('push2');
        expect(notifyUser).toHaveBeenCalledWith('Ableton Push 2 connected', 'success');
    });

    it('handleConnectPush does not report success when hardware connection rejects', async () => {
        vi.mocked(connectPush).mockRejectedValue(new Error('Push 3 is unavailable'));

        await expect(handleConnectPush.execute({ type: 'connectPush', payload: { model: 'push3' } })).rejects.toThrow(
            'Push 3 is unavailable'
        );
        expect(connectPush).toHaveBeenCalledWith('push3');
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('handleDisconnectPush should await disconnectPush', async () => {
        vi.mocked(disconnectPush).mockResolvedValue();
        await handleDisconnectPush.execute({ type: 'disconnectPush', payload: undefined });
        expect(disconnectPush).toHaveBeenCalled();
    });

    it('both handlers are non-undoable session-recovery actions', () => {
        expect(handleConnectPush.undoable).toBe(false);
        expect(handleDisconnectPush.undoable).toBe(false);
    });
});
