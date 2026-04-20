import { describe, it, expect, vi } from 'vitest';

import { updateClip } from '../../repositories/track/updateClip';
import { setClipStretchMode } from '../clipStretch/setClipStretchMode';

vi.mock('../../repositories/track/updateClip', () => ({
    updateClip: vi.fn(),
}));

describe('clip stretch use case', () => {
    it('setClipStretchMode updates clip stretch mode', () => {
        setClipStretchMode('c1', 'beats');
        expect(updateClip).toHaveBeenCalled();
    });
});
