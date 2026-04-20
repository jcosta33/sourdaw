import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleTriggerScene } from '../handleTriggerScene';

const mocks = vi.hoisted(() => ({
    triggerScene: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    triggerScene: mocks.triggerScene,
}));

describe('handleTriggerScene', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes triggerScene from Transport module with column', () => {
        handleTriggerScene.execute({ type: 'triggerScene', payload: { column: 2 } });
        expect(mocks.triggerScene).toHaveBeenCalledWith(2);
    });

    it('provides a description', () => {
        const desc = handleTriggerScene.describe({ type: 'triggerScene', payload: { column: 0 } });
        expect(desc.label).toBe('Trigger Scene');
    });

    it('is not undoable', () => {
        expect(handleTriggerScene.undoable).toBe(false);
    });
});
