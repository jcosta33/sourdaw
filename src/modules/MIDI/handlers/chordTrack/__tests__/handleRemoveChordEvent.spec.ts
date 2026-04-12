import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRemoveChordEvent } from '../handleRemoveChordEvent';

vi.mock('../../../useCases/chordTrack/removeChordEvent', () => ({
    removeChordEvent: vi.fn(),
}));

import { removeChordEvent } from '../../../useCases/chordTrack/removeChordEvent';

describe('handleRemoveChordEvent', () => {
    beforeEach(() => {
        vi.mocked(removeChordEvent).mockClear();
    });

    it('forwards event id', () => {
        handleRemoveChordEvent.execute({ type: 'removeChordEvent', payload: { eventId: 'e1' } });

        expect(removeChordEvent).toHaveBeenCalledWith('e1');
    });
});
