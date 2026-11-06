import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setSnapValue } from '../setSnapValue';

const mocks = vi.hoisted(() => ({
    setTimelineSnapValue: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    setSnapValue: mocks.setTimelineSnapValue,
}));

describe('setSnapValue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes the snap value through the timeline editing owner', () => {
        setSnapValue(0.25);

        expect(mocks.setTimelineSnapValue).toHaveBeenCalledWith(0.25);
    });
});
