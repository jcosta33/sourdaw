import { describe, it, expect, vi, beforeEach } from 'vitest';

type Step = { active: boolean; soundLock?: string };
type Track = { padIndex: number; steps: Step[] };
type Pattern = { id: string; tracks: Track[] };
type Kit = { activePatternId: string; patterns: Pattern[] };
type Instances = Record<string, { kit: Kit }>;

const DEVICE_ID = 'd1';

const { setMock, mockStore } = vi.hoisted(() => {
    const ref = { value: null as Record<string, { kit: Kit }> | null };
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

function freshKit(): Instances {
    return {
        [DEVICE_ID]: {
            kit: {
                activePatternId: 'p1',
                patterns: [
                    {
                        id: 'p1',
                        tracks: [{ padIndex: 0, steps: [{ active: true }, { active: false }, { active: true }] }],
                    },
                ],
            },
        },
    };
}

describe('soundLocks', () => {
    beforeEach(() => {
        mockStore.value = freshKit();
        setMock.mockClear();
    });

    it('setSoundLock writes the engine type onto a step', () => {
        setSoundLock(DEVICE_ID, 0, 1, 'kick-808');
        const next = setMock.mock.calls[0]![0] as Instances;
        const step = next[DEVICE_ID]!.kit.patterns[0]!.tracks[0]!.steps[1]!;
        expect(step.soundLock).toBe('kick-808');
    });

    it('setSoundLock with null clears the lock', () => {
        mockStore.value![DEVICE_ID]!.kit.patterns[0]!.tracks[0]!.steps[0]!.soundLock = 'snare-808';
        setSoundLock(DEVICE_ID, 0, 0, null);
        const next = setMock.mock.calls[0]![0] as Instances;
        const step = next[DEVICE_ID]!.kit.patterns[0]!.tracks[0]!.steps[0]!;
        expect(step.soundLock).toBeUndefined();
    });

    it('getSoundLock reads the current lock', () => {
        mockStore.value![DEVICE_ID]!.kit.patterns[0]!.tracks[0]!.steps[0]!.soundLock = 'snare-808';
        expect(getSoundLock(DEVICE_ID, 0, 0)).toBe('snare-808');
        expect(getSoundLock(DEVICE_ID, 0, 1)).toBeNull();
    });

    it('all helpers tolerate missing pattern / track', () => {
        mockStore.value = { [DEVICE_ID]: { kit: { activePatternId: 'p1', patterns: [] } } };
        setSoundLock(DEVICE_ID, 0, 0, 'kick-808');
        expect(setMock).not.toHaveBeenCalled();
        expect(getSoundLock(DEVICE_ID, 0, 0)).toBeNull();
    });
});
