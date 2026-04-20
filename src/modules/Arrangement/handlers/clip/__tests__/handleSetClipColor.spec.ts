import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetClipColor } from '../handleSetClipColor';

const mocks = vi.hoisted(() => ({
    setClipColor: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/setClipColor', () => ({
    setClipColor: mocks.setClipColor,
}));

describe('handleSetClipColor', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to setClipColor use case', () => {
        handleSetClipColor.execute({
            type: 'setClipColor',
            payload: { clipId: 'c1', color: '#ff0000' },
        });
        expect(mocks.setClipColor).toHaveBeenCalledWith('c1', '#ff0000');
    });
});
