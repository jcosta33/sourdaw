import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addChordEvent } from '../addChordEvent';

const mocks = vi.hoisted(() => ({
    state: { enabled: true, events: [] } as { enabled: boolean; events: unknown[] } | null,
    set: vi.fn(),
}));

vi.mock('../../../stores/chordTrackStore', () => ({
    chordTrackStore: {
        get value() {
            return mocks.state;
        },
        set: mocks.set,
    },
}));

describe('addChordEvent', () => {
    beforeEach(() => {
        mocks.set.mockClear();
        mocks.state = { enabled: true, events: [] };
    });

    it('should return null and not write when chord track state is null', () => {
        mocks.state = null;

        expect(addChordEvent(0, 0, 'major', 4)).toBeNull();
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('should append a chord event, sort by beat, and return the new event', () => {
        mocks.state = {
            enabled: true,
            events: [{ id: 'existing', beat: 8, root: 0, quality: 'major', duration: 4 }],
        } as any;

        const created = addChordEvent(2, 5, 'minor', 2);

        expect(created).not.toBeNull();
        expect(created!.beat).toBe(2);
        expect(created!.root).toBe(5 % 12);
        expect(created!.quality).toBe('minor');
        expect(created!.duration).toBe(2);

        const call = mocks.set.mock.calls[0]![0] as { events: Array<{ beat: number }> };
        expect(call.events.map((e) => e.beat)).toEqual([2, 8]);
    });
});
