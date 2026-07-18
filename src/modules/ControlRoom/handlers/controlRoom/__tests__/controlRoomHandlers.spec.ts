import { beforeEach, describe, expect, it, vi } from 'vitest';

import { switchMonitor } from '../../../useCases/controlRoom/switchMonitor';
import { toggleDim } from '../../../useCases/controlRoom/toggleDim';
import { toggleMono } from '../../../useCases/controlRoom/toggleMono';
import { handleSwitchMonitor } from '../handleSwitchMonitor';
import { handleToggleControlRoomDim } from '../handleToggleControlRoomDim';
import { handleToggleControlRoomMono } from '../handleToggleControlRoomMono';

vi.mock('../../../useCases/controlRoom/switchMonitor', () => ({ switchMonitor: vi.fn() }));
vi.mock('../../../useCases/controlRoom/toggleDim', () => ({ toggleDim: vi.fn() }));
vi.mock('../../../useCases/controlRoom/toggleMono', () => ({ toggleMono: vi.fn() }));

describe('controlRoomHandlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should switch monitor output', () => {
        handleSwitchMonitor.execute({ type: 'switchMonitor', payload: { monitorId: 'mon-1' } });

        expect(switchMonitor).toHaveBeenCalledWith('mon-1');
    });

    it('should toggle dim monitoring', () => {
        handleToggleControlRoomDim.execute({ type: 'toggleControlRoomDim', payload: undefined });

        expect(toggleDim).toHaveBeenCalledTimes(1);
    });

    it('should toggle mono monitoring', () => {
        handleToggleControlRoomMono.execute({ type: 'toggleControlRoomMono', payload: undefined });

        expect(toggleMono).toHaveBeenCalledTimes(1);
    });
});
