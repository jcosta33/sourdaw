import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetOverride } from '#/modules/Arrangement/useCases/clipEditing/resetOverride';
import { updateClip } from '#/modules/Arrangement/useCases/updateClip';

vi.mock('#/modules/Arrangement/useCases/updateClip', () => ({
    updateClip: vi.fn(),
}));

describe('resetOverride', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should remove property from overrides map', () => {
        resetOverride('c1', 'color');
        expect(vi.mocked(updateClip)).toHaveBeenCalledWith('c1', expect.any(Function));
        
        const updater = vi.mocked(updateClip).mock.calls[0]![1];
        const result = updater({ id: 'c1', overrides: { color: true, gain: true } });
        expect(result.overrides).toEqual({ gain: true });
        expect(result.overrides.color).toBeUndefined();
    });
});
