import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addCvOutput } from '#/modules/CvGate/useCases';
import { connectPush, disconnectPush } from '#/modules/Plugin/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { setProtocol } from '../../../useCases/controlSurface/setProtocol';
import { handleAddCvOutput } from '../handleAddCvOutput';
import { handleConnectPush } from '../handleConnectPush';
import { handleDisconnectPush } from '../handleDisconnectPush';
import { handleSetControlSurface } from '../handleSetControlSurface';

vi.mock('#/modules/CvGate/useCases', () => ({ addCvOutput: vi.fn() }));
vi.mock('#/modules/Plugin/useCases', () => ({ connectPush: vi.fn(), disconnectPush: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/modules/Project/useCases', () => ({
    exportDawProject: vi.fn(async () => ({ bytes: new Uint8Array([0]), fileName: 'demo.dawproject' })),
}));
vi.mock('../../../useCases/controlSurface/setProtocol', () => ({ setProtocol: vi.fn() }));

describe('finalFeatureMiscHandlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleAddCvOutput should delegate to addCvOutput', () => {
        void handleAddCvOutput.execute({ type: 'addCvOutput', payload: { name: 'Gate 1', channel: 0, type: 'gate' } });
        expect(addCvOutput).toHaveBeenCalledWith('Gate 1', 0, 'gate');
    });

    it('handleConnectPush should delegate to connectPush and notify user', () => {
        void handleConnectPush.execute({ type: 'connectPush', payload: { model: 'push2' } });
        expect(connectPush).toHaveBeenCalledWith('push2');
        expect(notifyUser).toHaveBeenCalledWith('Ableton Push 2 connected', 'success');
    });

    it('handleDisconnectPush should delegate to disconnectPush', () => {
        void handleDisconnectPush.execute({ type: 'disconnectPush', payload: undefined });
        expect(disconnectPush).toHaveBeenCalled();
    });

    it('handleSetControlSurface should delegate to setProtocol and notify', () => {
        void handleSetControlSurface.execute({ type: 'setControlSurface', payload: { protocol: 'mcu' } });
        expect(setProtocol).toHaveBeenCalledWith('mcu');
        expect(notifyUser).toHaveBeenCalledWith('Control surface: mcu');
    });
});
