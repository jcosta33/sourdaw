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

    it('handleConnectPush should delegate to connectPush and notify user', () => {
        void handleConnectPush.execute({ type: 'connectPush', payload: { model: 'push2' } });
        expect(connectPush).toHaveBeenCalledWith('push2');
        expect(notifyUser).toHaveBeenCalledWith('Ableton Push 2 connected', 'success');
    });

    it('handleConnectPush should notify Push 3 for the push3 model', () => {
        void handleConnectPush.execute({ type: 'connectPush', payload: { model: 'push3' } });
        expect(connectPush).toHaveBeenCalledWith('push3');
        expect(notifyUser).toHaveBeenCalledWith('Ableton Push 3 connected', 'success');
    });

    it('handleDisconnectPush should delegate to disconnectPush', () => {
        void handleDisconnectPush.execute({ type: 'disconnectPush', payload: undefined });
        expect(disconnectPush).toHaveBeenCalled();
    });

    it('both handlers are non-undoable session-recovery actions', () => {
        expect(handleConnectPush.undoable).toBe(false);
        expect(handleDisconnectPush.undoable).toBe(false);
    });
});
