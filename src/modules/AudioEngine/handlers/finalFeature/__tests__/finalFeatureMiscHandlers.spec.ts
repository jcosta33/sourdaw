import { describe, it, expect, vi, beforeEach } from 'vitest';

import { connectPush, disconnectPush } from '#/modules/Plugin/useCases';
import { addCvOutput } from '#/modules/Synth/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { setProtocol } from '../../../useCases/controlSurface/setProtocol';
import { loadModel } from '../../../useCases/rave/loadModel';
import { setTransferBlend } from '../../../useCases/rave/setTransferBlend';
import { handleAddCvOutput } from '../handleAddCvOutput';
import { handleConnectPush } from '../handleConnectPush';
import { handleDisconnectPush } from '../handleDisconnectPush';
import { handleExportDawProject } from '../handleExportDawProject';
import { handleLoadRaveModel } from '../handleLoadRaveModel';
import { handleSetControlSurface } from '../handleSetControlSurface';
import { handleSetRaveBlend } from '../handleSetRaveBlend';

vi.mock('#/modules/Synth/useCases', () => ({ addCvOutput: vi.fn() }));
vi.mock('#/modules/Plugin/useCases', () => ({ connectPush: vi.fn(), disconnectPush: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('../../../useCases/rave/loadModel', () => ({ loadModel: vi.fn() }));
vi.mock('../../../useCases/controlSurface/setProtocol', () => ({ setProtocol: vi.fn() }));
vi.mock('../../../useCases/rave/setTransferBlend', () => ({ setTransferBlend: vi.fn() }));

describe('finalFeatureMiscHandlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleAddCvOutput should delegate to addCvOutput', () => {
        handleAddCvOutput.execute({ type: 'addCvOutput', payload: { name: 'Gate 1', channel: 0, type: 'gate' } });
        expect(addCvOutput).toHaveBeenCalledWith('Gate 1', 0, 'gate');
    });

    it('handleConnectPush should delegate to connectPush and notify user', () => {
        handleConnectPush.execute({ type: 'connectPush', payload: { model: 'push2' } });
        expect(connectPush).toHaveBeenCalledWith('push2');
        expect(notifyUser).toHaveBeenCalledWith('Ableton Push 2 connected', 'success');
    });

    it('handleDisconnectPush should delegate to disconnectPush', () => {
        handleDisconnectPush.execute({ type: 'disconnectPush', payload: {} });
        expect(disconnectPush).toHaveBeenCalled();
    });

    it('handleExportDawProject should notify user', () => {
        handleExportDawProject.execute({ type: 'exportDawProject', payload: {} });
        expect(notifyUser).toHaveBeenCalled();
    });

    it('handleLoadRaveModel should delegate to loadModel', () => {
        handleLoadRaveModel.execute({ type: 'loadRaveModel', payload: { modelId: 'rave-1' } });
        expect(loadModel).toHaveBeenCalledWith('rave-1');
    });

    it('handleSetControlSurface should delegate to setProtocol and notify', () => {
        handleSetControlSurface.execute({ type: 'setControlSurface', payload: { protocol: 'mcu' } });
        expect(setProtocol).toHaveBeenCalledWith('mcu');
        expect(notifyUser).toHaveBeenCalledWith('Control surface: mcu');
    });

    it('handleSetRaveBlend should delegate to setTransferBlend', () => {
        handleSetRaveBlend.execute({ type: 'setRaveBlend', payload: { blend: 0.5 } });
        expect(setTransferBlend).toHaveBeenCalledWith(0.5);
    });
});
