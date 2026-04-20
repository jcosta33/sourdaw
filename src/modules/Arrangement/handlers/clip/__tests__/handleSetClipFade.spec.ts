import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetClipFade } from '../handleSetClipFade';

const mocks = vi.hoisted(() => ({
    setClipFade: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/setClipFade', () => ({
    setClipFade: mocks.setClipFade,
}));

describe('handleSetClipFade', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setClipFade with the provided payload', () => {
        void handleSetClipFade.execute({
            type: 'setClipFade',
            payload: { clipId: 'c1', fadeInBeats: 1, fadeOutBeats: 2 },
        });

        expect(mocks.setClipFade).toHaveBeenCalledWith('c1', 1, 2);
    });

    it('provides a description', () => {
        const desc = handleSetClipFade.describe({
            type: 'setClipFade',
            payload: { clipId: 'c1', fadeInBeats: 1, fadeOutBeats: 2 },
        });
        expect(desc.label).toBe('Set clip fade');
    });

    it('is undoable', () => {
        expect(handleSetClipFade.undoable).toBe(true);
    });
});
