import { describe, it, expect, vi, beforeEach } from 'vitest';

type Step = { active: boolean; soundLock?: string };
type Track = { padIndex: number; steps: Step[] };
type Pattern = { id: string; tracks: Track[] };
type Kit = { activePatternId: string; patterns: Pattern[] };

const { setMock, mockStore } = vi.hoisted(() => {
    const ref = { value: null as { kit: Kit } | null };
    const setMock = vi.fn((next: typeof ref.value) => {
        ref.value = next;
    });
    return { setMock, mockStore: ref };
});

vi.mock('../../stores/toasterStore', () => ({
    toasterStore: {
        get value() {
            return mockStore.value;
        },
        set: setMock,
    },
}));

import { getSoundLock } from '../soundLocks/getSoundLock';
import { setSoundLock } from '../soundLocks/setSoundLock';

function freshKit(): { kit: Kit } {
    return {
        kit: {
            activePatternId: 'p1',
            patterns: [
                {
                    id: 'p1',
                    tracks: [{ padIndex: 0, steps: [{ active: true }, { active: false }, { active: true }] }],
                },
            ],
        },
    };
}

describe('soundLocks', () => {
    beforeEach(() => {
        mockStore.value = freshKit();
        setMock.mockClear();
    });

    it('setSoundLock writes the engine type onto a step', () => {
        setSoundLock(0, 1, 'kick' as never);
        const step = setMock.mock.calls[0]![0]!.kit.patterns[0]!.tracks[0]!.steps[1]!;
        expect(step.soundLock).toBe('kick');
    });

    it('setSoundLock with null clears the lock', () => {
        mockStore.value!.kit.patterns[0]!.tracks[0]!.steps[0]!.soundLock = 'snare';
        setSoundLock(0, 0, null);
        const step = setMock.mock.calls[0]![0]!.kit.patterns[0]!.tracks[0]!.steps[0]!;
        expect(step.soundLock).toBeUndefined();
    });

    it('getSoundLock reads the current lock', () => {
        mockStore.value!.kit.patterns[0]!.tracks[0]!.steps[0]!.soundLock = 'snare';
        expect(getSoundLock(0, 0)).toBe('snare');
        expect(getSoundLock(0, 1)).toBeNull();
    });

    it('all helpers tolerate missing pattern / track', () => {
        mockStore.value = { kit: { activePatternId: 'p1', patterns: [] } };
        setSoundLock(0, 0, 'kick' as never);
        expect(setMock).not.toHaveBeenCalled();
        expect(getSoundLock(0, 0)).toBeNull();
    });
});
