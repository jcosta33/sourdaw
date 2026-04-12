import { describe, it, expect, vi } from 'vitest';
import { setClipStretchMode } from '../clipStretch/setClipStretchMode';
import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';

vi.mock('#/modules/Arrangement/repositories/track/updateClip', () => ({
    updateClip: vi.fn(),
}));

describe('clip stretch use case', () => {
    it('setClipStretchMode updates clip stretch mode', () => {
        setClipStretchMode('c1', 'beats');
        expect(updateClip).toHaveBeenCalled();
    });
});
