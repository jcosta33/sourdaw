import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleToggleLoopRecord } from '../handleToggleLoopRecord';

const mocks = vi.hoisted(() => ({
    toggleRecord: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    toggleRecord: mocks.toggleRecord,
}));

describe('handleToggleLoopRecord', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes toggleRecord from Transport module with slotId', () => {
        void handleToggleLoopRecord.execute({ type: 'toggleLoopRecord', payload: { slotId: 'slot-1' } });
        expect(mocks.toggleRecord).toHaveBeenCalledWith('slot-1');
    });

    it('provides a description', () => {
        const desc = handleToggleLoopRecord.describe({ type: 'toggleLoopRecord', payload: { slotId: '' } });
        expect(desc.label).toBe('Toggle Loop Record');
    });

    it('is not undoable', () => {
        expect(handleToggleLoopRecord.undoable).toBe(false);
    });
});
