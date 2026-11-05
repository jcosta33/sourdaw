import { describe, it, expect, vi, beforeEach } from 'vitest';

import { toggleRippleEditing } from '../rippleEditing';

const mocks = vi.hoisted(() => ({
    toggleTimelineRippleEditing: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    toggleRippleEditing: mocks.toggleTimelineRippleEditing,
}));

describe('toggleRippleEditing', () => {
    beforeEach(() => vi.clearAllMocks());

    it('toggles ripple editing through the timeline editing owner', () => {
        toggleRippleEditing();

        expect(mocks.toggleTimelineRippleEditing).toHaveBeenCalledTimes(1);
    });
});
