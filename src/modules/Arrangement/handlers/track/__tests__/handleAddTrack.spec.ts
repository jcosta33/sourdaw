import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    addTrack: vi.fn(),
}));

vi.mock('../../../useCases/addTrack', () => ({ addTrack: mocks.addTrack }));

import { handleAddTrack } from '../handleAddTrack';

describe('handleAddTrack', () => {
    beforeEach(() => vi.clearAllMocks());

    it('is undoable', () => {
        expect(handleAddTrack.undoable).toBe(true);
    });

    it('executes by delegating the payload to the addTrack use case', () => {
        void handleAddTrack.execute({ type: 'addTrack', payload: { name: 'Bass', kind: 'audio' } });
        expect(mocks.addTrack).toHaveBeenCalledTimes(1);
        expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'Bass', kind: 'audio' });
    });

    it('describes the action with track kind and name', () => {
        const described = handleAddTrack.describe({ type: 'addTrack', payload: { name: 'Keys', kind: 'midi' } });
        expect(described).toEqual({ label: 'Add midi track "Keys"' });
    });
});
