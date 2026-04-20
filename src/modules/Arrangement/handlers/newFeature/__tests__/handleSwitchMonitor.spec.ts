import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSwitchMonitor } from '../handleSwitchMonitor';

const mocks = vi.hoisted(() => ({
    switchMonitor: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    switchMonitor: mocks.switchMonitor,
}));

describe('handleSwitchMonitor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes switchMonitor with the provided payload', () => {
        void handleSwitchMonitor.execute({
            type: 'switchMonitor',
            payload: { monitorId: 'mon-1' },
        });

        expect(mocks.switchMonitor).toHaveBeenCalledWith('mon-1');
    });

    it('provides a description', () => {
        const desc = handleSwitchMonitor.describe({ type: 'switchMonitor', payload: { monitorId: '' } });
        expect(desc.label).toBe('Switch Monitor Output');
    });

    it('is not undoable', () => {
        expect(handleSwitchMonitor.undoable).toBe(false);
    });
});
