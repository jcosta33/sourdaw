import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../useCases/chordTrack/addChordEvent', () => ({
    addChordEvent: vi.fn(),
}));

vi.mock('../handleRestoreChordTrackState', () => ({
    describeChordTrackMutation: vi.fn(() => ({ label: 'Mock', inverseAction: null })),
    findChordTrackRefusal: vi.fn(() => null),
    isChordTrackSessionEntry: vi.fn(() => true),
    isChordTrackMutationNoop: vi.fn(() => false),
}));

import { addChordEvent } from '../../../useCases/chordTrack/addChordEvent';
import { handleAddChordEvent } from '../handleAddChordEvent';

const mockedAdd = vi.mocked(addChordEvent);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleAddChordEvent — execute sanitization', () => {
    it('passes valid quality through', async () => {
        await handleAddChordEvent.execute({
            type: 'addChordEvent',
            payload: { eventId: 'e1', beat: 4, root: 5, quality: 'minor', duration: 2 },
        });
        expect(mockedAdd).toHaveBeenCalledWith(4, 5, 'minor', 2, 'e1');
    });

    it.each([
        { label: 'an unknown quality', payload: { beat: 0, root: 0, quality: 'nonexistent', duration: 4 } },
        { label: 'a root above 11', payload: { beat: 0, root: 15, quality: 'major', duration: 4 } },
        { label: 'a negative root', payload: { beat: 0, root: -3, quality: 'major', duration: 4 } },
        { label: 'a fractional root', payload: { beat: 0, root: 5.7, quality: 'major', duration: 4 } },
        { label: 'a negative beat', payload: { beat: -5, root: 0, quality: 'major', duration: 4 } },
        { label: 'a non-finite beat', payload: { beat: Number.NaN, root: 0, quality: 'major', duration: 4 } },
        { label: 'a duration below the minimum', payload: { beat: 0, root: 0, quality: 'major', duration: 0.1 } },
    ])('refuses $label instead of substituting a value', async ({ payload }) => {
        await expect(
            Promise.resolve().then(() => handleAddChordEvent.execute({ type: 'addChordEvent', payload }))
        ).rejects.toThrow();
        expect(mockedAdd).not.toHaveBeenCalled();
    });

    it('defaults duration to 4 when omitted', async () => {
        await handleAddChordEvent.execute({
            type: 'addChordEvent',
            payload: { eventId: 'e1', beat: 0, root: 0, quality: 'major' },
        });
        expect(mockedAdd).toHaveBeenCalledWith(0, 0, 'major', 4, 'e1');
    });

    it('generates chord- prefixed eventId when omitted', async () => {
        const action = { type: 'addChordEvent' as const, payload: { beat: 0, root: 0, quality: 'major', duration: 4 } };
        await handleAddChordEvent.execute(action);
        const id = mockedAdd.mock.calls[0]?.[4];
        expect(id).toMatch(/^chord-[0-9a-f-]+$/);
    });
});
