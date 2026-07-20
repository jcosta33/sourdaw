import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleToggleLoopRecord } from '../handleToggleLoopRecord';
import { handleTriggerScene } from '../handleTriggerScene';

const mocks = vi.hoisted(() => ({
    toggleRecord: vi.fn(),
    triggerScene: vi.fn(),
}));

vi.mock('../../../useCases/loopStation/toggleRecord', () => ({ toggleRecord: mocks.toggleRecord }));
vi.mock('../../../useCases/loopStation/triggerScene', () => ({ triggerScene: mocks.triggerScene }));

describe('Session Launcher Handlers', () => {
    beforeEach(() => vi.clearAllMocks());

    it('handleToggleLoopRecord delegates to use case with slot id', () => {
        handleToggleLoopRecord.execute({ type: 'toggleLoopRecord', payload: { slotId: 'slot-1' } });
        expect(mocks.toggleRecord).toHaveBeenCalledWith('slot-1');
        expect(handleToggleLoopRecord.describe({ type: 'toggleLoopRecord', payload: { slotId: 'slot-1' } })).toEqual({
            label: 'Toggle Loop Record',
        });
    });

    it('handleTriggerScene delegates to use case with column', () => {
        handleTriggerScene.execute({ type: 'triggerScene', payload: { column: 2 } });
        expect(mocks.triggerScene).toHaveBeenCalledWith(2);
        expect(handleTriggerScene.describe({ type: 'triggerScene', payload: { column: 2 } })).toEqual({
            label: 'Trigger Scene',
        });
    });
});
