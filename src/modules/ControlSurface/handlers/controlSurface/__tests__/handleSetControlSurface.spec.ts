import { describe, it, expect, vi, beforeEach } from 'vitest';

import { notifyUser } from '#/utils/Notification/notifyUser';

import { setConnected } from '../../../useCases/controlSurface/setConnected';
import { setProtocol } from '../../../useCases/controlSurface/setProtocol';
import { handleSetControlSurface } from '../handleSetControlSurface';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('../../../useCases/controlSurface/setProtocol', () => ({ setProtocol: vi.fn() }));
vi.mock('../../../useCases/controlSurface/setConnected', () => ({ setConnected: vi.fn() }));

describe('handleSetControlSurface', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates to setProtocol and notifies for a selected protocol', () => {
        void handleSetControlSurface.execute({ type: 'setControlSurface', payload: { protocol: 'mcu' } });
        expect(setProtocol).toHaveBeenCalledWith('mcu');
        expect(notifyUser).toHaveBeenCalledWith('Control surface: mcu');
    });

    it('notifies "disconnected" when no protocol is provided', () => {
        void handleSetControlSurface.execute({ type: 'setControlSurface', payload: { protocol: null } });
        expect(setProtocol).toHaveBeenCalledWith(null);
        expect(notifyUser).toHaveBeenCalledWith('Control surface: disconnected');
    });

    it('marks the surface connected when a protocol is selected (F-4)', () => {
        void handleSetControlSurface.execute({ type: 'setControlSurface', payload: { protocol: 'osc' } });
        expect(setConnected).toHaveBeenCalledWith(true);
    });

    it('marks the surface disconnected when the protocol is cleared (F-4)', () => {
        void handleSetControlSurface.execute({ type: 'setControlSurface', payload: { protocol: null } });
        expect(setConnected).toHaveBeenCalledWith(false);
    });
});
